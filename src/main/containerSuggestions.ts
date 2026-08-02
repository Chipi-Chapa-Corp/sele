import { execFile } from 'node:child_process'
import type { AppContainerSuggestion, AppContainerTarget, AppContainerTool } from '../shared/app'
import { getCurrentContainerTarget } from './currentContainer'
import { getHostCommand } from './hostProcess'

type ContainerEntry = {
  tool: AppContainerTool
  runtimeId: string | null
  name: string
  image: string | null
  status: string | null
  current?: boolean
}

const containerCommandMaxBuffer = 512 * 1024
const containerCommandTimeoutMs = 5_000

const containerToolLabels = {
  distrobox: 'Distrobox',
  toolbox: 'Toolbox',
  podman: 'Podman',
  docker: 'Docker'
} satisfies Record<AppContainerTool, string>

const containerToolPriority = {
  distrobox: 0,
  toolbox: 1,
  podman: 2,
  docker: 3
} satisfies Record<AppContainerTool, number>

// ANSI output uses ESC control sequences; strip them before parsing CLI tables.
// eslint-disable-next-line no-control-regex
const ansiEscapePattern = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g

const stripAnsi = (value: string): string => value.replace(ansiEscapePattern, '')

const runHostTextCommand = async (file: string, args: string[]): Promise<string | null> => {
  let hostCommand
  try {
    hostCommand = await getHostCommand(file, args)
  } catch {
    return null
  }

  return new Promise((resolve) => {
    execFile(
      hostCommand.file,
      hostCommand.args,
      {
        cwd: hostCommand.cwd,
        encoding: 'utf8',
        env: hostCommand.env,
        maxBuffer: containerCommandMaxBuffer,
        timeout: containerCommandTimeoutMs
      },
      (error, stdout) => {
        resolve(error ? null : stdout.trimEnd())
      }
    )
  })
}

const normalizeHeader = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()

const splitTableLine = (line: string): string[] => {
  const normalizedLine = stripAnsi(line).trim()
  if (!normalizedLine || /^[-+\s|]+$/.test(normalizedLine)) return []

  if (normalizedLine.includes('|')) {
    return normalizedLine
      .split('|')
      .map((field) => field.trim())
      .filter(Boolean)
  }

  return normalizedLine
    .split(/\s{2,}/)
    .map((field) => field.trim())
    .filter(Boolean)
}

const getColumnIndex = (fields: string[], names: readonly string[]): number => {
  const normalizedNames = new Set(names.map(normalizeHeader))
  return fields.findIndex((field) => normalizedNames.has(normalizeHeader(field)))
}

const getField = (fields: string[], index: number): string | null => {
  const field = fields[index]?.trim()
  return field ? field : null
}

const normalizeRuntimeId = (value: string | null): string | null => {
  const id = value?.trim().toLocaleLowerCase()
  return id && /^[a-f0-9]{12,64}$/.test(id) ? id : null
}

const parseContainerTable = (
  output: string,
  tool: AppContainerTool,
  names: readonly string[],
  fallbackNameIndex: (fields: string[]) => number
): ContainerEntry[] => {
  const rows = output
    .split('\n')
    .map(splitTableLine)
    .filter((fields) => fields.length > 0)

  const headerIndex = rows.findIndex((fields) => getColumnIndex(fields, names) >= 0)
  const header = headerIndex >= 0 ? rows[headerIndex] : []
  const nameIndex = getColumnIndex(header, names)
  const runtimeIdIndex = getColumnIndex(header, ['id', 'container id'])
  const statusIndex = getColumnIndex(header, ['status'])
  const imageIndex = getColumnIndex(header, ['image', 'image name'])
  const dataRows = rows.slice(headerIndex >= 0 ? headerIndex + 1 : 0)

  return dataRows.flatMap((fields) => {
    if (getColumnIndex(fields, names) >= 0) return []

    const resolvedNameIndex =
      nameIndex >= 0 && nameIndex < fields.length ? nameIndex : fallbackNameIndex(fields)
    const name = getField(fields, resolvedNameIndex)
    if (!name) return []

    return [
      {
        tool,
        runtimeId:
          runtimeIdIndex >= 0 ? normalizeRuntimeId(getField(fields, runtimeIdIndex)) : null,
        name,
        image: imageIndex >= 0 ? getField(fields, imageIndex) : null,
        status: statusIndex >= 0 ? getField(fields, statusIndex) : null
      }
    ]
  })
}

const parseFormattedContainers = (output: string, tool: AppContainerTool): ContainerEntry[] =>
  output
    .split('\n')
    .map((line) => stripAnsi(line).trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [runtimeIdField, nameField, imageField, statusField] = line.split('\t')
      const name = nameField?.split(',')[0]?.trim()
      if (!name) return []

      return [
        {
          tool,
          runtimeId: normalizeRuntimeId(runtimeIdField?.trim() || null),
          name,
          image: imageField?.trim() || null,
          status: statusField?.trim() || null
        }
      ]
    })

const getDistroboxContainers = async (): Promise<ContainerEntry[]> => {
  const output =
    (await runHostTextCommand('distrobox', ['list', '--no-color'])) ??
    (await runHostTextCommand('distrobox', ['list']))
  if (!output) return []

  return parseContainerTable(output, 'distrobox', ['name'], (fields) =>
    fields.length >= 4 ? 1 : 0
  )
}

const getToolboxContainers = async (): Promise<ContainerEntry[]> => {
  const output = await runHostTextCommand('toolbox', ['list', '--containers'])
  if (!output) return []

  return parseContainerTable(output, 'toolbox', ['container name', 'name'], (fields) =>
    fields.length > 1 ? 1 : 0
  )
}

