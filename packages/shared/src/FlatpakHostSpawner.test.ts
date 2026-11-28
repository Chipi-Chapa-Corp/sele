import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as FlatpakHostSpawner from "./FlatpakHostSpawner.ts";
import * as HostProcess from "./HostProcess.ts";

const makeRecordingSpawner = () => {
  const recorded: Array<ChildProcess.StandardCommand> = [];
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.sync(() => {
      if (command._tag === "StandardCommand") {
        recorded.push(command);
      }
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      });
    }),
  );
  return { recorded, spawner };
};

it.layer(NodeServices.layer)("FlatpakHostSpawner", (it) => {
  it.effect("passes commands through unchanged outside Flatpak", () =>
    Effect.gen(function* () {
      const { recorded, spawner } = makeRecordingSpawner();
      const wrapped = FlatpakHostSpawner.layer.pipe(
        Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
        Layer.provide(Layer.succeed(HostProcess.Platform, "linux")),
        Layer.provide(Layer.succeed(HostProcess.Environment, { PATH: "/usr/bin" })),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const active = yield* ChildProcessSpawner.ChildProcessSpawner;
          yield* active.spawn(ChildProcess.make("git", ["status"]));
        }),
      ).pipe(Effect.provide(wrapped));

      expect(recorded).toHaveLength(1);
      expect(recorded[0]!.command).toBe("git");
      expect(recorded[0]!.args).toEqual(["status"]);
    }),
  );

  it.effect(
    "routes host commands through flatpak-spawn --host and keeps sandbox self-spawns local",
    () =>
      Effect.gen(function* () {
        const { recorded, spawner } = makeRecordingSpawner();
        const wrapped = FlatpakHostSpawner.layer.pipe(
          Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
          Layer.provide(Layer.succeed(HostProcess.Platform, "linux")),
          Layer.provide(
            Layer.succeed(HostProcess.Environment, {
              FLATPAK_ID: "com.chipichapa.sele",
              PATH: "/home/alice/.local/bin:/usr/bin",
            }),
          ),
          Layer.provide(
            Layer.succeed(HostProcess.ExecutablePath, "/app/lib/com.chipichapa.sele/sele"),
          ),
        );

        yield* Effect.scoped(
          Effect.gen(function* () {
            const active = yield* ChildProcessSpawner.ChildProcessSpawner;
            yield* active.spawn(
              ChildProcess.make("/app/lib/com.chipichapa.sele/sele", ["__process-launcher"]),
            );
            yield* active.spawn(
              ChildProcess.make("git", ["rev-parse", "HEAD"], {
                cwd: "/tmp",
                env: { GIT_TERMINAL_PROMPT: "0" },
                extendEnv: true,
              }),
            );
            yield* active.spawn(ChildProcess.make("echo hello", [], { shell: true }));
          }),
        ).pipe(Effect.provide(wrapped));

        expect(recorded).toHaveLength(3);
        expect(recorded[0]!.command).toBe("/app/lib/com.chipichapa.sele/sele");
        expect(recorded[0]!.args).toEqual(["__process-launcher"]);

        expect(recorded[1]!.command).toBe("flatpak-spawn");
        expect(recorded[1]!.args).toContain("--host");
        expect(recorded[1]!.args).toContain("--watch-bus");
        expect(recorded[1]!.args).toContain("--directory=/tmp");
        expect(recorded[1]!.args).toContain("--env=GIT_TERMINAL_PROMPT=0");
        expect(recorded[1]!.args.slice(-4)).toEqual(["--", "git", "rev-parse", "HEAD"]);
        expect(recorded[1]!.options.cwd).toBeUndefined();

        expect(recorded[2]!.command).toBe("flatpak-spawn");
        expect(recorded[2]!.args.slice(-4)).toEqual(["--", "/bin/sh", "-c", "echo hello"]);
        expect(recorded[2]!.options.shell).toBe(false);
      }),
  );
});
