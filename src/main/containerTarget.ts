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
): AppLocalContainerTarget => {
  if (!container || container.kind === 'host') return hostContainerTarget

  return {
    kind: 'container',
    tool: container.tool,
    name: container.name
  }
}

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
): AppContainerTarget => {
  if (!container || container.kind === 'host') return hostContainerTarget

  if (container.tool === 'ssh') {
    return {
      kind: 'container',
      tool: 'ssh',
      name: container.name,
      runtime: normalizeLocalContainerTarget(container.runtime)
    }
  }

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

  const container = value as {
    kind?: unknown
    tool?: unknown
    name?: unknown
    runtime?: unknown
  }
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

  const normalizedName = container.name.trim()
  if (container.tool !== 'ssh') {
    return {
      kind: 'container',
      tool: container.tool,
      name: normalizedName
    }
  }

  const runtime = container.runtime
  if (runtime == null) {
    return {
      kind: 'container',
      tool: 'ssh',
      name: normalizedName,
      runtime: hostContainerTarget
    }
  }
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) {
    throw new Error('Invalid remote runtime target')
  }

  const remoteRuntime = runtime as { kind?: unknown; tool?: unknown; name?: unknown }
  if (remoteRuntime.kind === 'host') {
    return {
      kind: 'container',
      tool: 'ssh',
      name: normalizedName,
      runtime: hostContainerTarget
    }
  }
  if (
    remoteRuntime.kind !== 'container' ||
    !isContainerTool(remoteRuntime.tool) ||
    remoteRuntime.tool === 'ssh' ||
    typeof remoteRuntime.name !== 'string' ||
    remoteRuntime.name.trim().length === 0 ||
    remoteRuntime.name.includes('\0') ||
    remoteRuntime.name.includes('\n')
  ) {
    throw new Error('Invalid remote runtime target')
  }

  return {
    kind: 'container',
    tool: 'ssh',
    name: normalizedName,
    runtime: {
      kind: 'container',
      tool: remoteRuntime.tool,
      name: remoteRuntime.name.trim()
    }
  }
}