const getPodmanContainers = async (): Promise<ContainerEntry[]> => {
  const output = await runHostTextCommand('podman', [
    'ps',
    '--format',
    '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'
  ])
  if (!output) return []

  return parseFormattedContainers(output, 'podman')
}

const getDockerContainers = async (): Promise<ContainerEntry[]> => {
  const output = await runHostTextCommand('docker', [
    'ps',
    '--format',
    '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'
  ])
  if (!output) return []

  return parseFormattedContainers(output, 'docker')
}

const isCurrentContainer = (
  entry: Pick<ContainerEntry, 'tool' | 'name'>,
  currentContainer: AppContainerTarget | null
): boolean =>
  currentContainer?.kind === 'container' &&
  entry.tool === currentContainer.tool &&
  entry.name === currentContainer.name

const withCurrentContainer = (
  entries: ContainerEntry[],
  currentContainer: AppContainerTarget | null
): ContainerEntry[] => {
  if (currentContainer?.kind !== 'container') return entries

  let foundCurrentContainer = false
  const markedEntries = entries.map((entry) => {
    if (!isCurrentContainer(entry, currentContainer)) return entry

    foundCurrentContainer = true
    return { ...entry, current: true }
  })

  if (foundCurrentContainer) return markedEntries

  return [
    {
      tool: currentContainer.tool,
      runtimeId: null,
      name: currentContainer.name,
      image: null,
      status: 'Running',
      current: true
    },
    ...markedEntries
  ]
}

const getContainerEntryDedupeKey = (entry: ContainerEntry): string => {
  if (entry.runtimeId) return `id:${entry.runtimeId}`
  if (entry.tool === 'distrobox' || entry.tool === 'toolbox') return `wrapped:${entry.name}`

  return `${entry.tool}:${entry.name}`
}

const getContainerEntryPriority = (
  entry: ContainerEntry,
  currentContainer: AppContainerTarget | null
): number => {
  const currentToolPriority =
    currentContainer?.kind === 'container' &&
    entry.name === currentContainer.name &&
    entry.tool === currentContainer.tool
      ? -10
      : 0

  return currentToolPriority + containerToolPriority[entry.tool]
}

const mergeContainerEntries = (
  preferredEntry: ContainerEntry,
  fallbackEntry: ContainerEntry
): ContainerEntry => ({
  ...preferredEntry,
  runtimeId: preferredEntry.runtimeId ?? fallbackEntry.runtimeId,
  image: preferredEntry.image ?? fallbackEntry.image,
  status: preferredEntry.status ?? fallbackEntry.status,
  current: preferredEntry.current || fallbackEntry.current || undefined
})

const preferContainerEntry = (
  first: ContainerEntry,
  second: ContainerEntry,
  currentContainer: AppContainerTarget | null
): ContainerEntry => {
  const firstPriority = getContainerEntryPriority(first, currentContainer)
  const secondPriority = getContainerEntryPriority(second, currentContainer)

  if (secondPriority < firstPriority) return mergeContainerEntries(second, first)

  return mergeContainerEntries(first, second)
}

const dedupeContainerEntries = (
  entries: ContainerEntry[],
  currentContainer: AppContainerTarget | null
): ContainerEntry[] => {
  const entriesByKey = new Map<string, ContainerEntry>()

  for (const entry of entries) {
    const key = getContainerEntryDedupeKey(entry)
    const existingEntry = entriesByKey.get(key)
    entriesByKey.set(
      key,
      existingEntry ? preferContainerEntry(existingEntry, entry, currentContainer) : entry
    )
  }

  return [...entriesByKey.values()]
}

const getSuggestionDescription = (entry: ContainerEntry): string | null => {
  const parts = [
    entry.current ? 'Current' : null,
    containerToolLabels[entry.tool],
    entry.status,
    entry.image
  ].filter((part): part is string => Boolean(part))

  return parts.length > 0 ? parts.join(' - ') : null
}

const toSuggestion = (entry: ContainerEntry): AppContainerSuggestion => ({
  id: `${entry.tool}:${entry.name}`,
  tool: entry.tool,
  name: entry.name,
  label: entry.name,
  description: getSuggestionDescription(entry),
  status: entry.status,
  current: entry.current || undefined
})

export const getContainerSuggestions = async (): Promise<AppContainerSuggestion[]> => {
  if (process.platform !== 'linux') return []

  const [currentContainer, distroboxContainers, toolboxContainers] = await Promise.all([
    getCurrentContainerTarget(),
    getDistroboxContainers(),
    getToolboxContainers()
  ])
  const wrappedContainers = dedupeContainerEntries(
    [...distroboxContainers, ...toolboxContainers],
    currentContainer
  )
  const wrappedContainerNames = new Set(wrappedContainers.map((container) => container.name))
  const [podmanContainers, dockerContainers] = await Promise.all([
    getPodmanContainers(),
    getDockerContainers()
  ])
  const entries = dedupeContainerEntries(
    withCurrentContainer(
      [
        ...wrappedContainers,
        ...podmanContainers.filter((container) => !wrappedContainerNames.has(container.name)),
        ...dockerContainers.filter((container) => !wrappedContainerNames.has(container.name))
      ],
      currentContainer
    ),
    currentContainer
  )
  const seenIds = new Set<string>()

  return entries.flatMap((entry) => {
    const suggestion = toSuggestion(entry)
    if (seenIds.has(suggestion.id)) return []

    seenIds.add(suggestion.id)
    return [suggestion]
  })
}
