import { Box, Boxes, Container, ToolCase } from 'lucide-react'
import type {
  AppContainerSuggestion,
  AppContainerTarget,
  AppContainerTool,
  AppLocalContainerTarget,
  AppSshEnvironment
} from '../../shared/app'

const legacyContainerSelectionStorageKeys = [
  'sele:container-selection:v3',
  'sele:container-selection:v2',
  'sele:container-selection:v1'
]
const containerSelectionStorageKey = 'sele:container-selection:v4'
export const hostContainerValue = 'host'

const isContainerTool = (value: unknown): value is AppContainerTool | 'ssh' =>
  value === 'distrobox' ||
  value === 'toolbox' ||
  value === 'podman' ||
  value === 'docker' ||
  value === 'ssh'

export const normalizeContainerTarget = (
  container: AppContainerTarget | null | undefined
): AppContainerTarget => {
  if (!container || container.kind === 'host') return { kind: 'host' }
  if (container.tool === 'ssh') {
    return {
      kind: 'container',
      tool: 'ssh',
      name: container.name,
      runtime:
        container.runtime?.kind === 'container'
          ? {
              kind: 'container',
              tool: container.runtime.tool,
              name: container.runtime.name
            }
          : { kind: 'host' }
    }
  }
  return { kind: 'container', tool: container.tool, name: container.name }
}

export const getContainerTargetKey = (container: AppContainerTarget | null | undefined): string => {
  const normalizedContainer = normalizeContainerTarget(container)
  if (normalizedContainer.kind === 'host') return hostContainerValue
  if (normalizedContainer.tool !== 'ssh') {
    return `${normalizedContainer.tool}:${normalizedContainer.name}`
  }

  const runtime = normalizedContainer.runtime ?? { kind: 'host' }
  const runtimeKey =
    runtime.kind === 'container' ? `${runtime.tool}:${runtime.name}` : hostContainerValue
  return `ssh:${normalizedContainer.name}/from:${runtimeKey}`
}

export const getContainerSelectionValue = (container: AppContainerTarget): string =>
  container.kind === 'container' && container.tool === 'ssh'
    ? `ssh:${container.name}`
    : getContainerTargetKey(container)

export const getContainerTargetFromSuggestion = (
  suggestion: AppContainerSuggestion
): AppLocalContainerTarget => ({
  kind: 'container',
  tool: suggestion.tool,
  name: suggestion.name
})

export const getContainerToolIcon = (tool: AppContainerTool): React.ReactNode => {
  if (tool === 'distrobox') return <Box aria-hidden="true" />
  if (tool === 'toolbox') return <ToolCase aria-hidden="true" />
  if (tool === 'podman') return <Boxes aria-hidden="true" />

  return <Container aria-hidden="true" />
}

export const getContainerSuggestionState = (suggestion: AppContainerSuggestion): string =>
  suggestion.status?.trim() || (suggestion.current ? 'Running' : 'Unknown')

export const isContainerTargetAvailable = (
  container: AppContainerTarget,
  suggestions: AppContainerSuggestion[],
  sshEnvironments: AppSshEnvironment[]
): boolean =>
  container.kind === 'host' ||
  (container.tool === 'ssh'
    ? sshEnvironments.some((environment) => environment.id === container.name)
    : suggestions.some(
        (suggestion) => suggestion.tool === container.tool && suggestion.name === container.name
      ))

const parseStoredContainerSelection = (
  storedValue: string | null,
  options: { allowHost: boolean }
): AppContainerTarget | null => {
  if (!storedValue) return null

  try {
    const parsedValue = JSON.parse(storedValue) as
      (Partial<AppContainerTarget> & { runtime?: unknown }) | null
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
      return null
    }
    if (parsedValue.kind === 'host') return options.allowHost ? { kind: 'host' } : null
    if (
      parsedValue.kind === 'container' &&
      isContainerTool(parsedValue.tool) &&
      typeof parsedValue.name === 'string' &&
      parsedValue.name.trim()
    ) {
      if (parsedValue.tool === 'ssh') {
        const runtime = parsedValue.runtime
        const normalizedRuntime: AppLocalContainerTarget =
          runtime &&
          typeof runtime === 'object' &&
          !Array.isArray(runtime) &&
          (runtime as { kind?: unknown }).kind === 'container' &&
          isContainerTool((runtime as { tool?: unknown }).tool) &&
          (runtime as { tool?: unknown }).tool !== 'ssh' &&
          typeof (runtime as { name?: unknown }).name === 'string' &&
          (runtime as { name: string }).name.trim()
            ? {
                kind: 'container',
                tool: (runtime as { tool: AppContainerTool }).tool,
                name: (runtime as { name: string }).name.trim()
              }
            : { kind: 'host' }

        return {
          kind: 'container',
          tool: 'ssh',
          name: parsedValue.name.trim(),
          runtime: normalizedRuntime
        }
      }

      return {
        kind: 'container',
        tool: parsedValue.tool,
        name: parsedValue.name.trim()
      }
    }
  } catch {
    return null
  }

  return null
}

export const readStoredContainerSelection = (): AppContainerTarget | null => {
  try {
    const storedSelection = parseStoredContainerSelection(
      window.localStorage.getItem(containerSelectionStorageKey),
      { allowHost: true }
    )
    if (storedSelection) return storedSelection

    for (const legacyStorageKey of legacyContainerSelectionStorageKeys) {
      const legacySelection = parseStoredContainerSelection(
        window.localStorage.getItem(legacyStorageKey),
        { allowHost: legacyStorageKey === 'sele:container-selection:v3' }
      )
      if (legacySelection) return legacySelection
    }

    return null
  } catch {
    return null
  }
}

export const writeStoredContainerSelection = (container: AppContainerTarget): void => {
  try {
    window.localStorage.setItem(
      containerSelectionStorageKey,
      JSON.stringify(normalizeContainerTarget(container))
    )
  } catch {
    // Container selection is a convenience preference; ignore unavailable storage.
  }
}
