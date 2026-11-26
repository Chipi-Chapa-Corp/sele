// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const { spawnSync } = NodeChildProcess;
const { readdir, readFile } = NodeFSP;
const { resolve } = NodePath;
const { fileURLToPath } = NodeURL;

const desktopPlatforms = ["windows-x64", "macos-arm64", "linux-x64"];

export function releaseFiles(version, platform) {
  const channel = version.includes("-") ? version.split("-")[1].split(".")[0] : "latest";
  const files = {
    "windows-x64": [
      "sele-windows-x64-setup.exe",
      "sele-windows-x64-setup.exe.blockmap",
      `${channel}.yml`,
    ],
    "macos-arm64": [
      "sele-macos-arm64.dmg",
      `Sele-${version}-arm64-mac.zip`,
      `Sele-${version}-arm64-mac.zip.blockmap`,
      `${channel}-mac.yml`,
    ],
    "linux-x64": [
      "sele-linux-x64.tar.gz",
      "sele-linux-x64.flatpak",
      "sele.flatpakrepo",
      "sele.flatpakref",
    ],
  };
  if (platform === "legacy") return desktopPlatforms.flatMap((key) => files[key]);
  if (!files[platform]) throw new Error(`Unsupported release platform: ${platform}`);
  return files[platform];
}

export async function publishRelease(baseTag, platform, directory, run = command) {
  if (!/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(baseTag ?? "")) {
    throw new Error("Invalid release tag");
  }
  const version = baseTag.slice(1);
  const manifest = JSON.parse(await readFile("apps/desktop/package.json", "utf8"));
  if (version !== manifest.version) {
    throw new Error(
      `Release tag (${version}) does not match apps/desktop/package.json (${manifest.version})`,
    );
  }
  const files = releaseFiles(version, platform);
  const present = new Set(await readdir(directory));
  for (const file of files) {
    if (!present.has(file)) throw new Error(`Missing release asset: ${file}`);
  }
  const tag = platform === "legacy" ? baseTag : `${baseTag}-${platform}`;
  const title = platform === "legacy" ? `Sele ${version}` : `Sele ${version} — ${platform}`;
  const sha = run("git", ["rev-parse", "HEAD"]).trim();
  const current = run(
    "gh",
    ["api", "repos/{owner}/{repo}/releases/latest", "--jq", ".tag_name"],
    true,
  );
  const existing = run("gh", ["release", "view", tag, "--json", "isDraft"], true);

  if (existing === null) {
    run("gh", [
      "release",
      "create",
      tag,
      ...files.map((file) => resolve(directory, file)),
      "--target",
      sha,
      "--title",
      title,
      "--generate-notes",
      ...(current && current.trim() !== baseTag ? ["--notes-start-tag", current.trim()] : []),
      "--draft",
      "--latest=false",
      ...(version.includes("-") ? ["--prerelease"] : []),
    ]);
  } else {
    run("gh", [
      "release",
      "upload",
      tag,
      ...files.map((file) => resolve(directory, file)),
      "--clobber",
    ]);
  }

  let latest = false;
  if (platform === "legacy" && !version.includes("-")) {
    const parts = (value) =>
      /^v?(\d+)\.(\d+)\.(\d+)$/
        .exec(value?.trim() ?? "")
        ?.slice(1)
        .map(Number);
    const old = parts(current);
    const next = parts(version);
    latest = !old || (next.map((part, index) => part - old[index]).find(Boolean) ?? 0) >= 0;
  }
  run("gh", ["release", "edit", tag, "--draft=false", `--latest=${latest}`]);
}

function command(file, args, allowMissing = false) {
  const result = spawnSync(file, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (allowMissing && /(?:HTTP 404|Not Found|release not found)/i.test(result.stderr))
      return null;
    throw new Error(`${file} ${args.slice(0, 3).join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await publishRelease(...process.argv.slice(2));
}
