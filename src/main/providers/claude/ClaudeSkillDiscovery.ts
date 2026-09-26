import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'
import type { AppContainerTarget } from '../../../shared/app'
import { isExpectedCommandAbsenceError } from '../../../shared/expectedAbsence.ts'
import type { ProviderSkill } from '../../../shared/provider'
import { getHostCommand } from '../../hostProcess'
import { getClaudeExecutable } from './ClaudeExecutable'
import {
  getClaudePluginIdForSkillPath,
  getClaudePluginState,
  parseClaudePluginInventory
} from './ClaudePluginSkills'

const commandTimeoutMs = 15_000
const commandMaxBuffer = 64 * 1024 * 1024

const quotePosixShellArg = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

const runCommand = async (
  file: string,
  args: string[],
  container: AppContainerTarget | null | undefined,
  timeoutMs = commandTimeoutMs
): Promise<string> => {
  const command = await getHostCommand(file, args, { container, env: process.env })
  return new Promise((resolve, reject) => {
    const child = execFile(
      command.file,
      command.args,
      {
        cwd: command.cwd,
        encoding: 'utf8',
        env: command.env,
        maxBuffer: commandMaxBuffer,
        timeout: timeoutMs
      },
      (error, stdout, stderr) => {
        if (!error) resolve(stdout)
        else reject(new Error(stderr.trim() || error.message))
      }
    )
    child.stdin?.end()
  })
}

const getClaudePluginInventory = async (
  container: AppContainerTarget | null | undefined
): Promise<ReturnType<typeof parseClaudePluginInventory>> =>
  parseClaudePluginInventory(
    await runCommand(getClaudeExecutable(), ['plugin', 'list', '--available', '--json'], container)
  )

export const setClaudePluginEnabled = async (
  pluginId: string,
  enabled: boolean,
  container: AppContainerTarget | null | undefined
): Promise<void> => {
  const state = getClaudePluginState(await getClaudePluginInventory(container), pluginId)
  if (state === 'unavailable') throw new Error('Claude plugin is not available in this environment')
  if (enabled && state === 'enabled') return
  if (!enabled && state !== 'enabled') return
  const action = enabled ? (state === 'available' ? 'install' : 'enable') : 'disable'
  await runCommand(getClaudeExecutable(), ['plugin', action, pluginId, '--json'], container, 120_000)
  const updated = getClaudePluginState(await getClaudePluginInventory(container), pluginId)
  if ((updated === 'enabled') !== enabled) {
    throw new Error(`Claude did not ${enabled ? 'enable' : 'disable'} the plugin`)
  }
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
    '  find "$sele_skill_root" -type f \\( -name SKILL.md -o -name skill.md \\) -exec sh -c \'',
    '    for sele_skill_path do',
    '      printf "%s\\0" "$sele_skill_path"',
    '      while IFS= read -r sele_skill_line || [ -n "$sele_skill_line" ]; do',
    '        printf "%s\\n" "$sele_skill_line"',
    '      done < "$sele_skill_path"',
    '      printf "\\0"',
    '    done',
    "  ' sele-claude-skill-reader {} +",
    'done'
  ].join('\n')

  let output: string
  let inventory: ReturnType<typeof parseClaudePluginInventory> | null = null
  try {
    const results = await Promise.allSettled([
      runCommand('sh', ['-lc', script], container),
      getClaudePluginInventory(container)
    ])
    if (results[0].status === 'rejected') throw results[0].reason
    output = results[0].value
    if (results[1].status === 'fulfilled') {
      inventory = results[1].value
    } else {
      console.warn('Unable to read Claude plugin installation state.', results[1].reason)
    }
  } catch (error) {
    if (isExpectedCommandAbsenceError(error)) return []
    console.error('Unable to discover Claude skills.', error)
    return []
  }

  const fields = output.split('\0')
  const sources = new Map<string, string>()
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const path = fields[index]
    if (path && !sources.has(path)) sources.set(path, fields[index + 1] ?? '')
  }
  const skills = [...sources]
    .flatMap(([path, source]): ProviderSkill[] => {
      const skill = parseSkill(path, source, cwd)
      if (!skill) return []
      const pluginId = getClaudePluginIdForSkillPath(path)
      if (!pluginId) return [skill]
      if (!inventory) return []
      const state = getClaudePluginState(inventory, pluginId)
      return state === 'unavailable' ? [] : [{ ...skill, enabled: state === 'enabled' }]
    })
  const byPluginSkill = new Map<string, ProviderSkill>()
  skills.forEach((skill) => {
    const pluginId = getClaudePluginIdForSkillPath(skill.path)
    const key = pluginId ? `${pluginId}:${skill.name}` : skill.path
    const current = byPluginSkill.get(key)
    if (!current || skill.path.includes('/plugins/marketplaces/')) byPluginSkill.set(key, skill)
  })
  return [...byPluginSkill.values()].sort((first, second) => first.name.localeCompare(second.name))
}
