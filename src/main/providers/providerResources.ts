import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { AppContainerTarget } from '../../shared/app'
import type { ProviderId, ProviderSkill, ProviderSkillScope } from '../../shared/provider'

type DisabledSkillMetadata = {
  version: 1
  providerId?: ProviderId
  skill: ProviderSkill
}

type DisabledSkillRecord = {
  providerId: ProviderId | null
  skill: ProviderSkill
}

const disabledSkillDirectoryName = 'disabled-skills'
const providerSkillManifestName = 'skill.md'
const providerResourceCommandTimeoutMs = 15_000
const providerResourceCommandMaxBuffer = 4 * 1024 * 1024

const getDisabledSkillKey = (path: string): string =>
  createHash('sha256').update(path).digest('hex')

const getLocalDataRoot = (): string => {
  const configuredRoot = process.env.XDG_DATA_HOME?.trim()
  return configuredRoot && isAbsolute(configuredRoot)
    ? configuredRoot
    : join(homedir(), '.local', 'share')
}

const getLocalDisabledSkillRoot = (): string =>
  join(getLocalDataRoot(), 'sele', 'providers', disabledSkillDirectoryName)

const getLocalDisabledSkillEntry = (path: string): string =>
  join(getLocalDisabledSkillRoot(), getDisabledSkillKey(path))

const getTargetDisabledSkillRootScript = (): string =>
  [
    'sele_data_root="${XDG_DATA_HOME:-$HOME/.local/share}"',
    `sele_disabled_root="$sele_data_root/sele/providers/${disabledSkillDirectoryName}"`
  ].join('\n')

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const quotePosixShellArg = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

const isProviderSkillManifestPath = (path: string): boolean =>
  basename(path).toLocaleLowerCase() === providerSkillManifestName

const getRestoredSkillDirectory = (reportedPath: string): string =>
  isProviderSkillManifestPath(reportedPath) ? dirname(reportedPath) : reportedPath

const requireSafeSkillDirectory = (path: string): string => {
  if (!isAbsolute(path) || dirname(path) === path) {
    throw new Error('Invalid skill folder path')
  }
  return path
}

const normalizeProviderResourceContainer = (
  container: AppContainerTarget | null | undefined
): AppContainerTarget => (container?.kind === 'container' ? container : { kind: 'host' })

const shouldUseLocalFileSystem = (container: AppContainerTarget): boolean =>
  container.kind === 'host' && !process.env.FLATPAK_ID

const runTargetShell = async (script: string, container: AppContainerTarget): Promise<string> => {
  const { getHostCommand } = await import('../hostProcess')
  const command = await getHostCommand('sh', ['-lc', script], {
    container,
    env: process.env
  })

  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      command.file,
      command.args,
      {
        cwd: command.cwd,
        encoding: 'utf8',
        env: command.env,
        maxBuffer: providerResourceCommandMaxBuffer,
        timeout: providerResourceCommandTimeoutMs
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout)
          return
        }

        reject(new Error(stderr.trim() || getErrorMessage(error)))
      }
    )
    child.stdin?.end()
  })
}

const isProviderSkillScope = (value: unknown): value is ProviderSkillScope =>
  value === 'user' || value === 'repo' || value === 'system' || value === 'admin'

const isProviderResourceId = (value: unknown): value is ProviderId =>
  value === 'codex' || value === 'claude' || value === 'copilot' || value === 'opencode'

const inferProviderIdFromSkillPath = (path: string): ProviderId | null => {
  const normalizedPath = path.replace(/\\/g, '/').toLocaleLowerCase()
  if (normalizedPath.includes('/.claude/')) return 'claude'
  if (normalizedPath.includes('/.codex/')) return 'codex'
  if (normalizedPath.includes('/.copilot/')) return 'copilot'
  if (normalizedPath.includes('/.opencode/')) return 'opencode'
  return null
}

const parseDisabledSkillMetadata = (value: unknown): DisabledSkillRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const metadata = value as Partial<DisabledSkillMetadata>
  const skill = metadata.skill
  if (metadata.version !== 1 || !skill || typeof skill !== 'object' || Array.isArray(skill)) {
    return null
  }
  if (
    typeof skill.name !== 'string' ||
    !skill.name.trim() ||
    typeof skill.description !== 'string' ||
    (skill.shortDescription !== null && typeof skill.shortDescription !== 'string') ||
    (skill.displayName !== null && typeof skill.displayName !== 'string') ||
    typeof skill.path !== 'string' ||
    !isAbsolute(skill.path) ||
    !isProviderSkillScope(skill.scope)
  ) {
    return null
  }

  if (metadata.providerId !== undefined && !isProviderResourceId(metadata.providerId)) return null

  return {
    providerId: metadata.providerId ?? inferProviderIdFromSkillPath(skill.path),
    skill: {
      name: skill.name.trim(),
      description: skill.description.trim(),
      shortDescription: skill.shortDescription?.trim() || null,
      displayName: skill.displayName?.trim() || null,
      path: skill.path,
      scope: skill.scope,
      enabled: false
    }
  }
}

