// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeStream from "node:stream";
import * as NodeStreamPromises from "node:stream/promises";
import * as NodeUtil from "node:util";

import {
  DEFAULT_RELEASE_OWNER,
  DEFAULT_RELEASE_REPO,
  findLatestPlatformRelease,
  isCandidateUpdateVersion,
  platformReleaseVersion,
  releaseDownloadUrl,
  type PlatformRelease,
  type ReleaseSelectionOptions,
} from "./platformRelease.ts";

const { execFile, spawn } = NodeChildProcess;
const { createHash } = NodeCrypto;
const { constants, createWriteStream } = NodeFS;
const { access, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, writeFile } =
  NodeFSP;
const { basename, dirname, join, resolve, sep } = NodePath;
const { Readable, Transform } = NodeStream;
const { pipeline } = NodeStreamPromises;
const exec = NodeUtil.promisify(execFile);
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const APP_BUNDLE_ID = "com.chipichapa.sele";
const APP_BUNDLE_NAME = "Sele.app";
const APP_EXECUTABLE_NAME = "Sele";
const STAGING_PREFIX = "mac-update-";
const STAGING_NAME = /^mac-update-[a-zA-Z0-9]{6}$/;
const STALE_STAGE_AGE_MS = 24 * 60 * 60 * 1000;

export interface MacUpdate {
  readonly version: string;
  readonly arch: "arm64" | "x64";
  readonly url: string;
  readonly sha256: string;
  readonly size: number;
  readonly releaseNotes?: string;
  readonly releaseName?: string | null;
  readonly releaseDate?: string;
}

export interface StagedMacUpdate {
  readonly update: MacUpdate;
  readonly stage: string;
  readonly archive: string;
}

function isFileMissingError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

export function selectMacUpdate(
  release: PlatformRelease,
  current: string,
  arch: string,
  options: ReleaseSelectionOptions = {},
): MacUpdate | null {
  if (arch !== "arm64" && arch !== "x64") {
    throw new Error(`Unsupported Mac architecture: ${arch}`);
  }
  const version = platformReleaseVersion(
    release,
    `macos-${arch}`,
    options.allowPrerelease === true,
  );
  if (!version || !isCandidateUpdateVersion(version, current, options.allowDowngrade === true)) {
    return null;
  }
  const name = `Sele-${version}-${arch}-mac.zip`;
  const asset = release.assets?.find((candidate) => candidate.name === name);
  if (!asset) {
    throw new Error(`Release ${version} has no update for ${arch}.`);
  }
  const expectedUrl = `${releaseDownloadUrl(release, {
    owner: options.owner ?? DEFAULT_RELEASE_OWNER,
    repo: options.repo ?? DEFAULT_RELEASE_REPO,
  })}${name}`;
  if (
    asset.browser_download_url !== expectedUrl ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "") ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0
  ) {
    throw new Error("The Mac update has invalid download metadata or no SHA-256 checksum.");
  }
  return {
    version,
    arch,
    url: expectedUrl,
    sha256: asset.digest!.slice(7),
    size: asset.size,
    ...(typeof release.body === "string" ? { releaseNotes: release.body } : {}),
    ...(release.name !== undefined ? { releaseName: release.name } : {}),
    ...(typeof release.published_at === "string" ? { releaseDate: release.published_at } : {}),
  };
}

export async function checkMacUpdate(input: {
  readonly current: string;
  readonly arch: string;
  readonly owner?: string;
  readonly repo?: string;
  readonly allowPrerelease?: boolean;
  readonly allowDowngrade?: boolean;
  readonly fetchImpl?: typeof fetch;
}): Promise<MacUpdate | null> {
  if (input.arch !== "arm64" && input.arch !== "x64") {
    throw new Error(`Unsupported Mac architecture: ${input.arch}`);
  }
  const options: ReleaseSelectionOptions = {
    ...(input.owner !== undefined ? { owner: input.owner } : {}),
    ...(input.repo !== undefined ? { repo: input.repo } : {}),
    ...(input.allowPrerelease !== undefined ? { allowPrerelease: input.allowPrerelease } : {}),
    ...(input.allowDowngrade !== undefined ? { allowDowngrade: input.allowDowngrade } : {}),
  };
  const selected = await findLatestPlatformRelease(
    `macos-${input.arch}`,
    input.current,
    options,
    input.fetchImpl,
  );
  return selected ? selectMacUpdate(selected.release, input.current, input.arch, options) : null;
}

export const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

