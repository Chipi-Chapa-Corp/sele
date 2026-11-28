// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Redacted from "effect/Redacted";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as CommandLine from "effect/process/CommandLine";

import * as HostProcess from "./HostProcess.ts";
import {
  buildFlatpakHostSpawn,
  checkFlatpakHostExecutable,
  FLATPAK_HOST_DEFAULT_PATH,
  hasFlatpakHostRootMount,
  isRunningInFlatpak,
  isUninspectableFlatpakHostPath,
  mapToFlatpakHostFilesystemPath,
  resolveFlatpakHostAccessiblePath,
  sanitizeFlatpakHostPathValue,
  shouldRunInsideFlatpakSandbox,
} from "./flatpak.ts";

const unwrapRedacted = (
  value: string | Redacted.Redacted<string> | undefined,
): string | undefined =>
  value === undefined ? undefined : Redacted.isRedacted(value) ? Redacted.value(value) : value;

const unwrapEnv = (
  env: Readonly<Record<string, string | Redacted.Redacted<string> | undefined>> | undefined,
): Record<string, string | undefined> | undefined => {
  if (env === undefined) return undefined;
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    result[key] = unwrapRedacted(value);
  }
  return result;
};

const childSearchPath = (
  env: Record<string, string | undefined> | undefined,
  extendEnv: boolean | undefined,
  hostEnv: NodeJS.ProcessEnv,
): string => {
  const raw =
    env === undefined
      ? hostEnv.PATH
      : Object.hasOwn(env, "PATH")
        ? env.PATH
        : extendEnv === true
          ? hostEnv.PATH
          : undefined;
  const sanitized = sanitizeFlatpakHostPathValue(raw, hostEnv.T3CODE_FLATPAK_SANDBOX_PATH);
  return sanitized ? `${sanitized}:${FLATPAK_HOST_DEFAULT_PATH}` : FLATPAK_HOST_DEFAULT_PATH;
};

const spawnFailure = (command: ChildProcess.StandardCommand, code: "ENOENT" | "EACCES") => {
  const syscall = `spawn ${command.command}`;
  return PlatformError.systemError({
    _tag: code === "ENOENT" ? "NotFound" : "PermissionDenied",
    module: "ChildProcess",
    method: "spawn",
    pathOrDescriptor: CommandLine.display([command.command, ...command.args], { format: "posix" }),
    syscall,
    cause: Object.assign(new Error(`${syscall} ${code}`), {
      errno: code === "ENOENT" ? -2 : -13,
      code,
      syscall,
      path: command.command,
      spawnargs: command.args.map((arg) => (Redacted.isRedacted(arg) ? "<redacted>" : arg)),
    }),
  });
};

const cwdFailure = (cwd: string, cause: NodeJS.ErrnoException) =>
  PlatformError.systemError({
    _tag:
      cause.code === "ENOENT"
        ? "NotFound"
        : cause.code === "EACCES" || cause.code === "EPERM"
          ? "PermissionDenied"
          : cause.code === "ENOTDIR" || cause.code === "ELOOP"
            ? "BadResource"
            : "Unknown",
    module: "FileSystem",
    method: "access",
    pathOrDescriptor: cwd,
    syscall: cause.syscall,
    cause,
  });

const checkHostExecutable = (
  command: ChildProcess.StandardCommand,
  cwd: string | undefined,
  env: Record<string, string | undefined> | undefined,
  extendEnv: boolean | undefined,
  hostEnv: NodeJS.ProcessEnv,
): Effect.Effect<void, PlatformError.PlatformError> =>
  Effect.suspend(() => {
    if (!hasFlatpakHostRootMount()) return Effect.void;
    const fromCwd = (entry: string) =>
      cwd === undefined || entry.startsWith("/") ? entry : `${cwd}/${entry}`;

    if (command.command.includes("/")) {
      const target = fromCwd(command.command);
      if (isUninspectableFlatpakHostPath(target)) return Effect.void;
      const status = checkFlatpakHostExecutable(target);
      if (status === "ok") return Effect.void;
      return Effect.fail(spawnFailure(command, status === "eacces" ? "EACCES" : "ENOENT"));
    }

    const searchEntries = childSearchPath(env, extendEnv, hostEnv).split(":");
    let denied = false;
    let sawUninspectable = false;
    for (const rawEntry of searchEntries) {
      const dir = fromCwd(rawEntry || ".");
      if (isUninspectableFlatpakHostPath(dir)) {
        sawUninspectable = true;
        continue;
      }
      const candidate = `${dir}/${command.command}`;
      const status = checkFlatpakHostExecutable(candidate);
      if (status === "ok") return Effect.void;
      if (status === "eacces") denied = true;
    }
    if (sawUninspectable) return Effect.void;
    return Effect.fail(spawnFailure(command, denied ? "EACCES" : "ENOENT"));
  });

