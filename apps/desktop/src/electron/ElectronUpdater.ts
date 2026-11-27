// @effect-diagnostics nodeBuiltinImport:off
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as Electron from "electron";
import { AppImageUpdater, autoUpdater } from "electron-updater";

import {
  checkMacUpdate,
  downloadAndStageMacUpdate,
  installStagedMacUpdate,
  readMacUpdateResult,
  type MacUpdate,
  type StagedMacUpdate,
} from "../updates/macAppUpdate.ts";
import { DEFAULT_RELEASE_OWNER, DEFAULT_RELEASE_REPO } from "../updates/platformRelease.ts";

type AutoUpdater = typeof autoUpdater;
type SpawnLog = (cmd: string, args?: Array<string>, ...rest: Array<unknown>) => Promise<boolean>;

// Electron holds the AppImage runtime's keepalive pipe and some files without O_CLOEXEC; a
// relaunched AppImage inherits them, so old runtimes and FUSE mounts never exit. bash (AppRun
// already needs it; dash cannot close multi-digit fds) closes them before exec'ing the AppImage.
// -p skips BASH_ENV and exported functions in the helper only; the AppImage still receives both.
const CLOSE_INHERITED_FDS_THEN_EXEC =
  'for fd in /proc/self/fd/*; do fd=${fd##*/}; case $fd in *[!0-9]*|[012]) ;; *) eval "exec $fd>&-" ;; esac; done; exec "$@"';

const relaunchWithoutInheritedDescriptors = (updater: AppImageUpdater) => {
  const spawnLog = (AppImageUpdater.prototype as unknown as { spawnLog: SpawnLog }).spawnLog;
  (updater as unknown as { spawnLog: SpawnLog }).spawnLog = function (cmd, args = [], ...rest) {
    return spawnLog.call(
      this,
      "bash",
      ["-p", "-c", CLOSE_INHERITED_FDS_THEN_EXEC, cmd, cmd, ...args],
      ...rest,
    );
  };
};

export type ElectronUpdaterFeedUrl = Parameters<AutoUpdater["setFeedURL"]>[0];

