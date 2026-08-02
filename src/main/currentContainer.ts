import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import type { AppContainerTarget, AppContainerTool } from '../shared/app'
import { normalizeContainerTarget } from './containerTarget'

type ContainerEnvironment = Record<string, string>
export type CurrentContainerHostBridge = {
  file: string
  argsPrefix: string[]
}

const supportedContainerTools = new Set<AppContainerTool>([
  'distrobox',
  'toolbox',
  'podman',
  'docker'
])

const currentContainerNameEnvironmentKeys = [
  'CONTAINER_NAME',
  'container_name',
  'DISTROBOX_NAME',
  'DISTROBOX_CONTAINER_NAME',
  'TOOLBOX_NAME',
  'TOOLBOX_CONTAINER'
]

const currentContainerIdEnvironmentKeys = ['CONTAINER_ID', 'container_id', 'containerId']
const currentContainerCommandMaxBuffer = 256 * 1024
const currentContainerCommandTimeoutMs = 5_000

let currentContainerTarget: Promise<AppContainerTarget | null> | null = null
let currentContainerHostBridge: Promise<CurrentContainerHostBridge | null> | null = null

const isFlatpakEnvironment = (): boolean =>
  Boolean(process.env.FLATPAK_ID) || process.env.container?.trim().toLocaleLowerCase() === 'flatpak'

const unquoteEnvironmentValue = (value: string): string => {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

const readEnvironmentFile = async (path: string): Promise<ContainerEnvironment | null> => {
  try {
    const file = await readFile(path, 'utf8')
    const environment: ContainerEnvironment = {}

    for (const line of file.split('\n')) {
      const trimmedLine = line.trim()
      if (!trimmedLine || trimmedLine.startsWith('#')) continue

      const separatorIndex = trimmedLine.indexOf('=')
      if (separatorIndex <= 0) continue

      const key = trimmedLine.slice(0, separatorIndex).trim()
      const value = unquoteEnvironmentValue(trimmedLine.slice(separatorIndex + 1))
      if (key && value) environment[key] = value
    }

    return environment
  } catch {
    return null
  }
}

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await readFile(path, { encoding: 'utf8', flag: 'r' })
    return true
  } catch {
    return false
  }
}

const readTextFile = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

const getEnvironmentValue = (...keys: string[]): string | null => {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }

  return null
}

const isDistroboxEnvironment = (): boolean =>
  Boolean(
    process.env.DISTROBOX_ENTER_PATH ||
    process.env.DISTROBOX_HOST_HOME ||
    process.env.DISTROBOX_ENVIRONMENT ||
    process.env.container === 'distrobox'
  )

const hasCurrentContainerMarker = async (): Promise<boolean> => {
  if (isFlatpakEnvironment()) return false

  return Boolean(
    process.env.container ||
    isDistroboxEnvironment() ||
    process.env.CONTAINER_ID ||
    process.env.container_id ||
    (await fileExists('/run/.containerenv')) ||
    (await fileExists('/run/.toolboxenv')) ||
    (await fileExists('/.dockerenv'))
  )
}

const runTextCommand = (file: string, args: string[]): Promise<string | null> =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        encoding: 'utf8',
        env: process.env,
        maxBuffer: currentContainerCommandMaxBuffer,
        timeout: currentContainerCommandTimeoutMs
      },
      (error, stdout) => {
        resolve(error ? null : stdout.trim())
      }
    )
  })

const detectCurrentContainerHostBridge = async (): Promise<CurrentContainerHostBridge | null> => {
  if (process.platform !== 'linux') return null
  if (!(await hasCurrentContainerMarker())) return null

  const available = await runTextCommand('distrobox-host-exec', ['true'])
  return available == null ? null : { file: 'distrobox-host-exec', argsPrefix: [] }
}

export const getCurrentContainerHostBridge = (): Promise<CurrentContainerHostBridge | null> => {
  if (!currentContainerHostBridge) {
    currentContainerHostBridge = detectCurrentContainerHostBridge()
  }

  return currentContainerHostBridge
}

export const runCurrentContainerHostTextCommand = async (
  file: string,
  args: string[]
): Promise<string | null> => {
  const bridge = await getCurrentContainerHostBridge()
  if (!bridge) return null

  return runTextCommand(bridge.file, [...bridge.argsPrefix, file, ...args])
}

const parseContainerId = (value: string | null | undefined): string | null => {
  const normalizedValue = value?.trim()
  if (!normalizedValue) return null

  const directMatch = normalizedValue.match(/^[a-f0-9]{12,64}$/i)
  if (directMatch) return directMatch[0]

  const scopedMatch = normalizedValue.match(/(?:libpod|docker)[-/:]?([a-f0-9]{12,64})/i)
  return scopedMatch?.[1] ?? null
}

