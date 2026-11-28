// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  buildFlatpakHostSpawn,
  checkFlatpakHostExecutable,
  FLATPAK_SANDBOX_PATH_ENV,
  isRunningInFlatpak,
  isUninspectableFlatpakHostPath,
  mapToFlatpakHostFilesystemPath,
  normalizeFlatpakHostEnv,
  readFlatpakHostLoginShell,
  resolveFlatpakHostAccessiblePath,
  sanitizeFlatpakHostPathValue,
  shouldRunInsideFlatpakSandbox,
} from "./flatpak.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
});

const makeTempDir = () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-flatpak-test-"));
  tempDirs.push(dir);
  return dir;
};

describe("flatpak host helpers", () => {
  it("detects Flatpak only on Linux when FLATPAK_ID is set", () => {
    expect(isRunningInFlatpak({ FLATPAK_ID: "com.chipichapa.sele" }, "linux")).toBe(true);
    expect(isRunningInFlatpak({ FLATPAK_ID: "   " }, "linux")).toBe(false);
    expect(isRunningInFlatpak({}, "linux")).toBe(false);
    expect(isRunningInFlatpak({ FLATPAK_ID: "com.chipichapa.sele" }, "darwin")).toBe(false);
  });

  it("reads the host login shell from a host passwd file", () => {
    const dir = makeTempDir();
    const passwdPath = NodePath.join(dir, "passwd");
    NodeFS.writeFileSync(
      passwdPath,
      ["root:x:0:0:root:/root:/bin/bash", "kitkat:x:1000:1000:User:/home/kitkat:/usr/bin/zsh"].join(
        "\n",
      ),
    );

    expect(readFlatpakHostLoginShell({ passwdPath, uid: 1000 })).toBe("/usr/bin/zsh");
    expect(readFlatpakHostLoginShell({ passwdPath, username: "kitkat" })).toBe("/usr/bin/zsh");
    expect(readFlatpakHostLoginShell({ passwdPath, uid: 9999 })).toBeUndefined();
  });

  it("normalizes sandbox XDG directories and /bin/sh SHELL to the host values", () => {
    const env: NodeJS.ProcessEnv = {
      FLATPAK_ID: "com.chipichapa.sele",
      HOME: "/home/alice",
      PATH: "/app/bin:/usr/bin",
      SHELL: "/bin/sh",
      XDG_CONFIG_HOME: "/home/alice/.var/app/com.chipichapa.sele/config",
      XDG_DATA_HOME: "/home/alice/.var/app/com.chipichapa.sele/data",
      XDG_STATE_HOME: "/home/alice/.var/app/com.chipichapa.sele/state",
      XDG_CACHE_HOME: "/home/alice/.var/app/com.chipichapa.sele/cache",
      HOST_XDG_CONFIG_HOME: "/home/alice/.custom-config",
    };

    expect(
      normalizeFlatpakHostEnv(env, {
        platform: "linux",
        homeDirectory: "/home/alice",
        hostLoginShell: "/usr/bin/fish",
      }),
    ).toBe(true);

    expect(env[FLATPAK_SANDBOX_PATH_ENV]).toBe("/app/bin:/usr/bin");
    expect(env.XDG_CONFIG_HOME).toBe("/home/alice/.custom-config");
    expect(env.XDG_DATA_HOME).toBe("/home/alice/.local/share");
    expect(env.XDG_STATE_HOME).toBe("/home/alice/.local/state");
    expect(env.XDG_CACHE_HOME).toBe("/home/alice/.cache");
    expect(env.SHELL).toBe("/usr/bin/fish");
  });

  it("maps runtime-shadowed root prefixes to /run/host and resolves absolute symlinks", () => {
    const hostRoot = makeTempDir();
    NodeFS.mkdirSync(NodePath.join(hostRoot, "usr/bin"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(hostRoot, "etc/alternatives"), { recursive: true });
    const realBin = NodePath.join(hostRoot, "usr/bin/real-git");
    NodeFS.writeFileSync(realBin, "#!/bin/sh\n", { mode: 0o755 });
    NodeFS.symlinkSync("/usr/bin/real-git", NodePath.join(hostRoot, "etc/alternatives/git"));
    NodeFS.symlinkSync("/etc/alternatives/git", NodePath.join(hostRoot, "usr/bin/git"));

    expect(mapToFlatpakHostFilesystemPath("/usr/bin/git", hostRoot)).toBe(
      `${hostRoot}/usr/bin/git`,
    );
    expect(mapToFlatpakHostFilesystemPath("/home/alice/.local/bin/claude", hostRoot)).toBe(
      "/home/alice/.local/bin/claude",
    );
    expect(resolveFlatpakHostAccessiblePath("/usr/bin/git", hostRoot)).toBe(realBin);
    expect(checkFlatpakHostExecutable("/usr/bin/git", hostRoot)).toBe("ok");
    expect(checkFlatpakHostExecutable("/usr/bin/missing-cli", hostRoot)).toBe("enoent");
    expect(isUninspectableFlatpakHostPath("/run/current-system/sw/bin")).toBe(true);
    expect(isUninspectableFlatpakHostPath("/run/host/usr/bin")).toBe(false);
  });

  it("keeps internal sandbox binaries inside the sandbox and routes host tools out", () => {
    expect(
      shouldRunInsideFlatpakSandbox(
        "/app/lib/com.chipichapa.sele/sele",
        "/app/lib/com.chipichapa.sele/sele",
      ),
    ).toBe(true);
    expect(shouldRunInsideFlatpakSandbox("/app/bin/sele", "/usr/bin/node")).toBe(true);
    expect(shouldRunInsideFlatpakSandbox("flatpak-spawn", "/usr/bin/node")).toBe(true);
    expect(shouldRunInsideFlatpakSandbox("/usr/bin/flatpak-spawn", "/usr/bin/node")).toBe(true);
    expect(shouldRunInsideFlatpakSandbox("git", "/app/lib/com.chipichapa.sele/sele")).toBe(false);
    expect(shouldRunInsideFlatpakSandbox("/usr/bin/zsh", "/app/lib/com.chipichapa.sele/sele")).toBe(
      false,
    );
  });

  it("sanitizes sandbox PATH values and filters sandbox-only env vars when building host spawns", () => {
    expect(sanitizeFlatpakHostPathValue("/app/bin:/usr/bin", "/app/bin:/usr/bin")).toBeUndefined();
    expect(
      sanitizeFlatpakHostPathValue("/home/alice/.local/bin:/usr/bin:/app/bin", "/app/bin:/usr/bin"),
    ).toBe("/home/alice/.local/bin:/usr/bin");

    const sandboxEnv: NodeJS.ProcessEnv = {
      FLATPAK_ID: "com.chipichapa.sele",
      PATH: "/app/bin:/usr/bin",
      HOME: "/home/alice",
      XDG_CONFIG_HOME: "/home/alice/.var/app/com.chipichapa.sele/config",
      TMPDIR: "/run/user/1000/app/com.chipichapa.sele",
      LD_LIBRARY_PATH: "/app/lib",
      ZYPAK_SANDBOX_FILENAME: "/app/bin/zypak",
    };

    const result = buildFlatpakHostSpawn({
      command: "git",
      args: ["status", "--env=literal"],
      cwd: "/home/alice/repo",
      sandboxEnv,
      forwardFds: [3, 4],
      env: {
        ...sandboxEnv,
        PATH: "/home/alice/.local/bin:/usr/bin:/app/bin",
        GIT_TERMINAL_PROMPT: "0",
        TERM: "xterm-256color",
        FORCE_CODE_TERMINAL: undefined,
        ELECTRON_RUN_AS_NODE: "1",
      },
    });

    expect(result.command).toBe("flatpak-spawn");
    expect(result.args).toContain("--host");
    expect(result.args).toContain("--watch-bus");
    expect(result.args).toContain("--directory=/home/alice/repo");
    expect(result.args).toContain("--forward-fd=3");
    expect(result.args).toContain("--forward-fd=4");
    expect(result.args).toContain("--env=PATH=/home/alice/.local/bin:/usr/bin");
    expect(result.args).toContain("--env=GIT_TERMINAL_PROMPT=0");
    expect(result.args).toContain("--env=TERM=xterm-256color");
    expect(result.args).toContain("--unset-env=FORCE_CODE_TERMINAL");
    expect(result.args.some((arg) => arg.includes("FLATPAK_ID"))).toBe(false);
    expect(result.args.some((arg) => arg.includes("LD_LIBRARY_PATH"))).toBe(false);
    expect(result.args.some((arg) => arg.includes("ZYPAK_"))).toBe(false);
    expect(result.args.some((arg) => arg.includes("ELECTRON_RUN_AS_NODE"))).toBe(false);
    expect(result.args.some((arg) => arg.includes(".var/app/"))).toBe(false);
    expect(result.args.some((arg) => arg.includes("/run/user/1000/app/"))).toBe(false);
    expect(result.args.slice(-4)).toEqual(["--", "git", "status", "--env=literal"]);
  });
});
