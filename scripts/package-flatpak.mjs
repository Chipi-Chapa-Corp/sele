// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { packageFlatpakBundle } from "./package-flatpak-bundle.mjs";

const { spawnSync } = NodeChildProcess;
const { access, copyFile, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } = NodeFSP;
const { tmpdir } = NodeOS;
const { dirname, join, resolve } = NodePath;
const { fileURLToPath } = NodeURL;

const APP_ID = "com.chipichapa.sele";
const REPO_URL = "https://chipi-chapa-corp.github.io/sele/flatpak";
const RUNTIME = "org.freedesktop.Platform";
const RUNTIME_VERSION = "25.08";
const SDK = "org.freedesktop.Sdk";
const BASE = "org.electronjs.Electron2.BaseApp";
const BASE_VERSION = "25.08";
const BRANCH = "stable";
const FINISH_ARGS = [
  "--socket=wayland",
  "--socket=fallback-x11",
  "--share=ipc",
  "--device=dri",
  "--share=network",
  "--filesystem=host",
  "--talk-name=org.freedesktop.Flatpak",
];

function resizePng(sourcePng, targetPng, size) {
  for (const command of ["magick", "convert"]) {
    const result = spawnSync(command, [sourcePng, "-resize", `${size}x${size}`, targetPng], {
      stdio: "inherit",
    });
    if (result.status === 0) return;
  }
  throw new Error(`Failed to resize ${sourcePng} to ${size}x${size} using magick or convert`);
}

export async function packageFlatpak({
  appDirectory = "release/linux-unpacked",
  bundlePath = "release/sele-linux-x64.flatpak",
  pagesRoot = "release/flatpak-pages",
  repositoryOnly = false,
} = {}) {
  await access(join(appDirectory, "sele"));
  await access(join(appDirectory, "resources/app.asar"));

  const desktopManifest = JSON.parse(await readFile("apps/desktop/package.json", "utf8"));
  const iconSource = resolve("assets/prod/black-universal-1024.png");
  const stage = await mkdtemp(join(tmpdir(), "sele-flatpak-"));
  const buildDirectory = join(stage, "build");
  const files = join(buildDirectory, "files");
  const repository = resolve(pagesRoot, "flatpak");

  const run = (args) => {
    const started = performance.now();
    console.log(`Flatpak: ${args[0]}`);
    const result = spawnSync("flatpak", args, { stdio: "inherit" });
    if (result.status !== 0) throw result.error ?? new Error(`flatpak ${args[0]} failed`);
    console.log(
      `Flatpak: ${args[0]} finished in ${((performance.now() - started) / 1000).toFixed(1)}s`,
    );
  };

  try {
    run([
      "build-init",
      "--arch=x86_64",
      `--base=${BASE}`,
      `--base-version=${BASE_VERSION}`,
      buildDirectory,
      APP_ID,
      SDK,
      RUNTIME,
      RUNTIME_VERSION,
    ]);
    await mkdir(join(files, "bin"), { recursive: true });
    await mkdir(join(files, "share/applications"), { recursive: true });
    await writeFile(
      join(files, "bin/electron-wrapper"),
      `#!/bin/sh
export TMPDIR="$XDG_RUNTIME_DIR/app/$FLATPAK_ID"
if [ "\${XDG_SESSION_TYPE}" = wayland ]; then
  exec zypak-wrapper sele --enable-features=UseOzonePlatform --ozone-platform=wayland "$@"
else
  exec zypak-wrapper sele "$@"
fi
`,
      { mode: 0o755 },
    );
    await writeFile(
      join(files, "share/applications", `${APP_ID}.desktop`),
      `[Desktop Entry]
Name=Sele
Comment=Desktop workspace for AI coding agents
Exec=electron-wrapper %U
Terminal=false
Type=Application
Icon=${APP_ID}
Categories=Development;
StartupWMClass=${APP_ID}
`,
    );
    for (const size of [16, 32, 48, 64, 128, 256, 512]) {
      const icons = join(files, "share/icons/hicolor", `${size}x${size}`, "apps");
      await mkdir(icons, { recursive: true });
      resizePng(iconSource, join(icons, `${APP_ID}.png`), size);
    }
    await cp(resolve(appDirectory), join(files, "lib", APP_ID), {
      recursive: true,
      verbatimSymlinks: true,
    });
    await symlink(`/app/lib/${APP_ID}/sele`, join(files, "bin/sele"));
    for (const [source, destination] of [
      [
        "apps/desktop/resources/linux/com.chipichapa.sele.metainfo.xml",
        `share/metainfo/${APP_ID}.metainfo.xml`,
      ],
      ["LICENSE", `share/licenses/${APP_ID}/LICENSE`],
    ]) {
      const target = join(files, destination);
      await mkdir(dirname(target), { recursive: true });
      await cp(source, target, { recursive: true });
    }
    run([
      "build",
      "--die-with-parent",
      buildDirectory,
      "appstreamcli",
      "compose",
      "--prefix=/",
      `--origin=${APP_ID}`,
      "--result-root=/app",
      "--data-dir=/app/share/app-info/xmls",
      "--icons-dir=/app/share/app-info/icons/flatpak",
      `--components=${APP_ID},${APP_ID}.desktop`,
      "/app",
    ]);
    run(["build-finish", "--command=electron-wrapper", ...FINISH_ARGS, buildDirectory]);
    await mkdir(pagesRoot, { recursive: true });
    run(["build-export", "--arch=x86_64", repository, buildDirectory, BRANCH]);
    run([
      "build-update-repo",
      "--title=Sele",
      "--comment=Stable releases of Sele",
      "--description=Stable Flatpak releases of the Sele desktop workspace for AI coding agents",
      "--homepage=https://github.com/Chipi-Chapa-Corp/sele",
      `--icon=${REPO_URL}/sele.png`,
      `--default-branch=${BRANCH}`,
      "--generate-static-deltas",
      repository,
    ]);
    await copyFile(
      "apps/desktop/resources/linux/sele.flatpakrepo",
      join(repository, "sele.flatpakrepo"),
    );
    await copyFile(
      "apps/desktop/resources/linux/sele.flatpakref",
      join(repository, "sele.flatpakref"),
    );
    resizePng(iconSource, join(repository, "sele.png"), 512);
    await copyFile(
      "apps/desktop/resources/linux/sele.flatpakrepo",
      resolve(bundlePath, "..", "sele.flatpakrepo"),
    );
    await copyFile(
      "apps/desktop/resources/linux/sele.flatpakref",
      resolve(bundlePath, "..", "sele.flatpakref"),
    );
    await writeFile(
      join(repository, "sele-build.json"),
      JSON.stringify({
        version: desktopManifest.version,
        appId: APP_ID,
        arch: "x86_64",
        branch: BRANCH,
        repoUrl: REPO_URL,
      }),
    );
    await writeFile(join(pagesRoot, ".nojekyll"), "");
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  if (!repositoryOnly) await packageFlatpakBundle({ repository, bundlePath });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const [appDirectory, bundlePath, pagesRoot] = args.filter((arg) => arg !== "--repository-only");
  await packageFlatpak({
    appDirectory,
    bundlePath,
    pagesRoot,
    repositoryOnly: args.includes("--repository-only"),
  });
}