// Passed inline to bash (including through osascript), never executed from a user-writable script
// as root. All paths are quoted values; downloaded contents are never executed with elevation.
export function macInstallScript(
  target: string,
  archive: string,
  sha256: string,
  stage: string,
  pid: number,
): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Invalid update checksum");
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error("Invalid updater parent PID");
  return `set -eu
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
target=${shellQuote(target)}
archive=${shellQuote(archive)}
stage=${shellQuote(stage)}
work=''
moved=0
installed=0
finish() {
  code=$?
  trap - EXIT HUP INT TERM
  if [ "$code" -ne 0 ]; then
    echo "Mac update failed (exit $code)."
    if [ "$moved" -eq 1 ]; then
      if [ "$installed" -eq 1 ]; then
        if ! /bin/mv "$target" "$work/failed.app"; then
          echo "Cannot move failed app. Backup remains at $work/previous.app"
          exit 1
        fi
      fi
      if /bin/mv "$work/previous.app" "$target"; then
        /bin/mkdir "$stage/rolled-back"
      else
        echo "Restore failed. Previous app remains at $work/previous.app"
        exit 1
      fi
    fi
  fi
  if [ -n "$work" ]; then
    if ! /bin/rm -rf "$work"; then echo "Could not clean update backup directory: $work"; fi
  fi
  exit "$code"
}
trap finish EXIT
trap 'exit 1' HUP INT TERM
[ -d "$target" ] && [ ! -L "$target" ]
work=$(/usr/bin/mktemp -d ${shellQuote(join(dirname(target), ".sele-update.XXXXXX"))})
# Reverify a private copy before privileged extraction. Never trust mutable staging files.
/bin/cp "$archive" "$work/update.zip"
actual=$(/usr/bin/shasum -a 256 "$work/update.zip")
[ "\${actual%% *}" = ${shellQuote(sha256)} ]
/usr/bin/ditto --noqtn -x -k "$work/update.zip" "$work/unpacked"
/bin/rm -f "$work/update.zip"
/bin/mv "$work/unpacked/${APP_BUNDLE_NAME}" "$work/new.app"
/usr/bin/xattr -dr com.apple.quarantine "$work/new.app"
[ ! -d "$stage/cancel" ]
/bin/mkdir "$stage/ready"
# Only replace after the user authorized this attempt AND the original process exited.
count=0
while /bin/kill -0 ${pid} 2>/dev/null; do
  [ ! -d "$stage/cancel" ]
  count=$((count + 1))
  [ "$count" -lt 120 ]
  /bin/sleep 1
done
[ -d "$stage/commit" ] && [ ! -d "$stage/cancel" ]
/bin/mv "$target" "$work/previous.app"
moved=1
/bin/mv "$work/new.app" "$target"
installed=1
/bin/mkdir "$stage/installed"
count=0
while [ ! -d "$stage/launched" ]; do
  [ ! -d "$stage/launch-failed" ]
  count=$((count + 1))
  [ "$count" -lt 60 ]
  /bin/sleep 1
done
# open succeeded; replacement rollback is no longer needed.
moved=0
`;
}

export function macAuthorizationScript(command: string): string {
  return `with timeout of 600 seconds\n  do shell script ${JSON.stringify(command)} with administrator privileges\nend timeout`;
}

export function macSupervisorScript(
  worker: string,
  elevated: boolean,
  target: string,
  stage: string,
): string {
  const command = `/bin/bash -c ${shellQuote(worker)}`;
  const invocation = elevated
    ? `/usr/bin/osascript -e ${shellQuote(macAuthorizationScript(command))}`
    : command;
  return `export PATH=/usr/bin:/bin:/usr/sbin:/sbin
stage=${shellQuote(stage)}
echo "$$" > "$stage/supervisor.pid"
${invocation} &
worker=$!
while /bin/kill -0 "$worker" 2>/dev/null; do
  if [ -d "$stage/installed" ] && [ ! -d "$stage/launched" ] && [ ! -d "$stage/launch-failed" ]; then
    if /usr/bin/open -n ${shellQuote(target)}; then
      /bin/mkdir "$stage/launched"
    else
      /bin/mkdir "$stage/launch-failed"
    fi
  fi
  /bin/sleep 1
done
wait "$worker"
result=$?
/bin/rm -f "$stage/update.zip"
if [ "$result" -eq 0 ]; then
  echo success > "$stage/result.tmp"
else
  echo error > "$stage/result.tmp"
  if [ -d "$stage/rolled-back" ] || { [ -d "$stage/commit" ] && [ ! -d "$stage/installed" ]; }; then
    /usr/bin/open -n ${shellQuote(target)}
  fi
fi
/bin/mv "$stage/result.tmp" "$stage/result"
exit "$result"
`;
}

