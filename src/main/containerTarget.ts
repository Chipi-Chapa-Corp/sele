import type {
  AppContainerTarget,
  AppContainerTargetTool,
  AppLocalContainerTarget
} from '../shared/app'

export const hostContainerTarget = { kind: 'host' } satisfies AppContainerTarget

const containerTools = new Set<AppContainerTargetTool>([
  'distrobox',
  'toolbox',
  'podman',
  'docker',
  'ssh'
])

export const isContainerTool = (value: unknown): value is AppContainerTargetTool =>
  containerTools.has(value as AppContainerTargetTool)

const normalizeLocalContainerTarget = (
  container: AppLocalContainerTarget | null | undefined
): AppLocalContainerTarget =>
  !container || container.kind === 'host'
    ? hostContainerTarget
    : { kind: 'container', tool: container.tool, name: container.name }

export const getContainerTargetKey = (container: AppContainerTarget | null | undefined): string => {
  const normalizedContainer = normalizeContainerTarget(container)
  if (normalizedContainer.kind === 'host') return 'host'
  if (normalizedContainer.tool !== 'ssh') {
    return `${normalizedContainer.tool}:${normalizedContainer.name}`
  }

  const runtime = normalizedContainer.runtime ?? hostContainerTarget
  const runtimeKey = runtime.kind === 'host' ? 'host' : `${runtime.tool}:${runtime.name}`
  return `ssh:${normalizedContainer.name}/from:${runtimeKey}`
}

export const normalizeContainerTarget = (
  container: AppContainerTarget | null | undefined
): AppContainerTarget =>
  !container || container.kind === 'host' || container.tool !== 'ssh'
    ? normalizeLocalContainerTarget(container)
    : {
        kind: 'container',
        tool: 'ssh',
        name: container.name,
        runtime: normalizeLocalContainerTarget(container.runtime)
      }

const parseContainerTarget = (
  value: unknown,
  invalidMessage: string
): { tool: AppContainerTargetTool; name: string; runtime: unknown } | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(invalidMessage)

  const container = value as { kind?: unknown; tool?: unknown; name?: unknown; runtime?: unknown }
  if (container.kind === 'host') return null
  if (
    container.kind !== 'container' ||
    !isContainerTool(container.tool) ||
    typeof container.name !== 'string' ||
    container.name.trim().length === 0 ||
    container.name.includes('\0') ||
    container.name.includes('\n')
  ) {
    throw new Error(invalidMessage)
  }

  return { tool: container.tool, name: container.name.trim(), runtime: container.runtime }
}

export const requireContainerTarget = (
  value: unknown,
  options: { optional?: boolean } = {}
): AppContainerTarget | null => {
  if (value == null) return options.optional ? null : hostContainerTarget

  const container = parseContainerTarget(value, 'Invalid container target')
  if (!container) return hostContainerTarget
  const { tool, name } = container
  if (tool !== 'ssh') return { kind: 'container', tool, name }

  const runtime =
    container.runtime == null
      ? null
      : parseContainerTarget(container.runtime, 'Invalid remote runtime target')
  if (runtime?.tool === 'ssh') throw new Error('Invalid remote runtime target')
  return {
    kind: 'container',
    tool,
    name,
    runtime: runtime
      ? { kind: 'container', tool: runtime.tool, name: runtime.name }
      : hostContainerTarget
  }
}
