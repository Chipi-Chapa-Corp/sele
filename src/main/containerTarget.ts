import type { AppContainerTarget, AppContainerTargetTool } from '../shared/app'

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

export const getContainerTargetKey = (container: AppContainerTarget | null | undefined): string =>
  container?.kind === 'container' ? `${container.tool}:${container.name}` : 'host'

export const normalizeContainerTarget = (
  container: AppContainerTarget | null | undefined
): AppContainerTarget => {
  if (!container || container.kind === 'host') return hostContainerTarget

  return {
    kind: 'container',
    tool: container.tool,
    name: container.name
  }
}

export const requireContainerTarget = (
  value: unknown,
  options: { optional?: boolean } = {}
): AppContainerTarget | null => {
  if (value == null) return options.optional ? null : hostContainerTarget
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid container target')
  }

  const container = value as { kind?: unknown; tool?: unknown; name?: unknown }
  if (container.kind === 'host') return hostContainerTarget
  if (
    container.kind !== 'container' ||
    !isContainerTool(container.tool) ||
    typeof container.name !== 'string' ||
    container.name.trim().length === 0 ||
    container.name.includes('\0') ||
    container.name.includes('\n')
  ) {
    throw new Error('Invalid container target')
  }

  return {
    kind: 'container',
    tool: container.tool,
    name: container.name.trim()
  }
}
