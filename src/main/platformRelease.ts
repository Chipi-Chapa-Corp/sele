import { isNewerStableVersion } from '../shared/appUpdate.ts'

export const releaseRepository = 'https://github.com/Chipi-Chapa-Corp/sele'
export type ReleasePlatform = 'windows-x64' | 'macos-arm64' | 'macos-x64' | 'linux-x64'
export type PlatformRelease = {
  tag_name?: string
  draft?: boolean
  prerelease?: boolean
  assets?: { name: string; browser_download_url: string; digest?: string; size: number }[]
}

export function platformReleaseVersion(
  release: PlatformRelease,
  platform: ReleasePlatform
): string | null {
  if (
    !release ||
    typeof release !== 'object' ||
    release.draft ||
    release.prerelease ||
    typeof release.tag_name !== 'string'
  )
    return null
  const suffix = `-${platform}`
  const tag = release.tag_name.endsWith(suffix)
    ? release.tag_name.slice(0, -suffix.length)
    : release.tag_name
  return /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag) ? tag.replace(/^v/, '') : null
}

export const releaseDownloadUrl = (release: PlatformRelease): string =>
  `${releaseRepository}/releases/download/${release.tag_name}/`

export function selectPlatformRelease(
  releases: PlatformRelease[],
  platform: ReleasePlatform,
  current: string
): { release: PlatformRelease; version: string } | null {
  let selected: { release: PlatformRelease; version: string } | null = null
  for (const release of releases) {
    const version = platformReleaseVersion(release, platform)
    if (!version || !isNewerStableVersion(version, selected?.version ?? current)) continue
    const required = platform.startsWith('macos-')
      ? [`Sele-${version}-${platform.slice(6)}-mac.zip`]
      : platform === 'windows-x64'
        ? ['latest.yml', 'sele-windows-x64-setup.exe', 'sele-windows-x64-setup.exe.blockmap']
        : ['sele-linux-x64.flatpak', 'sele.flatpakrepo']
    if (
      !required.every((name) =>
        release.assets?.some(
          (asset) =>
            asset.name === name &&
            asset.size > 0 &&
            asset.browser_download_url === `${releaseDownloadUrl(release)}${name}`
        )
      )
    )
      continue
    selected = { release, version }
  }
  return selected
}

export async function findLatestPlatformRelease(
  platform: ReleasePlatform,
  current: string
): Promise<{ release: PlatformRelease; version: string } | null> {
  // Platform releases are interleaved. Follow pagination when the newest page
  // contains only other platforms; older combined releases remain a migration path.
  for (let page = 1; ; page++) {
    const response = await fetch(
      `https://api.github.com/repos/Chipi-Chapa-Corp/sele/releases?per_page=100&page=${page}`,
      { signal: AbortSignal.timeout(20_000), headers: { Accept: 'application/vnd.github+json' } }
    )
    if (!response.ok) throw new Error(`Release check failed (${response.status}).`)
    const releases: unknown = await response.json()
    if (!Array.isArray(releases)) throw new Error('Invalid release list.')
    const selected = selectPlatformRelease(releases, platform, current)
    if (selected) return selected
    // Once the current platform is present, older pages cannot help an up-to-date
    // installation. Avoid spending the anonymous API budget scanning history.
    if (selectPlatformRelease(releases, platform, '0.0.0')) return null
    if (!response.headers.get('link')?.includes('rel="next"')) return null
  }
}
