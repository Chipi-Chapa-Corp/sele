import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'
import type { AppContainerTarget } from '../../../shared/app'
import type { ProviderSkill } from '../../../shared/provider'
import { getHostCommand } from '../../hostProcess'

const commandTimeoutMs = 15_000
const commandMaxBuffer = 4 * 1024 * 1024

const quotePosixShellArg = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

const runCommand = async (
  file: string,
  args: string[],
  container: AppContainerTarget | null | undefined
): Promise<string> => {
  const command = await getHostCommand(file, args, { container, env: process.env })
  return new Promise((resolve, reject) => {
    execFile(
      command.file,
      command.args,
      {
        cwd: command.cwd,
        encoding: 'utf8',
        env: command.env,
        maxBuffer: commandMaxBuffer,
        timeout: commandTimeoutMs
      },
      (error, stdout, stderr) => {
        if (!error) resolve(stdout)
        else reject(new Error(stderr.trim() || error.message))
      }
    )
  })
}

const stripYamlValue = (value: string): string =>
  value
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .trim()

const parseSkill = (path: string, source: string, cwd?: string | null): ProviderSkill | null => {
  if (!isAbsolute(path)) return null
  const frontmatter = /^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/.exec(source)?.[1] ?? ''
  const fields = new Map<string, string>()
  frontmatter.split(/\r?\n/).forEach((line) => {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (match?.[1]) fields.set(match[1].toLocaleLowerCase(), stripYamlValue(match[2] ?? ''))
  })
  const fallbackName = path.split(/[\\/]/).at(-2) ?? ''
  const name = fields.get('name') || fallbackName
  if (!name.trim()) return null
  const description = fields.get('description') || ''
  const normalizedCwd = cwd?.replace(/[\\/]+$/, '')
  const scope: ProviderSkill['scope'] =
    normalizedCwd && path.startsWith(`${normalizedCwd}/.claude/`) ? 'repo' : 'user'
  return {
    name: name.trim(),
    description: description.trim(),
    shortDescription: description.trim() || null,
    displayName: fields.get('display-name') || fields.get('displayname') || null,
    path,
    scope,
    enabled: true
  }
}

export const discoverClaudeSkills = async (
  cwd?: string | null,
  container?: AppContainerTarget | null
): Promise<ProviderSkill[]> => {
  const projectRoot = cwd ? `${cwd.replace(/[\\/]+$/, '')}/.claude/skills` : null
  const roots = [
    '"$HOME/.claude/skills"',
    '"$HOME/.claude/plugins/cache"',
    '"$HOME/.claude/plugins/marketplaces"',
    ...(projectRoot ? [quotePosixShellArg(projectRoot)] : [])
  ]
  const script = [
    'set -eu',
    `for sele_skill_root in ${roots.join(' ')}; do`,
    '  [ -d "$sele_skill_root" ] || continue',
    '  find "$sele_skill_root" -type f \\( -name SKILL.md -o -name skill.md \\) -print',
    'done'
  ].join('\n')

  let paths: string[]
  try {
    paths = Array.from(
      new Set(
        (await runCommand('sh', ['-lc', script], container))
          .split(/\r?\n/)
          .map((path) => path.trim())
          .filter(Boolean)
      )
    )
  } catch {
    return []
  }

  const sources = await Promise.allSettled(
    paths.map((path) => runCommand('cat', [path], container))
  )
  return sources
    .flatMap((result, index): ProviderSkill[] => {
      if (result.status !== 'fulfilled') return []
      const skill = parseSkill(paths[index] ?? '', result.value, cwd)
      return skill ? [skill] : []
    })
    .sort((first, second) => first.name.localeCompare(second.name))
}