async function validateBundle(
  bundle: string,
  version: string,
  arch: "arm64" | "x64",
): Promise<void> {
  const visit = async (entryPath: string): Promise<void> => {
    const stat = await lstat(entryPath);
    if (stat.isSymbolicLink()) {
      const destination = await realpath(entryPath);
      if (!destination.startsWith(`${bundle}${sep}`)) {
        throw new Error("Update bundle contains an external symlink.");
      }
    } else if (stat.isDirectory()) {
      for (const name of await readdir(entryPath)) {
        await visit(join(entryPath, name));
      }
    } else if (!stat.isFile()) {
      throw new Error("Update bundle contains a special file.");
    }
  };
  if (!(await lstat(bundle)).isDirectory()) {
    throw new Error("Update is not an application bundle.");
  }
  await visit(bundle);
  const plist = join(bundle, "Contents/Info.plist");
  const field = async (name: string): Promise<string> =>
    (await exec("/usr/libexec/PlistBuddy", ["-c", `Print :${name}`, plist])).stdout.trim();
  if (
    (await field("CFBundleIdentifier")) !== APP_BUNDLE_ID ||
    (await field("CFBundleShortVersionString")) !== version ||
    (await field("CFBundleExecutable")) !== APP_EXECUTABLE_NAME
  ) {
    throw new Error("Downloaded application identity or version does not match the release.");
  }
  await exec("/usr/bin/lipo", [
    join(bundle, `Contents/MacOS/${APP_EXECUTABLE_NAME}`),
    "-verify_arch",
    arch === "arm64" ? "arm64" : "x86_64",
  ]);
  await exec("/usr/bin/xattr", ["-dr", "com.apple.quarantine", bundle]);
}

export async function downloadAndStageMacUpdate(options: {
  readonly update: MacUpdate;
  readonly userData: string;
  readonly progress: (percent: number) => void;
  readonly fetchImpl?: typeof fetch;
}): Promise<StagedMacUpdate> {
  const { update, progress } = options;
  await mkdir(options.userData, { recursive: true });
  const stage = await mkdtemp(join(options.userData, STAGING_PREFIX));
  try {
    const archive = join(stage, "update.zip");
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(update.url, { signal: AbortSignal.timeout(15 * 60_000) });
    if (!response.ok || !response.body) {
      throw new Error(`Update download failed (${response.status}).`);
    }
    const hash = createHash("sha256");
    let received = 0;
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length;
          if (received > update.size) {
            return callback(new Error("Update exceeds its declared size."));
          }
          hash.update(chunk);
          progress(Math.round((received / update.size) * 100));
          callback(null, chunk);
        },
      }),
      createWriteStream(archive, { flags: "wx", mode: 0o600 }),
    );
    if (received !== update.size || hash.digest("hex") !== update.sha256) {
      throw new Error("Update checksum or size does not match the release.");
    }
    const listing = (
      await exec("/usr/bin/unzip", ["-Z1", archive], { maxBuffer: 16 * 1024 * 1024 })
    ).stdout;
    for (const entry of listing.trim().split("\n")) {
      if (
        !entry.startsWith(`${APP_BUNDLE_NAME}/`) ||
        entry.split("/").includes("..") ||
        entry.includes("\\")
      ) {
        throw new Error("Update archive contains an unexpected path.");
      }
    }
    const extracted = join(stage, "extracted");
    await mkdir(extracted);
    await exec("/usr/bin/ditto", ["--noqtn", "-x", "-k", archive, extracted], {
      timeout: 5 * 60_000,
    });
    const bundle = join(extracted, APP_BUNDLE_NAME);
    await validateBundle(bundle, update.version, update.arch);
    await rm(extracted, { recursive: true, force: true });
    return { update, stage, archive };
  } catch (error) {
    await rm(stage, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (isFileMissingError(error)) return false;
    throw error;
  }
}

