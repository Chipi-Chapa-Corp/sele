import type { ProviderUpdateAvailability } from '../../../shared/provider'

type ParsedVersion = {
  major: number
  minor: number
  patch: number
}

export const parseClaudeVersion = (value: string): string | null => {
  const match = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(value)
  return match?.[1] ?? null
}

const parseComparableVersion = (version: string): ParsedVersion | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!match) return null

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  }
}

const compareVersions = (firstVersion: string, secondVersion: string): number => {
  const first = parseComparableVersion(firstVersion)
  const second = parseComparableVersion(secondVersion)
  if (!first || !second) return firstVersion.localeCompare(secondVersion)

  if (first.major !== second.major) return first.major - second.major
  if (first.minor !== second.minor) return first.minor - second.minor
  return first.patch - second.patch
}

// resumeDropsTurn was added to Claude Code alongside Agent SDK 0.3.228. Older
// CLIs reject the SDK-generated flag before a resumed edit can start.
const resumeDropsTurnMinimumVersion = '2.1.228'

export const supportsClaudeResumeDropsTurn = (version: string): boolean =>
  compareVersions(version, resumeDropsTurnMinimumVersion) >= 0

export const getClaudeUpdateAvailabilityFromVersions = (
  currentVersion: string,
  latestVersion: string
): ProviderUpdateAvailability | null =>
  compareVersions(currentVersion, latestVersion) < 0 ? { currentVersion, latestVersion } : null
