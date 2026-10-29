import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { AppContainerTarget } from '../../../shared/app'
import { getHostCommand } from '../../hostProcess'
import { getContainerTargetKey } from '../../containerTarget'
import { getOpenCodeExecutable } from './OpenCodeExecutable'

export type OpenCodeInstallation = { major: 2; version: string; executable: string }
export const managedOpenCodeV2Directory = (): string =>
  join(
    process.env.XDG_DATA_HOME && isAbsolute(process.env.XDG_DATA_HOME)
      ? process.env.XDG_DATA_HOME
      : join(homedir(), '.local', 'share'),
    'sele',
    'opencode-v2'
  )
export const managedOpenCodeV2Executable = (): string =>
  join(managedOpenCodeV2Directory(), process.platform === 'win32' ? 'opencode.exe' : 'opencode')
const cache = new Map<string, { expires: number; value: Promise<OpenCodeInstallation[]> }>()
export const clearOpenCodeInstallationCache = (): void => cache.clear()

const pathInstallations = async (
  container: AppContainerTarget | null | undefined,
  env: NodeJS.ProcessEnv
): Promise<string[]> => {
  const windows = process.platform === 'win32' && container?.kind !== 'container'
  const file = windows ? 'powershell.exe' : 'sh'
  const args = windows
    ? [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-Command opencode -All -CommandType Application -ErrorAction SilentlyContinue).Source'
      ]
    : [
        '-lc',
        'opencode_paths="$PATH"; while :; do opencode_dir="${opencode_paths%%:*}"; [ -n "$opencode_dir" ] || opencode_dir=.; if [ -f "$opencode_dir/opencode" ] && [ -x "$opencode_dir/opencode" ]; then printf "%s\\n" "$opencode_dir/opencode"; fi; case "$opencode_paths" in *:*) opencode_paths="${opencode_paths#*:}" ;; *) break ;; esac; done'
      ]
  try {
    const command = await getHostCommand(file, args, { container, env })
    return await new Promise((resolve) => {
      const child = execFile(
        command.file,
        command.args,
        {
          env: command.env,
          cwd: command.cwd,
          timeout: 10_000,
          maxBuffer: 64_000,
          encoding: 'utf8'
        },
        (error, stdout) => resolve(error ? [] : stdout.trim().split(/\r?\n/).filter(Boolean))
      )
      child.stdin?.end()
    })
  } catch {
    return []
  }
}

export const probeOpenCodeInstallation = async (
  executable: string,
  container?: AppContainerTarget | null,
  env: NodeJS.ProcessEnv = process.env
): Promise<OpenCodeInstallation | null> => {
  try {
    const command = await getHostCommand(executable, ['--version'], { container, env })
    const output = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        command.file,
        command.args,
        {
          cwd: command.cwd,
          env: command.env,
          encoding: 'utf8',
          timeout: 10_000,
          maxBuffer: 16_384
        },
        (error, stdout) => (error ? reject(error) : resolve(stdout))
      )
      child.stdin?.end()
    })
    const version = /(?:^|[^\d.])(2\.\d+\.\d+(?:[-+][\w.-]+)?)/.exec(output)?.[1]
    return version ? { major: 2, version, executable } : null
  } catch {
    // Candidate discovery is an optional probe; not every alias or install location exists.
    return null
  }
}

export const getOpenCodeInstallations = (
  container?: AppContainerTarget | null,
  env: NodeJS.ProcessEnv = process.env
): Promise<OpenCodeInstallation[]> => {
  const candidates = [
    ...new Set(
      [
        ...(container?.kind !== 'container'
          ? [env.SELE_OPENCODE_V2_PATH, getOpenCodeExecutable()]
          : ['opencode']),
        managedOpenCodeV2Executable(),
        'opencode-v2',
        'opencode2'
      ].filter((path): path is string => Boolean(path))
    )
  ]
  const key = JSON.stringify([getContainerTargetKey(container), candidates])
  const found = cache.get(key)
  if (found && found.expires > Date.now()) return found.value
  const value = pathInstallations(container, env)
    .then((paths) =>
      Promise.all(
        [...new Set([...candidates, ...paths])].map((executable) =>
          probeOpenCodeInstallation(executable, container, env)
        )
      )
    )
    .then((results) => {
      const installations = new Map<number, OpenCodeInstallation>()
      for (const result of results)
        if (result && !installations.has(result.major)) installations.set(result.major, result)
      return [...installations.values()].sort((a, b) => a.major - b.major)
    })
  cache.set(key, { expires: Date.now() + 30_000, value })
  return value
}

export const resolveOpenCodeInstallation = async (
  container?: AppContainerTarget | null
): Promise<OpenCodeInstallation> => {
  const installation = (await getOpenCodeInstallations(container))[0]
  if (!installation)
    throw new Error(
      'OpenCode 2 is required. Install @opencode/cli or set SELE_OPENCODE_PATH to its executable.'
    )
  return installation
}
