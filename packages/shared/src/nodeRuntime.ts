// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { isRunningInFlatpak } from "./flatpak.ts";
import * as HostProcess from "./HostProcess.ts";
import { CommandResolutionCache, resolveCommandPath } from "./shell.ts";

const NodeRuntimeFeature = Schema.Literals([
  "Local device support",
  "Device automation",
  "Antigravity",
  "Antigravity sign-in",
]);

export const nodeRuntimeUnavailableMessage = (feature: typeof NodeRuntimeFeature.Type): string =>
  `${feature} requires Node.js. Install Node.js and make sure node is on PATH, then retry.`;

export class NodeRuntimeUnavailableError extends Schema.TaggedError<NodeRuntimeUnavailableError>()(
  "NodeRuntimeUnavailableError",
  { feature: NodeRuntimeFeature, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return nodeRuntimeUnavailableMessage(this.feature);
  }
}

export interface SelfInvocation {
  readonly command: string;
  /** Absolute script entrypoint; undefined for packaged binaries, which dispatch subcommands from argv[2]. */
  readonly entrypoint: string | undefined;
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;

function ensureFlatpakSelfShim(input: {
  readonly command: string;
  readonly entrypoint: string | undefined;
  readonly flatpakId: string;
  readonly shimPath: string;
}): string | undefined {
  const entryArg = input.entrypoint === undefined ? "" : ` ${shellQuote(input.entrypoint)}`;
  const content = [
    "#!/bin/sh",
    'if [ -n "${FLATPAK_ID:-}" ]; then',
    `  exec ${shellQuote(input.command)}${entryArg} "$@"`,
    "fi",
    `exec flatpak run --env=ELECTRON_RUN_AS_NODE=1 --command=${shellQuote(input.command)} ${shellQuote(input.flatpakId)}${entryArg} "$@"`,
    "",
  ].join("\n");
  try {
    const existing = NodeFS.existsSync(input.shimPath)
      ? NodeFS.readFileSync(input.shimPath, "utf8")
      : undefined;
    if (existing !== content) {
      NodeFS.mkdirSync(input.shimPath.slice(0, input.shimPath.lastIndexOf("/")), {
        recursive: true,
      });
      const staging = `${input.shimPath}.${process.pid}.tmp`;
      NodeFS.writeFileSync(staging, content, { mode: 0o755 });
      NodeFS.renameSync(staging, input.shimPath);
    }
    return input.shimPath;
  } catch {
    return undefined;
  }
}

/** Packaged binaries repeat the binary at argv[1]; callers must not assemble execPath/argv[1] themselves. */
export const resolveSelfInvocation = Effect.fn("nodeRuntime.resolveSelfInvocation")(function* () {
  const command = yield* HostProcess.ExecutablePath;
  const isExecutable = yield* HostProcess.IsExecutable;
  const path = yield* Path.Path;
  const entry = isExecutable ? undefined : (yield* HostProcess.Arguments)[1];
  // Children spawn from their own working directory, so the script path must be absolute.
  const entrypoint = entry === undefined ? undefined : path.resolve(entry);
  const platform = yield* HostProcess.Platform;
  const env = yield* HostProcess.Environment;
  if (isRunningInFlatpak(env, platform)) {
    const flatpakId = env.FLATPAK_ID!.trim();
    const home = yield* HostProcess.HomeDirectory;
    const baseDir = env.T3CODE_HOME?.trim() || path.join(home, ".t3");
    const shimPath = ensureFlatpakSelfShim({
      command,
      entrypoint,
      flatpakId,
      shimPath: path.join(baseDir, "bin", "flatpak-self"),
    });
    if (shimPath !== undefined) {
      return { command: shimPath, entrypoint: undefined } satisfies SelfInvocation;
    }
  }
  return { command, entrypoint } satisfies SelfInvocation;
});

export const selfInvocationArgs = (
  invocation: SelfInvocation,
  args: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  invocation.entrypoint === undefined ? args : [invocation.entrypoint, ...args];

export const resolveNodeExecutable = Effect.fn("nodeRuntime.resolveNodeExecutable")(function* (
  feature: typeof NodeRuntimeFeature.Type,
  environment?: NodeJS.ProcessEnv,
) {
  const executablePath = yield* HostProcess.ExecutablePath;
  if (!(yield* HostProcess.IsExecutable)) return executablePath;

  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const env = environment ?? (yield* HostProcess.Environment);
  const resolvedNodePath = yield* resolveCommandPath(platform === "win32" ? "node.exe" : "node", {
    env: platform === "win32" ? { ...env, PATHEXT: ".EXE" } : env,
  }).pipe(Effect.provideService(CommandResolutionCache, new Map()));
  if (resolvedNodePath === null) return yield* new NodeRuntimeUnavailableError({ feature });
  const nodePath = path.resolve(resolvedNodePath);
  const resolvedPath = yield* fs
    .realPath(nodePath)
    .pipe(Effect.mapError((cause) => new NodeRuntimeUnavailableError({ feature, cause })));
  if (resolvedPath === executablePath) return yield* new NodeRuntimeUnavailableError({ feature });
  const [hostInfo, nodeInfo] = yield* Effect.all([
    fs.stat(executablePath).pipe(Effect.option),
    fs.stat(nodePath).pipe(Effect.option),
  ]);
  if (
    Option.isSome(hostInfo) &&
    Option.isSome(nodeInfo) &&
    hostInfo.value.dev === nodeInfo.value.dev &&
    Option.isSome(hostInfo.value.ino) &&
    Option.isSome(nodeInfo.value.ino) &&
    hostInfo.value.ino.value > 0n &&
    hostInfo.value.ino.value === nodeInfo.value.ino.value
  ) {
    return yield* new NodeRuntimeUnavailableError({ feature });
  }
  // Launchers such as Vite+ dispatch by argv[0]; keep the node name intact.
  return nodePath;
});