const getCurrentContainerId = async (
  containerEnvironment: ContainerEnvironment | null
): Promise<string | null> => {
  const candidates = [
    getEnvironmentValue(...currentContainerIdEnvironmentKeys),
    containerEnvironment?.id,
    containerEnvironment?.ID,
    containerEnvironment?.container_id,
    await readTextFile('/proc/self/cgroup'),
    await readTextFile('/proc/1/cgroup')
  ]

  for (const candidate of candidates) {
    const containerId = parseContainerId(candidate)
    if (containerId) return containerId
  }

  return null
}

const normalizeInspectedContainerName = (value: string | null): string | null => {
  const name = value?.trim().replace(/^\/+/, '')
  return name && !name.includes('\0') && !name.includes('\n') ? name : null
}

const inspectCurrentContainerName = async (
  containerId: string | null,
  tool: AppContainerTool
): Promise<string | null> => {
  if (!containerId) return null

  const runtimeCandidates = tool === 'docker' ? ['docker', 'podman'] : ['podman', 'docker']
  for (const runtime of runtimeCandidates) {
    const inspectedName = await runCurrentContainerHostTextCommand(runtime, [
      'inspect',
      '--format',
      '{{.Name}}',
      containerId
    ])
    const name = normalizeInspectedContainerName(inspectedName)
    if (name) return name
  }

  return null
}

const getCurrentContainerName = async (
  containerEnvironment: ContainerEnvironment | null,
  toolboxEnvironment: ContainerEnvironment | null,
  tool: AppContainerTool
): Promise<string | null> => {
  const containerId = await getCurrentContainerId(containerEnvironment)
  const candidates = [
    getEnvironmentValue(...currentContainerNameEnvironmentKeys),
    containerEnvironment?.name,
    containerEnvironment?.container_name,
    containerEnvironment?.containerName,
    await inspectCurrentContainerName(containerId, tool),
    toolboxEnvironment?.name,
    toolboxEnvironment?.container_name,
    toolboxEnvironment?.containerName
  ]

  for (const candidate of candidates) {
    const name = candidate?.trim()
    if (name && !name.includes('\0') && !name.includes('\n')) return name
  }

  return null
}

const getCurrentContainerTool = async (
  containerEnvironment: ContainerEnvironment | null,
  toolboxEnvironment: ContainerEnvironment | null,
  dockerEnvironmentExists: boolean
): Promise<AppContainerTool | null> => {
  const explicitTool = getEnvironmentValue(
    'DISTROBOX_CONTAINER_TOOL',
    'CONTAINER_TOOL',
    'container_tool'
  )
  if (supportedContainerTools.has(explicitTool as AppContainerTool)) {
    return explicitTool as AppContainerTool
  }

  if (isDistroboxEnvironment() || (await getCurrentContainerHostBridge())) {
    return 'distrobox'
  }

  if (
    toolboxEnvironment ||
    process.env.TOOLBOX_PATH ||
    process.env.TOOLBOX_NAME ||
    process.env.TOOLBOX_CONTAINER ||
    process.env.container === 'toolbox'
  ) {
    return 'toolbox'
  }

  const engine = (containerEnvironment?.engine ?? process.env.container ?? '').toLocaleLowerCase()
  if (engine.includes('docker') || dockerEnvironmentExists) return 'docker'
  if (engine.includes('podman') || containerEnvironment) return 'podman'

  return null
}

const detectCurrentContainerTarget = async (): Promise<AppContainerTarget | null> => {
  if (process.platform !== 'linux') return null
  if (isFlatpakEnvironment()) return null

  const [containerEnvironment, toolboxEnvironment, dockerEnvironmentExists] = await Promise.all([
    readEnvironmentFile('/run/.containerenv'),
    readEnvironmentFile('/run/.toolboxenv'),
    fileExists('/.dockerenv')
  ])
  const tool = await getCurrentContainerTool(
    containerEnvironment,
    toolboxEnvironment,
    dockerEnvironmentExists
  )
  if (!tool) return null

  const name = await getCurrentContainerName(containerEnvironment, toolboxEnvironment, tool)
  if (!name) return null

  return { kind: 'container', tool, name }
}

export const getCurrentContainerTarget = (): Promise<AppContainerTarget | null> => {
  if (!currentContainerTarget) currentContainerTarget = detectCurrentContainerTarget()
  return currentContainerTarget
}

export const isCurrentContainerTarget = async (
  container: AppContainerTarget | null | undefined
): Promise<boolean> => {
  const normalizedContainer = normalizeContainerTarget(container)
  if (normalizedContainer.kind !== 'container') return false

  const currentContainer = await getCurrentContainerTarget()
  return (
    currentContainer?.kind === 'container' &&
    normalizedContainer.tool === currentContainer.tool &&
    normalizedContainer.name === currentContainer.name
  )
}
