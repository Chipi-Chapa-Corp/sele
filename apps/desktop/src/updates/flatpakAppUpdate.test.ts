import { describe, expect, it } from "vite-plus/test";

import { checkFlatpakUpdate, parseFlatpakInfo } from "./flatpakAppUpdate.ts";

describe("flatpakAppUpdate", () => {
  const sampleInfo = `[Application]
name=com.chipichapa.sele
runtime=runtime/org.freedesktop.Platform/x86_64/25.08
app-commit=${"a".repeat(64)}
app-path=/home/user/.local/share/flatpak/app/com.chipichapa.sele/x86_64/stable/active/files

[Instance]
instance-id=123456
arch=x86_64
branch=stable
`;

  it("parses user and system Flatpak scopes from /.flatpak-info", () => {
    expect(parseFlatpakInfo(sampleInfo)).toEqual({
      appPath: "/home/user/.local/share/flatpak/app/com.chipichapa.sele/x86_64/stable/active/files",
      arch: "x86_64",
      branch: "stable",
      appCommit: "a".repeat(64),
      instanceId: "123456",
      scope: "--user",
    });

    const systemInfo = sampleInfo.replace("/home/user/.local/share/flatpak/", "/var/lib/flatpak/");
    expect(parseFlatpakInfo(systemInfo).scope).toBe("--system");
  });

  it("detects a newer Flatpak commit when the GitHub release and OSTree remote advance", async () => {
    const nextCommit = "b".repeat(64);
    const mockFetch = (async () =>
      new Response(
        JSON.stringify([
          {
            tag_name: "v4.1.0-linux-x64",
            name: "Sele 4.1.0",
            body: "Flatpak release",
            published_at: "2026-11-26T00:00:00Z",
            assets: [
              {
                name: "sele.flatpakrepo",
                size: 256,
                browser_download_url:
                  "https://github.com/Chipi-Chapa-Corp/sele/releases/download/v4.1.0-linux-x64/sele.flatpakrepo",
              },
              {
                name: "sele.flatpakref",
                size: 256,
                browser_download_url:
                  "https://github.com/Chipi-Chapa-Corp/sele/releases/download/v4.1.0-linux-x64/sele.flatpakref",
              },
            ],
          },
        ]),
        { status: 200 },
      )) as typeof fetch;

    const target = await checkFlatpakUpdate({
      current: "4.0.0",
      readFlatpakInfo: async () => sampleInfo,
      hostFlatpak: async (args) => (args[0] === "info" ? "sele" : nextCommit),
      fetchImpl: mockFetch,
    });

    expect(target).toEqual({
      version: "4.1.0",
      scope: "--user",
      ref: "app/com.chipichapa.sele/x86_64/stable",
      commit: nextCommit,
      instanceId: "123456",
      releaseNotes: "Flatpak release",
      releaseName: "Sele 4.1.0",
      releaseDate: "2026-11-26T00:00:00Z",
    });
  });
});
