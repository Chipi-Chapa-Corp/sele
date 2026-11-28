// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export const FLATPAK_SPAWN_COMMAND = "flatpak-spawn";
export const FLATPAK_HOST_ROOT = "/run/host";
export const FLATPAK_SANDBOX_PATH_ENV = "T3CODE_FLATPAK_SANDBOX_PATH";
export const FLATPAK_HOST_DEFAULT_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

const HOST_MAPPED_ROOT_PREFIXES = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc"] as const;
const MAX_SYMLINK_HOPS = 16;

const INITIAL_SANDBOX_ENV: Readonly<NodeJS.ProcessEnv> = { ...process.env };

const SANDBOX_ONLY_ENV_KEYS = new Set([
  "FLATPAK_ID",
  "FLATPAK_SANDBOX_DIR",
  "container",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "LD_AUDIT",
  "GI_TYPELIB_PATH",
  "GST_PLUGIN_SYSTEM_PATH",
  "GST_PLUGIN_SYSTEM_PATH_1_0",
  "GSETTINGS_SCHEMA_DIR",
  "XDG_DATA_DIRS",
  "XDG_CONFIG_DIRS",
  "ALSA_CONFIG_PATH",
  "PULSE_CLIENTCONFIG",
  "AT_SPI_BUS_ADDRESS",
  "APPDIR",
  "APPIMAGE",
  "ARGV0",
  "OWD",
  "ELECTRON_RUN_AS_NODE",
  FLATPAK_SANDBOX_PATH_ENV,
]);

const SANDBOX_ONLY_ENV_PREFIXES = ["ZYPAK_", "HOST_XDG_"] as const;

const XDG_HOST_FALLBACKS = [
  ["XDG_CONFIG_HOME", "HOST_XDG_CONFIG_HOME", ".config"],
  ["XDG_DATA_HOME", "HOST_XDG_DATA_HOME", ".local/share"],
  ["XDG_STATE_HOME", "HOST_XDG_STATE_HOME", ".local/state"],
  ["XDG_CACHE_HOME", "HOST_XDG_CACHE_HOME", ".cache"],
] as const;

const XDG_HOME_KEYS = new Set<string>(XDG_HOST_FALLBACKS.map(([key]) => key));

const ALWAYS_FORWARD_ENV_KEYS = new Set([
  "TERM",
  "COLORTERM",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
]);

const PROTECTED_UNSET_KEYS = new Set(["PATH", "HOME", "USER", "LOGNAME", "SHELL", "DISPLAY"]);

const VALID_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isRunningInFlatpak(
  env: NodeJS.ProcessEnv = process.env,
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Called from imperative startup and SDK spawn hooks outside Effect.
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "linux" && Boolean(env.FLATPAK_ID?.trim());
}