const checkHostCwd = (
  givenCwd: string,
  resolvedCwd: string,
): Effect.Effect<void, PlatformError.PlatformError> =>
  Effect.suspend(() => {
    if (!hasFlatpakHostRootMount() || isUninspectableFlatpakHostPath(resolvedCwd)) {
      return Effect.void;
    }
    const accessible =
      resolveFlatpakHostAccessiblePath(resolvedCwd) ?? mapToFlatpakHostFilesystemPath(resolvedCwd);
    try {
      NodeFS.accessSync(accessible, NodeFS.constants.F_OK);
      return Effect.void;
    } catch (error) {
      return Effect.fail(cwdFailure(givenCwd, error as NodeJS.ErrnoException));
    }
  });

const make = Effect.gen(function* () {
  const native = yield* ChildProcessSpawner.ChildProcessSpawner;
  const platform = yield* HostProcess.Platform;
  const hostEnv = yield* HostProcess.Environment;
  if (!isRunningInFlatpak(hostEnv, platform)) return native;

  const selfExecutablePath = yield* HostProcess.ExecutablePath;
  const path = yield* Path.Path;

  const prepareStandard = Effect.fnUntraced(function* (input: ChildProcess.StandardCommand) {
    const { cwd: givenCwd, shell, env: rawEnv, extendEnv, ...restOptions } = input.options;
    if ((shell && input.args.length > 0) || input.command.includes("\0")) return input;

    const command = shell
      ? ChildProcess.make(typeof shell === "string" ? shell : "/bin/sh", ["-c", input.command])
      : input;
    if (shouldRunInsideFlatpakSandbox(command.command, selfExecutablePath)) return input;

    const unwrappedEnv = unwrapEnv(rawEnv);
    const resolvedCwd = givenCwd === undefined ? undefined : path.resolve(givenCwd);
    if (givenCwd !== undefined && resolvedCwd !== undefined) {
      yield* checkHostCwd(givenCwd, resolvedCwd);
    }
    yield* checkHostExecutable(command, resolvedCwd, unwrappedEnv, extendEnv, hostEnv);

    const unwrappedArgs = command.args.map((arg) =>
      Redacted.isRedacted(arg) ? Redacted.value(arg) : arg,
    );
    const forwardFds = restOptions.additionalFds
      ? Object.keys(restOptions.additionalFds)
          .map((key) => Number(key.replace(/^fd/u, "")))
          .filter((fd) => Number.isInteger(fd) && fd >= 3)
      : undefined;

    const wrapped = buildFlatpakHostSpawn({
      command: command.command,
      args: unwrappedArgs,
      cwd: resolvedCwd,
      env: unwrappedEnv,
      extendEnv,
      ...(forwardFds && forwardFds.length > 0 ? { forwardFds } : {}),
    });

    return ChildProcess.make(wrapped.command, wrapped.args, {
      ...restOptions,
      env: wrapped.env,
      extendEnv: false,
      shell: false,
    });
  });

  const prepare = (
    command: ChildProcess.Command,
  ): Effect.Effect<ChildProcess.Command, PlatformError.PlatformError> =>
    command._tag === "StandardCommand"
      ? prepareStandard(command)
      : Effect.map(Effect.all([prepare(command.left), prepare(command.right)]), ([left, right]) =>
          ChildProcess.pipeTo(left, right, command.options),
        );

  return ChildProcessSpawner.make(
    Effect.fn("FlatpakHostSpawner.spawn")(function* (command) {
      return yield* native.spawn(yield* prepare(command));
    }),
  );
});

/**
 * Inside a Flatpak sandbox, routes host commands through `flatpak-spawn --host` while leaving
 * internal sandbox binaries (self-spawns, `/app/*`, and `flatpak-spawn` itself) untouched.
 */
export const layer = Layer.effect(ChildProcessSpawner.ChildProcessSpawner, make);
