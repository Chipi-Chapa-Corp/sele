import { compareSemverVersions } from "@t3tools/shared/semver";

export const DEFAULT_RELEASE_OWNER = "Chipi-Chapa-Corp";
export const DEFAULT_RELEASE_REPO = "sele";

export type ReleasePlatform = "windows-x64" | "macos-arm64" | "macos-x64";

export interface PlatformReleaseAsset {
  readonly name: string;
  readonly browser_download_url: string;
  readonly digest?: string | null;
  readonly size: number;
}

export interface PlatformRelease {
  readonly tag_name?: string;
  readonly name?: string | null;
  readonly body?: string | null;
  readonly published_at?: string | null;
  readonly draft?: boolean;
  readonly prerelease?: boolean;
  readonly assets?: ReadonlyArray<PlatformReleaseAsset>;
}

export interface ReleaseRepo {
  readonly owner: string;
  readonly repo: string;
}

export interface ReleaseSelectionOptions {
  readonly owner?: string;
  readonly repo?: string;
  readonly allowPrerelease?: boolean;
  readonly allowDowngrade?: boolean;
}

const STABLE_VERSION_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const NIGHTLY_VERSION_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-nightly\.\d{8}\.\d+$/;

function releaseRepositoryUrl(repo: ReleaseRepo): string {
  return `https://github.com/${repo.owner}/${repo.repo}`;
}

export function releaseDownloadUrl(
  release: PlatformRelease,
  repo: ReleaseRepo = { owner: DEFAULT_RELEASE_OWNER, repo: DEFAULT_RELEASE_REPO },
): string {
  return `${releaseRepositoryUrl(repo)}/releases/download/${release.tag_name}/`;
}

export function platformReleaseVersion(
  release: PlatformRelease,
  platform: ReleasePlatform,
  allowPrerelease = false,
): string | null {
  if (
    !release ||
    typeof release !== "object" ||
    release.draft ||
    typeof release.tag_name !== "string"
  ) {
    return null;
  }
  if (!allowPrerelease && release.prerelease) {
    return null;
  }
  const suffix = `-${platform}`;
  const tag = release.tag_name.endsWith(suffix)
    ? release.tag_name.slice(0, -suffix.length)
    : release.tag_name;
  if (STABLE_VERSION_PATTERN.test(tag)) {
    return tag.replace(/^v/, "");
  }
  if (allowPrerelease && NIGHTLY_VERSION_PATTERN.test(tag)) {
    return tag.replace(/^v/, "");
  }
  return null;
}

export function isCandidateUpdateVersion(
  candidate: string,
  baseline: string,
  allowDowngrade = false,
): boolean {
  const comparison = compareSemverVersions(candidate, baseline);
  return allowDowngrade ? candidate !== baseline : comparison > 0;
}

export function selectPlatformRelease(
  releases: ReadonlyArray<PlatformRelease>,
  platform: ReleasePlatform,
  current: string,
  options: ReleaseSelectionOptions = {},
): { readonly release: PlatformRelease; readonly version: string } | null {
  const repo: ReleaseRepo = {
    owner: options.owner ?? DEFAULT_RELEASE_OWNER,
    repo: options.repo ?? DEFAULT_RELEASE_REPO,
  };
  const allowPrerelease = options.allowPrerelease === true;
  const allowDowngrade = options.allowDowngrade === true;
  let selected: { readonly release: PlatformRelease; readonly version: string } | null = null;
  for (const release of releases) {
    const version = platformReleaseVersion(release, platform, allowPrerelease);
    if (!version) continue;
    if (selected === null) {
      if (!isCandidateUpdateVersion(version, current, allowDowngrade)) continue;
    } else if (compareSemverVersions(version, selected.version) <= 0) {
      continue;
    }
    const required = platform.startsWith("macos-")
      ? [`Sele-${version}-${platform.slice(6)}-mac.zip`]
      : ["latest.yml", "sele-windows-x64-setup.exe", "sele-windows-x64-setup.exe.blockmap"];
    const baseUrl = releaseDownloadUrl(release, repo);
    const hasAsset = (name: string): boolean =>
      release.assets?.some(
        (asset) =>
          asset.name === name &&
          asset.size > 0 &&
          asset.browser_download_url === `${baseUrl}${name}`,
      ) ?? false;
    if (!required.every(hasAsset)) {
      continue;
    }
    selected = { release, version };
  }
  return selected;
}

export async function findLatestPlatformRelease(
  platform: ReleasePlatform,
  current: string,
  options: ReleaseSelectionOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ readonly release: PlatformRelease; readonly version: string } | null> {
  const owner = options.owner ?? DEFAULT_RELEASE_OWNER;
  const repo = options.repo ?? DEFAULT_RELEASE_REPO;
  // Platform releases are interleaved. Follow pagination when the newest page
  // contains only other platforms; combined releases remain a fallback path.
  for (let page = 1; page <= 10; page++) {
    const response = await fetchImpl(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100&page=${page}`,
      {
        signal: AbortSignal.timeout(20_000),
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Sele-Updater",
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Release check failed (${response.status}).`);
    }
    const releases: unknown = await response.json();
    if (!Array.isArray(releases)) {
      throw new Error("Invalid release list.");
    }
    const selected = selectPlatformRelease(
      releases as ReadonlyArray<PlatformRelease>,
      platform,
      current,
      options,
    );
    if (selected) return selected;
    if (
      selectPlatformRelease(releases as ReadonlyArray<PlatformRelease>, platform, "0.0.0", {
        ...options,
        allowDowngrade: false,
      })
    ) {
      return null;
    }
    if (!response.headers.get("link")?.includes('rel="next"')) return null;
  }
  return null;
}