export async function installStagedMacUpdate(options: {
  readonly staged: StagedMacUpdate;
  readonly executable: string;
  readonly userData: string;
  readonly quit: () => void;
}): Promise<void> {
  const { staged } = options;
  // Resolve Homebrew symlinks and replace the actual bundle without breaking the app link.
  const executable = await realpath(options.executable);
  const marker = ".app/Contents/MacOS/";
  const index = executable.lastIndexOf(marker);
  if (
    index < 0 ||
    executable.startsWith("/Volumes/") ||
    executable.includes("/AppTranslocation/")
  ) {
    throw new Error("Install Sele on a writable disk before updating.");
  }
  const target = executable.slice(0, index + 4);
  const pending = join(options.userData, "mac-update-pending.json");
  let helperStarted = false;
  let pendingWritten = false;
  try {
    let elevated = false;
    try {
      await access(dirname(target), constants.W_OK);
      await access(target, constants.W_OK);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EACCES" && code !== "EPERM") {
        throw error;
      }
      elevated = true;
    }
    const record = join(staged.stage, "pending.json");
    await writeFile(
      record,
      JSON.stringify({ stage: staged.stage, version: staged.update.version }),
      { mode: 0o600 },
    );
    await rename(record, pending);
    pendingWritten = true;
    const log = await open(join(staged.stage, "helper.log"), "wx", 0o600);
    const helper = spawn(
      "/bin/bash",
      [
        "-c",
        macSupervisorScript(
          macInstallScript(target, staged.archive, staged.update.sha256, staged.stage, process.pid),
          elevated,
          target,
          staged.stage,
        ),
      ],
      {
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
        cwd: "/",
      },
    );
    let spawnError: Error | null = null;
    helper.on("error", (error) => {
      spawnError = error;
    });
    helperStarted = helper.pid !== undefined;
    helper.unref();
    await log.close();
    // Keep the app open through staging and the system's authorization dialog.
    for (let attempt = 0; attempt < 600; attempt++) {
      if (spawnError) throw spawnError;
      if (await pathExists(join(staged.stage, "result"))) {
        throw new Error(
          `Unable to prepare the update. Authorization may have been cancelled.\n${await readFile(join(staged.stage, "helper.log"), "utf8")}`,
        );
      }
      if (await pathExists(join(staged.stage, "ready"))) {
        await mkdir(join(staged.stage, "commit"));
        options.quit();
        return;
      }
      await sleep(500);
    }
    throw new Error("Timed out waiting for update authorization.");
  } catch (error) {
    try {
      if (helperStarted) {
        await mkdir(join(staged.stage, "cancel"), { recursive: true });
      } else {
        if (pendingWritten) await rm(pending, { force: true });
        await rm(staged.stage, { recursive: true, force: true });
      }
    } catch {
      // Best-effort staging cleanup.
    }
    throw error;
  }
}

async function readOptionalUpdateFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isFileMissingError(error)) return null;
    throw error;
  }
}

async function readStageResult(stage: string): Promise<"success" | "error" | null> {
  const result = (await readOptionalUpdateFile(join(stage, "result")))?.trim();
  return result === "success" || result === "error" ? result : null;
}

async function isStaleStage(stage: string, modifiedAt: number): Promise<boolean> {
  if (Date.now() - modifiedAt < STALE_STAGE_AGE_MS) return false;
  const pid = Number(await readOptionalUpdateFile(join(stage, "supervisor.pid")));
  if (!Number.isInteger(pid) || pid <= 1 || pid > 0x7fffffff) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return true;
    if (code === "EPERM") return false;
    throw error;
  }
}

async function cleanMacUpdateStages(userData: string, pendingStage?: string): Promise<void> {
  const entries = await readdir(userData, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !STAGING_NAME.test(entry.name)) continue;
    const stage = resolve(userData, entry.name);
    if (stage === pendingStage) continue;
    try {
      const result = await readStageResult(stage);
      if (!result && !(await isStaleStage(stage, (await lstat(stage)).mtimeMs))) continue;
      await rm(stage, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup of stale staging dirs.
    }
  }
}

export async function readMacUpdateResult(
  userData: string,
): Promise<{ readonly version: string; readonly error: string | null } | null> {
  const pending = join(userData, "mac-update-pending.json");
  let pendingStage: string | undefined;
  try {
    const record = await readOptionalUpdateFile(pending);
    if (record === null) return null;
    const { stage: recordedStage, version } = JSON.parse(record) as {
      readonly stage: string;
      readonly version: string;
    };
    if (
      typeof recordedStage !== "string" ||
      dirname(resolve(recordedStage)) !== resolve(userData) ||
      !STAGING_NAME.test(basename(recordedStage))
    ) {
      throw new Error("Invalid pending Mac update path.");
    }
    const stage = resolve(recordedStage);
    pendingStage = stage;
    const stat = await lstat(stage).catch((error: unknown) => {
      if (isFileMissingError(error)) return null;
      throw error;
    });
    if (stat && !stat.isDirectory()) {
      throw new Error("Invalid pending Mac update directory.");
    }
    let result = stat ? await readStageResult(stage) : null;
    const mayBeRunning =
      stat !== null && result === null && !(await isStaleStage(stage, stat.mtimeMs));
    if (mayBeRunning) {
      for (let attempt = 0; result === null && attempt < 130; attempt++) {
        await sleep(500);
        result = await readStageResult(stage);
      }
    }
    const log = stat ? ((await readOptionalUpdateFile(join(stage, "helper.log"))) ?? "") : "";
    const outcome = result ?? "incomplete";
    if (result || !mayBeRunning) {
      await rm(pending, { force: true });
      pendingStage = undefined;
      if (stat) {
        await rm(stage, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    return {
      version,
      error:
        result === "success"
          ? null
          : `Previous Mac update ${outcome}. ${log.trim() || "The helper did not finish."}`,
    };
  } finally {
    await cleanMacUpdateStages(userData, pendingStage).catch(() => undefined);
  }
}
