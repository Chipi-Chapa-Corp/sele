import type {
  AppContainerSuggestion,
  AppContainerTarget,
  AppLocalContainerTarget
} from '../../shared/app'

export type FileEnvironmentChoice = {
  value: string
  label: string
  description: string | null
  container: AppContainerTarget
}

const normalizeLocalContainer = (
  container: AppLocalContainerTarget | null | undefined
): AppLocalContainerTarget =>
  container?.kind === 'container'
    ? { kind: 'container', tool: container.tool, name: container.name }
    : { kind: 'host' }

export const getFileEnvironmentKey = (container: AppContainerTarget | null | undefined): string => {
  if (!container || container.kind === 'host') return 'host'
  if (container.tool !== 'ssh') return `${container.tool}:${container.name}`

  const runtime = normalizeLocalContainer(container.runtime)
  const runtimeKey = runtime.kind === 'host' ? 'host' : `${runtime.tool}:${runtime.name}`
  return `ssh:${container.name}/from:${runtimeKey}`
}

export const getAlternateFileEnvironments = (
  container: AppContainerTarget | null | undefined,
  suggestions: readonly AppContainerSuggestion[]
): FileEnvironmentChoice[] => {
  const currentKey = getFileEnvironmentKey(container)
  const isRemote = container?.kind === 'container' && container.tool === 'ssh'

  const hostContainer: AppContainerTarget = isRemote
    ? {
        kind: 'container',
        tool: 'ssh',
        name: container.name,
        runtime: { kind: 'host' }
      }
    : { kind: 'host' }
  const choices: FileEnvironmentChoice[] = [
    {
      value: getFileEnvironmentKey(hostContainer),
      label: isRemote ? 'Remote host' : 'Host',
      description: null,
      container: hostContainer
    },
    ...suggestions.map((suggestion): FileEnvironmentChoice => {
      const runtime: AppLocalContainerTarget = {
        kind: 'container',
        tool: suggestion.tool,
        name: suggestion.name
      }
      const target: AppContainerTarget = isRemote
        ? {
            kind: 'container',
            tool: 'ssh',
            name: container.name,
            runtime
          }
        : runtime

      return {
        value: getFileEnvironmentKey(target),
        label: suggestion.label || suggestion.name,
        description: suggestion.description,
        container: target
      }
    })
  ]

  const seen = new Set<string>()
  return choices.filter((choice) => {
    if (choice.value === currentKey || seen.has(choice.value)) return false
    seen.add(choice.value)
    return true
  })
}

export const isMissingFileError = (message: string | null | undefined): boolean =>
  Boolean(
    message &&
    /(?:\bENOENT\b|no such file or directory|file not found|cannot find the (?:file|path)|choose a regular image file)/i.test(
      message
    )
  )
