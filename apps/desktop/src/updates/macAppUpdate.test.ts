import { describe, expect, it } from "vite-plus/test";

import {
  macAuthorizationScript,
  macInstallScript,
  macSupervisorScript,
  selectMacUpdate,
  shellQuote,
} from "./macAppUpdate.ts";
import type { PlatformRelease } from "./platformRelease.ts";

describe("macAppUpdate", () => {
  const digest = `sha256:${"f".repeat(64)}`;
  const validRelease: PlatformRelease = {
    tag_name: "v4.1.0-macos-arm64",
    name: "Sele 4.1.0",
    body: "Bug fixes",
    published_at: "2026-11-26T00:00:00Z",
    assets: [
      {
        name: "Sele-4.1.0-arm64-mac.zip",
        size: 123_456,
        digest,
        browser_download_url:
          "https://github.com/Chipi-Chapa-Corp/sele/releases/download/v4.1.0-macos-arm64/Sele-4.1.0-arm64-mac.zip",
      },
    ],
  };

  it("selects a verified arm64 update archive with sha256 digest", () => {
    const update = selectMacUpdate(validRelease, "4.0.0", "arm64");
    expect(update).toEqual({
      version: "4.1.0",
      arch: "arm64",
      url: "https://github.com/Chipi-Chapa-Corp/sele/releases/download/v4.1.0-macos-arm64/Sele-4.1.0-arm64-mac.zip",
      sha256: "f".repeat(64),
      size: 123_456,
      releaseNotes: "Bug fixes",
      releaseName: "Sele 4.1.0",
      releaseDate: "2026-11-26T00:00:00Z",
    });
  });

  it("rejects updates without a valid sha256 digest", () => {
    const missingDigest: PlatformRelease = {
      ...validRelease,
      assets: [{ ...validRelease.assets![0]!, digest: null }],
    };
    expect(() => selectMacUpdate(missingDigest, "4.0.0", "arm64")).toThrow(/SHA-256/);
  });

  it("generates an install script that clears quarantine and swaps Sele.app atomically", () => {
    const script = macInstallScript(
      "/Applications/Sele.app",
      "/tmp/stage/update.zip",
      "f".repeat(64),
      "/tmp/stage",
      4242,
    );
    expect(script).toContain("/usr/bin/ditto --noqtn -x -k");
    expect(script).toContain("/usr/bin/xattr -dr com.apple.quarantine");
    expect(script).toContain('/bin/mv "$work/unpacked/Sele.app" "$work/new.app"');
    expect(script).toContain("while /bin/kill -0 4242");
  });

  it("wraps elevated execution in osascript administrator privileges", () => {
    const worker = "echo ok";
    const supervisor = macSupervisorScript(worker, true, "/Applications/Sele.app", "/tmp/stage");
    expect(supervisor).toContain("/usr/bin/osascript -e");
    expect(macAuthorizationScript("/bin/bash -c 'echo ok'")).toContain(
      "with administrator privileges",
    );
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
  });
});
