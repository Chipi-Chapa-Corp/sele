import { describe, expect, it } from "vite-plus/test";

import {
  platformReleaseVersion,
  selectPlatformRelease,
  type PlatformRelease,
} from "./platformRelease.ts";

const makeRelease = (
  tag: string,
  assets: ReadonlyArray<string>,
  extra: Partial<PlatformRelease> = {},
): PlatformRelease => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  assets: assets.map((name) => ({
    name,
    size: 1024,
    digest: `sha256:${"a".repeat(64)}`,
    browser_download_url: `https://github.com/Chipi-Chapa-Corp/sele/releases/download/${tag}/${name}`,
  })),
  ...extra,
});

describe("platformRelease", () => {
  it("parses platform-suffixed and combined stable tags", () => {
    expect(platformReleaseVersion({ tag_name: "v4.1.0-macos-arm64" }, "macos-arm64")).toBe("4.1.0");
    expect(platformReleaseVersion({ tag_name: "v4.1.0" }, "macos-arm64")).toBe("4.1.0");
    expect(platformReleaseVersion({ tag_name: "v4.1.0-windows-x64" }, "macos-arm64")).toBeNull();
    expect(platformReleaseVersion({ tag_name: "v4.1.0", draft: true }, "macos-arm64")).toBeNull();
    expect(
      platformReleaseVersion({ tag_name: "v4.1.0", prerelease: true }, "macos-arm64"),
    ).toBeNull();
  });

  it("selects the newest valid macOS arm64 release", () => {
    const releases = [
      makeRelease("v4.1.0-windows-x64", [
        "latest.yml",
        "sele-windows-x64-setup.exe",
        "sele-windows-x64-setup.exe.blockmap",
      ]),
      makeRelease("v4.0.5-macos-arm64", ["Sele-4.0.5-arm64-mac.zip"]),
      makeRelease("v4.1.0-macos-arm64", ["Sele-4.1.0-arm64-mac.zip"]),
    ];
    const selected = selectPlatformRelease(releases, "macos-arm64", "4.0.0");
    expect(selected?.version).toBe("4.1.0");
    expect(selected?.release.tag_name).toBe("v4.1.0-macos-arm64");
  });

  it("rejects releases with mismatched asset download URLs", () => {
    const tampered: PlatformRelease = {
      tag_name: "v4.1.0-macos-arm64",
      assets: [
        {
          name: "Sele-4.1.0-arm64-mac.zip",
          size: 1024,
          digest: `sha256:${"a".repeat(64)}`,
          browser_download_url: "https://evil.example/Sele-4.1.0-arm64-mac.zip",
        },
      ],
    };
    expect(selectPlatformRelease([tampered], "macos-arm64", "4.0.0")).toBeNull();
  });

  it("selects linux-x64 releases with Flatpak metadata", () => {
    const releases = [makeRelease("v4.1.0-linux-x64", ["sele.flatpakrepo", "sele.flatpakref"])];
    const selected = selectPlatformRelease(releases, "linux-x64", "4.0.0");
    expect(selected?.version).toBe("4.1.0");
  });
});