export class ElectronUpdaterCheckForUpdatesError extends Schema.TaggedError<ElectronUpdaterCheckForUpdatesError>()(
  "ElectronUpdaterCheckForUpdatesError",
  {
    channel: Schema.NullOr(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Electron updater failed to check for updates on channel ${this.channel ?? "default"}.`;
  }
}

export class ElectronUpdaterDownloadUpdateError extends Schema.TaggedError<ElectronUpdaterDownloadUpdateError>()(
  "ElectronUpdaterDownloadUpdateError",
  {
    channel: Schema.NullOr(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Electron updater failed to download the update on channel ${this.channel ?? "default"}.`;
  }
}

export class ElectronUpdaterQuitAndInstallError extends Schema.TaggedError<ElectronUpdaterQuitAndInstallError>()(
  "ElectronUpdaterQuitAndInstallError",
  {
    channel: Schema.NullOr(Schema.String),
    isSilent: Schema.Boolean,
    isForceRunAfter: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Electron updater failed to quit and install the update on channel ${this.channel ?? "default"} (silent: ${this.isSilent}, force run after: ${this.isForceRunAfter}).`;
  }
}

export const ElectronUpdaterError = Schema.Union([
  ElectronUpdaterCheckForUpdatesError,
  ElectronUpdaterDownloadUpdateError,
  ElectronUpdaterQuitAndInstallError,
]);
export type ElectronUpdaterError = typeof ElectronUpdaterError.Type;

export class ElectronUpdater extends Context.Service<
  ElectronUpdater,
  {
    readonly setFeedURL: (options: ElectronUpdaterFeedUrl) => Effect.Effect<void>;
    readonly setAutoDownload: (value: boolean) => Effect.Effect<void>;
    readonly setAutoInstallOnAppQuit: (value: boolean) => Effect.Effect<void>;
    readonly setChannel: (channel: string) => Effect.Effect<void>;
    readonly setAllowPrerelease: (value: boolean) => Effect.Effect<void>;
    readonly allowDowngrade: Effect.Effect<boolean>;
    readonly setAllowDowngrade: (value: boolean) => Effect.Effect<void>;
    readonly setFullChangelog: (value: boolean) => Effect.Effect<void>;
    readonly setDisableDifferentialDownload: (value: boolean) => Effect.Effect<void>;
    readonly checkForUpdates: Effect.Effect<void, ElectronUpdaterCheckForUpdatesError>;
    readonly downloadUpdate: Effect.Effect<void, ElectronUpdaterDownloadUpdateError>;
    readonly quitAndInstall: (options: {
      readonly isSilent: boolean;
      readonly isForceRunAfter: boolean;
    }) => Effect.Effect<void, ElectronUpdaterQuitAndInstallError>;
    readonly on: <Args extends ReadonlyArray<unknown>>(
      eventName: string,
      listener: (...args: Args) => void,
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("@t3tools/desktop/electron/ElectronUpdater") {}

function readGitHubRepoFromAppUpdateYml(): { readonly owner: string; readonly repo: string } {
  try {
    const raw = NodeFS.readFileSync(NodePath.join(process.resourcesPath, "app-update.yml"), "utf8");
    const owner = /^owner:\s*(.+)$/m.exec(raw)?.[1]?.trim();
    const repo = /^repo:\s*(.+)$/m.exec(raw)?.[1]?.trim();
    if (owner && repo) return { owner, repo };
  } catch {
    // Fall back to default Sele repository.
  }
  return { owner: DEFAULT_RELEASE_OWNER, repo: DEFAULT_RELEASE_REPO };
}

const customEvents = new NodeEvents.EventEmitter();
let customFeedOverride = false;
let macCleanupDone = false;
let pendingMacUpdate: MacUpdate | null = null;
let stagedMacUpdate: StagedMacUpdate | null = null;

function useUnsignedMacUpdater(): boolean {
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Imperative Electron autoUpdater adapter outside Effect.
  return !customFeedOverride && process.platform === "darwin" && Electron.app?.isPackaged === true;
}

/** @public */
export const make = ElectronUpdater.of({
  setFeedURL: Effect.fn("ElectronUpdater.setFeedURL")(function (options) {
    return Effect.suspend(() => {
      customFeedOverride =
        typeof options === "object" && options !== null && "provider" in options
          ? options.provider !== "github"
          : true;
      autoUpdater.setFeedURL(options);
      return Effect.void;
    });
  }),
  setAutoDownload: Effect.fn("ElectronUpdater.setAutoDownload")(function (value) {
    return Effect.suspend(() => {
      autoUpdater.autoDownload = value;
      return Effect.void;
    });
  }),
  setAutoInstallOnAppQuit: Effect.fn("ElectronUpdater.setAutoInstallOnAppQuit")(function (value) {
    return Effect.suspend(() => {
      autoUpdater.autoInstallOnAppQuit = value;
      return Effect.void;
    });
  }),
  setChannel: Effect.fn("ElectronUpdater.setChannel")(function (channel) {
    return Effect.suspend(() => {
      autoUpdater.channel = channel;
      return Effect.void;
    });
  }),
  setAllowPrerelease: Effect.fn("ElectronUpdater.setAllowPrerelease")(function (value) {
    return Effect.suspend(() => {
      autoUpdater.allowPrerelease = value;
      return Effect.void;
    });
  }),
  allowDowngrade: Effect.sync(() => autoUpdater.allowDowngrade),
  setAllowDowngrade: Effect.fn("ElectronUpdater.setAllowDowngrade")(function (value) {
    return Effect.suspend(() => {
      autoUpdater.allowDowngrade = value;
      return Effect.void;
    });
  }),
  setFullChangelog: Effect.fn("ElectronUpdater.setFullChangelog")(function (value) {
    return Effect.suspend(() => {
      autoUpdater.fullChangelog = value;
      return Effect.void;
    });
  }),
  setDisableDifferentialDownload: Effect.fn("ElectronUpdater.setDisableDifferentialDownload")(
    function (value) {
      return Effect.suspend(() => {
        autoUpdater.disableDifferentialDownload = value;
        return Effect.void;
      });
    },
  ),
  checkForUpdates: Effect.suspend(() => {
    const channel = autoUpdater.channel;
    if (useUnsignedMacUpdater()) {
      return Effect.tryPromise({
        try: async () => {
          if (!macCleanupDone) {
            macCleanupDone = true;
            await readMacUpdateResult(Electron.app.getPath("userData")).catch(() => undefined);
          }
          customEvents.emit("checking-for-update");
          const { owner, repo } = readGitHubRepoFromAppUpdateYml();
          const arch =
            // oxlint-disable-next-line t3code/no-global-process-runtime -- Imperative Electron autoUpdater adapter outside Effect.
            Electron.app.runningUnderARM64Translation === true ? "arm64" : process.arch;
          const update = await checkMacUpdate({
            current: Electron.app.getVersion(),
            arch,
            owner,
            repo,
            allowPrerelease: autoUpdater.allowPrerelease,
            allowDowngrade: autoUpdater.allowDowngrade,
          });
          pendingMacUpdate = update;
          if (update) {
            customEvents.emit("update-available", {
              version: update.version,
              releaseNotes: update.releaseNotes,
              releaseName: update.releaseName ?? null,
              releaseDate: update.releaseDate,
            });
          } else {
            customEvents.emit("update-not-available");
          }
        },
        catch: (cause) => new ElectronUpdaterCheckForUpdatesError({ channel, cause }),
      });
    }
    return Effect.tryPromise({
      try: () => autoUpdater.checkForUpdates(),
      catch: (cause) => new ElectronUpdaterCheckForUpdatesError({ channel, cause }),
    }).pipe(Effect.asVoid);
  }),
  downloadUpdate: Effect.suspend(() => {
    const channel = autoUpdater.channel;
    if (useUnsignedMacUpdater()) {
      return Effect.tryPromise({
        try: async () => {
          const update = pendingMacUpdate;
          if (!update) {
            throw new Error("No macOS update is currently selected.");
          }
          const staged = await downloadAndStageMacUpdate({
            update,
            userData: Electron.app.getPath("userData"),
            progress: (percent) => {
              customEvents.emit("download-progress", { percent });
            },
          });
          stagedMacUpdate = staged;
          customEvents.emit("update-downloaded", {
            version: staged.update.version,
            downloadedFile: staged.archive,
          });
        },
        catch: (cause) => new ElectronUpdaterDownloadUpdateError({ channel, cause }),
      });
    }
    return Effect.tryPromise({
      try: () => autoUpdater.downloadUpdate(),
      catch: (cause) => new ElectronUpdaterDownloadUpdateError({ channel, cause }),
    }).pipe(Effect.asVoid);
  }),
  quitAndInstall: Effect.fn("ElectronUpdater.quitAndInstall")(function ({
    isSilent,
    isForceRunAfter,
  }) {
    return Effect.suspend(() => {
      const channel = autoUpdater.channel;
      if (useUnsignedMacUpdater()) {
        return Effect.tryPromise({
          try: async () => {
            const staged = stagedMacUpdate;
            if (!staged) {
              throw new Error("No downloaded macOS update is ready to install.");
            }
            await installStagedMacUpdate({
              staged,
              executable: Electron.app.getPath("exe"),
              userData: Electron.app.getPath("userData"),
              quit: () => Electron.app.quit(),
            });
          },
          catch: (cause) =>
            new ElectronUpdaterQuitAndInstallError({
              channel,
              isSilent,
              isForceRunAfter,
              cause,
            }),
        });
      }
      if (autoUpdater instanceof AppImageUpdater) relaunchWithoutInheritedDescriptors(autoUpdater);
      return Effect.try({
        try: () => autoUpdater.quitAndInstall(isSilent, isForceRunAfter),
        catch: (cause) =>
          new ElectronUpdaterQuitAndInstallError({
            channel,
            isSilent,
            isForceRunAfter,
            cause,
          }),
      });
    });
  }),
  on: Effect.fn("ElectronUpdater.on")(function (eventName, listener) {
    const eventTarget = autoUpdater as unknown as {
      on: (eventName: string, listener: (...args: Array<unknown>) => void) => void;
      removeListener: (eventName: string, listener: (...args: Array<unknown>) => void) => void;
    };
    const untypedListener = listener as unknown as (...args: Array<unknown>) => void;
    return Effect.acquireRelease(
      Effect.sync(() => {
        eventTarget.on(eventName, untypedListener);
        customEvents.on(eventName, untypedListener);
      }),
      () =>
        Effect.sync(() => {
          eventTarget.removeListener(eventName, untypedListener);
          customEvents.removeListener(eventName, untypedListener);
        }),
    ).pipe(Effect.asVoid);
  }),
});

export const layer = Layer.succeed(ElectronUpdater, make);