const parseDisabledSkillLines = (output: string): DisabledSkillRecord[] =>
  output.split('\n').flatMap((line): DisabledSkillRecord[] => {
    const normalizedLine = line.trim()
    if (!normalizedLine) return []

    try {
      const skill = parseDisabledSkillMetadata(JSON.parse(normalizedLine))
      return skill ? [skill] : []
    } catch {
      return []
    }
  })

const readLocalDisabledSkills = async (): Promise<DisabledSkillRecord[]> => {
  const root = getLocalDisabledSkillRoot()
  let entries: Dirent<string>[]
  try {
    entries = await readdir(root, { encoding: 'utf8', withFileTypes: true })
  } catch {
    return []
  }

  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry): Promise<DisabledSkillRecord | null> => {
        try {
          const metadata = JSON.parse(
            await readFile(join(root, entry.name, 'metadata.json'), 'utf8')
          )
          return parseDisabledSkillMetadata(metadata)
        } catch {
          return null
        }
      })
  )

  return skills.filter((record): record is DisabledSkillRecord => Boolean(record))
}

export const listDisabledProviderSkills = async (
  providerId: ProviderId,
  container: AppContainerTarget | null | undefined
): Promise<ProviderSkill[]> => {
  const normalizedContainer = normalizeProviderResourceContainer(container)
  const records = shouldUseLocalFileSystem(normalizedContainer)
    ? await readLocalDisabledSkills()
    : parseDisabledSkillLines(
        await runTargetShell(
          [
            'set -eu',
            getTargetDisabledSkillRootScript(),
            '[ -d "$sele_disabled_root" ] || exit 0',
            'for sele_metadata in "$sele_disabled_root"/*/metadata.json; do',
            '  [ -f "$sele_metadata" ] || continue',
            '  cat "$sele_metadata"',
            "  printf '\\n'",
            'done'
          ].join('\n'),
          normalizedContainer
        )
      )

  return records
    .filter((record) => record.providerId === null || record.providerId === providerId)
    .map((record) => record.skill)
    .sort((first, second) => first.name.localeCompare(second.name))
}

const moveLocalPath = async (source: string, destination: string): Promise<void> => {
  try {
    await rename(source, destination)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error

    await cp(source, destination, {
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      recursive: true
    })
    await rm(source, { force: false, recursive: true })
  }
}

const getLocalSkillDirectory = async (reportedPath: string): Promise<string> => {
  const reportedStats = await stat(reportedPath).catch(() => null)
  if (reportedStats?.isDirectory()) {
    if (isProviderSkillManifestPath(reportedPath)) {
      throw new Error('Invalid skill folder path')
    }
    return requireSafeSkillDirectory(reportedPath)
  }
  if (reportedStats?.isFile() && isProviderSkillManifestPath(reportedPath)) {
    return requireSafeSkillDirectory(dirname(reportedPath))
  }

  throw new Error('Skill folder no longer exists')
}

const disableLocalProviderSkill = async (
  providerId: ProviderId,
  skill: ProviderSkill
): Promise<void> => {
  const skillDirectory = await getLocalSkillDirectory(skill.path)

  const entry = getLocalDisabledSkillEntry(skill.path)
  await mkdir(getLocalDisabledSkillRoot(), { recursive: true })
  await mkdir(entry, { recursive: false })

  try {
    const metadata = {
      version: 1,
      providerId,
      skill: { ...skill, enabled: false }
    } satisfies DisabledSkillMetadata
    await writeFile(join(entry, 'metadata.json'), `${JSON.stringify(metadata)}\n`, {
      encoding: 'utf8',
      flag: 'wx'
    })
    await moveLocalPath(skillDirectory, join(entry, 'skill'))
  } catch (error) {
    await rm(entry, { force: true, recursive: true }).catch(() => {})
    throw error
  }
}

export const disableProviderSkill = async (
  providerId: ProviderId,
  skill: ProviderSkill,
  container: AppContainerTarget | null | undefined
): Promise<void> => {
  const normalizedContainer = normalizeProviderResourceContainer(container)
  if (shouldUseLocalFileSystem(normalizedContainer)) {
    await disableLocalProviderSkill(providerId, skill)
    return
  }

  const metadata = JSON.stringify({
    version: 1,
    providerId,
    skill: { ...skill, enabled: false }
  } satisfies DisabledSkillMetadata)
  const key = getDisabledSkillKey(skill.path)

  await runTargetShell(
    [
      'set -eu',
      getTargetDisabledSkillRootScript(),
      `sele_reported_path=${quotePosixShellArg(skill.path)}`,
      `sele_entry="$sele_disabled_root/${key}"`,
      'if [ -f "$sele_reported_path" ] && [ "$(basename "$sele_reported_path" | tr "[:upper:]" "[:lower:]")" = "skill.md" ]; then',
      '  sele_source=$(dirname "$sele_reported_path")',
      'elif [ -d "$sele_reported_path" ] && [ "$(basename "$sele_reported_path" | tr "[:upper:]" "[:lower:]")" != "skill.md" ]; then',
      '  sele_source=$sele_reported_path',
      'else',
      '  echo "Skill folder no longer exists" >&2',
      '  exit 1',
      'fi',
      '[ "$sele_source" != "/" ] || { echo "Invalid skill folder path" >&2; exit 1; }',
      '[ ! -e "$sele_entry" ] || { echo "Skill is already disabled" >&2; exit 1; }',
      'mkdir -p "$sele_disabled_root"',
      'mkdir "$sele_entry"',
      `printf '%s\\n' ${quotePosixShellArg(metadata)} > "$sele_entry/metadata.json"`,
      'if ! mv "$sele_source" "$sele_entry/skill"; then',
      '  rm -f "$sele_entry/metadata.json"',
      '  rmdir "$sele_entry" 2>/dev/null || true',
      '  exit 1',
      'fi'
    ].join('\n'),
    normalizedContainer
  )
}

