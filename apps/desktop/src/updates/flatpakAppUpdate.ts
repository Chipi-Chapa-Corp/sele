// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeUtil from "node:util";

import { findLatestPlatformRelease, type ReleaseSelectionOptions } from "./platformRelease.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);

const FLATPAK_APP_ID = "com.chipichapa.sele";
const FLATPAK_INFO_PATH = "/.flatpak-info";

export interface FlatpakInstallInfo {
  readonly appPath: string;
  readonly arch: string;
  readonly branch: string;
  readonly appCommit: string;
  readonly instanceId: string;
  readonly scope: "--system" | "--user";
}

export interface FlatpakUpdateTarget {
  readonly version: string;
  readonly scope: "--system" | "--user";
  readonly ref: string;
  readonly commit: string;
  readonly instanceId: string;
  readonly releaseNotes?: string;
  readonly releaseName?: string | null;
  readonly releaseDate?: string;
}

export function isFlatpakRuntime(): boolean {
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Synchronous startup check outside Effect.
  return process.platform === "linux" && NodeFS.existsSync(FLATPAK_INFO_PATH);
}

export function parseFlatpakInfo(raw: string): FlatpakInstallInfo {
  const field = (name: string): string =>
    new RegExp(`^${name}=(.+)$`, "m").exec(raw)?.[1]?.trim() ?? "";
  const appPath = field("app-path");
  const scope = appPath.startsWith("/var/lib/flatpak/")
    ? ("--system" as const)
    : appPath.includes("/.local/share/flatpak/")
      ? ("--user" as const)
      : null;
  if (!scope) {
    throw new Error("This Flatpak installation must be updated with its package manager.");
  }
  const instanceId = field("instance-id");
  if (!/^\d+$/.test(instanceId)) {
    throw new Error("Unable to identify the running Flatpak instance.");
  }
  return {
    appPath,
    arch: field("arch"),
    branch: field("branch"),
    appCommit: field("app-commit"),
    instanceId,
    scope,
  };
}

async function runHostFlatpak(args: ReadonlyArray<string>, timeout = 30_000): Promise<string> {
  const result = await exec("flatpak-spawn", ["--host", "flatpak", ...args], {
    timeout,
    maxBuffer: 2 * 1024 * 1024,
  });
  return result.stdout.trim();
}

export async function checkFlatpakUpdate(input: {
  readonly current: string;
  readonly owner?: string;
  readonly repo?: string;
  readonly allowPrerelease?: boolean;
  readonly allowDowngrade?: boolean;
  readonly hostFlatpak?: (args: ReadonlyArray<string>, timeout?: number) => Promise<string>;
  readonly readFlatpakInfo?: () => Promise<string>;
  readonly fetchImpl?: typeof fetch;
}): Promise<FlatpakUpdateTarget | null> {
  const options: ReleaseSelectionOptions = {
    ...(input.owner !== undefined ? { owner: input.owner } : {}),
    ...(input.repo !== undefined ? { repo: input.repo } : {}),
    ...(input.allowPrerelease !== undefined ? { allowPrerelease: input.allowPrerelease } : {}),
    ...(input.allowDowngrade !== undefined ? { allowDowngrade: input.allowDowngrade } : {}),
  };
  const selected = await findLatestPlatformRelease(
    "linux-x64",
    input.current,
    options,
    input.fetchImpl,
  );
  if (!selected) return null;

  const infoRaw = await (
    input.readFlatpakInfo ?? (() => NodeFSP.readFile(FLATPAK_INFO_PATH, "utf8"))
  )();
  const info = parseFlatpakInfo(infoRaw);
  const host = input.hostFlatpak ?? runHostFlatpak;
  const ref = `app/${FLATPAK_APP_ID}/${info.arch}/${info.branch}`;
  const origin = await host(["info", info.scope, "--show-origin", ref]);
  const commit = await host(["remote-info", info.scope, "--show-commit", origin, ref]);
  if (!/^[a-f0-9]{64}$/.test(commit) || commit === info.appCommit) {
    return null;
  }

  return {
    version: selected.version,
    scope: info.scope,
    ref,
    commit,
    instanceId: info.instanceId,
    ...(typeof selected.release.body === "string" ? { releaseNotes: selected.release.body } : {}),
    ...(selected.release.name !== undefined ? { releaseName: selected.release.name } : {}),
    ...(typeof selected.release.published_at === "string"
      ? { releaseDate: selected.release.published_at }
      : {}),
  };
}

export async function downloadFlatpakUpdate(
  target: FlatpakUpdateTarget,
  hostFlatpak: (args: ReadonlyArray<string>, timeout?: number) => Promise<string> = runHostFlatpak,
): Promise<void> {
  await hostFlatpak(
    [
      "update",
      target.scope,
      "--assumeyes",
      "--noninteractive",
      `--commit=${target.commit}`,
      target.ref,
    ],
    15 * 60 * 1000,
  );
  const installed = await hostFlatpak(["info", target.scope, "--show-commit", target.ref]);
  if (installed !== target.commit) {
    throw new Error("Flatpak did not install the requested update.");
  }
}

export async function relaunchFlatpakAndQuit(
  target: FlatpakUpdateTarget,
  quit: () => void,
): Promise<void> {
  // The helper runs on the host and waits for this sandbox instance to exit before launching the updated app.
  const helper = NodeChildProcess.spawn(
    "flatpak-spawn",
    [
      "--host",
      "sh",
      "-c",
      'nohup sh -c \'while flatpak ps --columns=instance | grep -qx "$1"; do sleep 1; done; exec flatpak run "$2" "$3"\' sh "$1" "$2" "$3" >/dev/null 2>&1 </dev/null &',
      "sh",
      target.instanceId,
      target.scope,
      target.ref,
    ],
    { stdio: "ignore" },
  );
  await new Promise<void>((resolve, reject) => {
    helper.once("error", reject);
    helper.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Unable to schedule the Flatpak restart.")),
    );
  });
  quit();
}