export function isSandboxOnlyEnvKey(key: string): boolean {
  return (
    SANDBOX_ONLY_ENV_KEYS.has(key) ||
    SANDBOX_ONLY_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

function isSandboxAppXdgPath(value: string, flatpakId: string | undefined): boolean {
  const normalized = value.replace(/\/+$/u, "");
  if (normalized.includes("/.var/app/")) {
    return !flatpakId || normalized.includes(`/.var/app/${flatpakId}`);
  }
  return false;
}

function isSandboxTmpdir(value: string): boolean {
  return /^\/run\/user\/\d+\/app\//u.test(value) || value.startsWith("/run/flatpak/");
}

function isAppBundlePath(entry: string): boolean {
  return entry === "/app" || entry.startsWith("/app/");
}

export function readFlatpakHostLoginShell(options?: {
  readonly passwdPath?: string;
  readonly uid?: number | undefined;
  readonly username?: string | undefined;
}): string | undefined {
  const passwdPath = options?.passwdPath ?? `${FLATPAK_HOST_ROOT}/etc/passwd`;
  let content: string;
  try {
    content = NodeFS.readFileSync(passwdPath, "utf8");
  } catch {
    return undefined;
  }

  let uid = options?.uid;
  let username = options?.username;
  if (uid === undefined && username === undefined) {
    uid = process.getuid?.();
    try {
      username = NodeOS.userInfo().username;
    } catch {
      username = undefined;
    }
  }

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const fields = line.split(":");
    if (fields.length < 7) continue;
    const entryUser = fields[0];
    const entryUid = Number(fields[2]);
    const entryShell = fields[6]?.trim();
    if (!entryShell) continue;
    if (
      (uid !== undefined && Number.isInteger(entryUid) && entryUid === uid) ||
      (username !== undefined && entryUser === username)
    ) {
      return entryShell;
    }
  }
  return undefined;
}

/**
 * Flatpak points XDG_*_HOME into ~/.var/app/<id> and sets SHELL=/bin/sh. Restore the host's
 * XDG directories and login shell so in-sandbox config readers and login-shell discovery see
 * the user's real host setup.
 */
export function normalizeFlatpakHostEnv(
  env: NodeJS.ProcessEnv = process.env,
  options?: {
    readonly platform?: NodeJS.Platform;
    readonly homeDirectory?: string;
    readonly hostLoginShell?: string | undefined;
  },
): boolean {
  if (!isRunningInFlatpak(env, options?.platform)) return false;

  if (env[FLATPAK_SANDBOX_PATH_ENV] === undefined && env.PATH !== undefined) {
    env[FLATPAK_SANDBOX_PATH_ENV] = env.PATH;
  }

  const homeDirectory = options?.homeDirectory ?? env.HOME?.trim() ?? NodeOS.homedir();
  const flatpakId = env.FLATPAK_ID?.trim();
  for (const [xdgKey, hostKey, fallbackSubdir] of XDG_HOST_FALLBACKS) {
    const current = env[xdgKey]?.trim();
    if (!current || isSandboxAppXdgPath(current, flatpakId)) {
      const hostValue = env[hostKey]?.trim();
      env[xdgKey] =
        hostValue && hostValue.length > 0
          ? hostValue
          : NodePath.posix.join(homeDirectory, fallbackSubdir);
    }
  }

  const currentShell = env.SHELL?.trim();
  if (!currentShell || currentShell === "/bin/sh") {
    const hostShell =
      options && "hostLoginShell" in options ? options.hostLoginShell : readFlatpakHostLoginShell();
    if (hostShell && hostShell.trim().length > 0) {
      env.SHELL = hostShell.trim();
    }
  }

  return true;
}

export function mapToFlatpakHostFilesystemPath(
  filePath: string,
  hostRoot: string = FLATPAK_HOST_ROOT,
): string {
  for (const prefix of HOST_MAPPED_ROOT_PREFIXES) {
    if (filePath === prefix || filePath.startsWith(`${prefix}/`)) {
      return `${hostRoot}${filePath}`;
    }
  }
  return filePath;
}

export function isUninspectableFlatpakHostPath(filePath: string): boolean {
  if (filePath === "/tmp" || filePath.startsWith("/tmp/")) return true;
  if (filePath === "/var/run" || filePath.startsWith("/var/run/")) return true;
  if (filePath === "/run" || (filePath.startsWith("/run/") && !filePath.startsWith("/run/host/"))) {
    return true;
  }
  return false;
}

export function hasFlatpakHostRootMount(hostRoot: string = FLATPAK_HOST_ROOT): boolean {
  try {
    return NodeFS.statSync(`${hostRoot}/usr`).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolves a host path to its accessible path inside the Flatpak sandbox, remapping
 * runtime-shadowed roots (/usr, /bin, /sbin, /lib, /lib64, /etc) and absolute symlinks
 * through /run/host.
 */
export function resolveFlatpakHostAccessiblePath(
  filePath: string,
  hostRoot: string = FLATPAK_HOST_ROOT,
): string | undefined {
  let current = mapToFlatpakHostFilesystemPath(filePath, hostRoot);
  for (let hop = 0; hop < MAX_SYMLINK_HOPS; hop++) {
    let stats: NodeFS.Stats;
    try {
      stats = NodeFS.lstatSync(current);
    } catch {
      return undefined;
    }
    if (!stats.isSymbolicLink()) return current;

    let target: string;
    try {
      target = NodeFS.readlinkSync(current);
    } catch {
      return undefined;
    }
    current = target.startsWith("/")
      ? mapToFlatpakHostFilesystemPath(target, hostRoot)
      : NodePath.posix.resolve(NodePath.posix.dirname(current), target);
  }
  return undefined;
}

export function checkFlatpakHostExecutable(
  filePath: string,
  hostRoot: string = FLATPAK_HOST_ROOT,
): "ok" | "eacces" | "enoent" {
  const resolved = resolveFlatpakHostAccessiblePath(filePath, hostRoot);
  if (resolved === undefined) return "enoent";
  try {
    if (!NodeFS.statSync(resolved).isFile()) return "eacces";
    NodeFS.accessSync(resolved, NodeFS.constants.X_OK);
    return "ok";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EACCES" ? "eacces" : "enoent";
  }
}

export function shouldRunInsideFlatpakSandbox(
  command: string,
  selfExecutablePath: string = process.execPath,
): boolean {
  if (command === FLATPAK_SPAWN_COMMAND || command.endsWith(`/${FLATPAK_SPAWN_COMMAND}`)) {
    return true;
  }
  if (command === selfExecutablePath || command === "/proc/self/exe") {
    return true;
  }
  return isAppBundlePath(command);
}

export function sanitizeFlatpakHostPathValue(
  pathValue: string | undefined,
  sandboxPath?: string,
): string | undefined {
  if (!pathValue) return undefined;
  const clean = (raw: string) =>
    raw
      .split(":")
      .filter((entry) => entry.length > 0 && !isAppBundlePath(entry))
      .join(":");
  const cleaned = clean(pathValue);
  if (cleaned.length === 0) return undefined;
  const cleanedSandbox = sandboxPath ? clean(sandboxPath) : undefined;
  if (
    cleaned === "/usr/bin" ||
    cleaned === "/usr/bin:/bin" ||
    (cleanedSandbox !== undefined && cleaned === cleanedSandbox)
  ) {
    return undefined;
  }
  return cleaned;
}

export interface FlatpakHostSpawnInput {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly extendEnv?: boolean | undefined;
  readonly sandboxEnv?: NodeJS.ProcessEnv | undefined;
  readonly forwardFds?: ReadonlyArray<number> | undefined;
}

export interface FlatpakHostSpawnResult {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: NodeJS.ProcessEnv;
}

export function buildFlatpakHostSpawn(input: FlatpakHostSpawnInput): FlatpakHostSpawnResult {
  const sandboxEnv = input.sandboxEnv ?? INITIAL_SANDBOX_ENV;
  const flatpakId = sandboxEnv.FLATPAK_ID?.trim() ?? process.env.FLATPAK_ID?.trim();
  const sandboxPath =
    input.env?.[FLATPAK_SANDBOX_PATH_ENV] ??
    process.env[FLATPAK_SANDBOX_PATH_ENV] ??
    sandboxEnv.PATH;
  const effectiveEnv: Record<string, string | undefined> =
    input.env === undefined
      ? { ...process.env }
      : input.extendEnv === true
        ? { ...process.env, ...input.env }
        : input.env;

  const envArgs: string[] = [];
  for (const [key, value] of Object.entries(effectiveEnv)) {
    if (!VALID_ENV_KEY.test(key) || isSandboxOnlyEnvKey(key)) continue;
    if (value === undefined) {
      // Explicit undefined in the caller's env patch means "unset this variable on the host".
      if (
        input.env !== undefined &&
        Object.hasOwn(input.env, key) &&
        !PROTECTED_UNSET_KEYS.has(key)
      ) {
        envArgs.push(`--unset-env=${key}`);
      }
      continue;
    }
    if (value.includes("\0")) continue;
    if (XDG_HOME_KEYS.has(key) && isSandboxAppXdgPath(value, flatpakId)) continue;
    if (key === "TMPDIR" && isSandboxTmpdir(value)) continue;

    if (key === "PATH") {
      const sanitized = sanitizeFlatpakHostPathValue(value, sandboxPath);
      if (sanitized !== undefined) {
        envArgs.push(`--env=PATH=${sanitized}`);
      }
      continue;
    }

    if (value === sandboxEnv[key] && !ALWAYS_FORWARD_ENV_KEYS.has(key)) continue;
    envArgs.push(`--env=${key}=${value}`);
  }

  const forwardFdArgs = (input.forwardFds ?? []).map((fd) => `--forward-fd=${fd}`);
  const cwdArgs = input.cwd ? [`--directory=${input.cwd}`] : [];

  return {
    command: FLATPAK_SPAWN_COMMAND,
    args: [
      "--host",
      "--watch-bus",
      ...cwdArgs,
      ...forwardFdArgs,
      ...envArgs,
      "--",
      input.command,
      ...input.args,
    ],
    env: { ...process.env },
  };
}