const restoreLocalProviderSkill = async (path: string): Promise<boolean> => {
  const entry = getLocalDisabledSkillEntry(path)
  const storedSkillPath = join(entry, 'skill')
  const storedStats = await stat(storedSkillPath).catch(() => null)
  if (!storedStats?.isDirectory()) return false

  const skillDirectory = requireSafeSkillDirectory(getRestoredSkillDirectory(path))
  if (await stat(skillDirectory).catch(() => null)) {
    throw new Error('The original skill path is already occupied')
  }

  await mkdir(dirname(skillDirectory), { recursive: true })
  await moveLocalPath(storedSkillPath, skillDirectory)
  await rm(entry, { force: true, recursive: true })
  return true
}

export const restoreProviderSkill = async (
  path: string,
  container: AppContainerTarget | null | undefined,
  options: { skipIfOccupied?: boolean } = {}
): Promise<boolean> => {
  const normalizedContainer = normalizeProviderResourceContainer(container)
  if (shouldUseLocalFileSystem(normalizedContainer)) {
    if (options.skipIfOccupied && (await stat(getRestoredSkillDirectory(path)).catch(() => null))) {
      return false
    }
    return restoreLocalProviderSkill(path)
  }

  const key = getDisabledSkillKey(path)
  const marker = '__SELE_SKILL_NOT_DISABLED__'
  const skillDirectory = requireSafeSkillDirectory(getRestoredSkillDirectory(path))
  const output = await runTargetShell(
    [
      'set -eu',
      getTargetDisabledSkillRootScript(),
      `sele_destination=${quotePosixShellArg(skillDirectory)}`,
      `sele_entry="$sele_disabled_root/${key}"`,
      'if [ ! -d "$sele_entry/skill" ]; then',
      `  printf '%s' ${quotePosixShellArg(marker)}`,
      '  exit 0',
      'fi',
      options.skipIfOccupied
        ? `[ ! -e "$sele_destination" ] || { printf '%s' ${quotePosixShellArg(marker)}; exit 0; }`
        : '[ ! -e "$sele_destination" ] || { echo "The original skill path is already occupied" >&2; exit 1; }',
      'mkdir -p "$(dirname "$sele_destination")"',
      'mv "$sele_entry/skill" "$sele_destination"',
      'rm -f "$sele_entry/metadata.json"',
      'rmdir "$sele_entry" 2>/dev/null || true'
    ].join('\n'),
    normalizedContainer
  )

  return output !== marker
}

export const mergeProviderSkills = (
  discoveredSkills: ProviderSkill[],
  disabledSkills: ProviderSkill[]
): ProviderSkill[] => {
  const skillsByPath = new Map<string, ProviderSkill>()
  disabledSkills.forEach((skill) => skillsByPath.set(skill.path, skill))
  discoveredSkills.forEach((skill) => {
    const currentSkill = skillsByPath.get(skill.path)
    if (!currentSkill || skill.enabled) skillsByPath.set(skill.path, skill)
  })

  return Array.from(skillsByPath.values()).sort((first, second) =>
    first.name.localeCompare(second.name)
  )
}

const isCodexManagedSkillPath = (path: string): boolean => {
  const normalizedPath = path.replace(/\\/g, '/').toLocaleLowerCase()
  return normalizedPath.includes('/plugins/cache/') || normalizedPath.includes('/skills/.system/')
}

export const mergeCodexProviderSkills = (
  discoveredSkills: ProviderSkill[],
  disabledSkills: ProviderSkill[]
): ProviderSkill[] => {
  const discoveredPaths = new Set(discoveredSkills.map((skill) => skill.path))
  const discoveredManagedNames = new Set(
    discoveredSkills
      .filter((skill) => isCodexManagedSkillPath(skill.path))
      .map((skill) => skill.name)
  )
  const relevantDisabledSkills = disabledSkills.filter(
    (skill) =>
      !discoveredPaths.has(skill.path) &&
      !(isCodexManagedSkillPath(skill.path) && discoveredManagedNames.has(skill.name))
  )

  return mergeProviderSkills(discoveredSkills, relevantDisabledSkills)
}
