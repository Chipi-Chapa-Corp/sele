import { execFile } from 'node:child_process'
import type {
  AppContainerOptions,
  AppContainerSuggestion,
  AppContainerTarget,
  AppContainerTool
} from '../shared/app'
import { isExpectedCommandAbsenceError } from '../shared/expectedAbsence.ts'
import { getCurrentContainerTarget } from './currentContainer'
import { getHostCommand } from './hostProcess'
import {
  getRemoteContainerDiscoveryScript,
  parseRemoteContainerDiscoveryOutput,
  remoteContainerDiscoveryTimeoutMs
} from './remoteContainerDiscovery'
import { getProcessFailureMessage } from './processFailure'

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
// biome-ignore lint/suspicious/noControlCharactersInRegex: Strip terminal control sequences.
const ansiEscapePattern = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g

const stripAnsi = (value: string): string => value.replace(ansiEscapePattern, '')

const runHostTextCommand = async (
  file: string,
  args: string[],
  container?: AppContainerTarget | null,
  {
    required = false,
    timeout = containerCommandTimeoutMs
  }: { required?: boolean; timeout?: number } = {}
): Promise<string | null> => {
  const failure = (error: unknown, stdout = '', stderr = ''): Error =>
    new Error(
      getProcessFailureMessage(error, stdout, stderr, {
        label: 'SSH container discovery',
        timeoutMs: timeout
      })
    )
  let hostCommand
  try {
    hostCommand = await getHostCommand(file, args, { container })
  } catch (error) {
    if (required) throw failure(error)
    if (!isExpectedCommandAbsenceError(error)) {
      console.error(
        '[containerSuggestions:runHostTextCommand] Unable to resolve host command',
        error
      )
    }
    return null
  }

  return new Promise((resolve, reject) => {
    const handleFailure = (error: unknown, stdout?: string, stderr?: string): void =>
      required ? reject(failure(error, stdout, stderr)) : resolve(null)

    try {
      const child = execFile(
        hostCommand.file,
        hostCommand.args,
        {
          cwd: hostCommand.cwd,
          encoding: 'utf8',
          env: hostCommand.env,
          maxBuffer: containerCommandMaxBuffer,
          timeout
        },
        (error, stdout, stderr) => {
          if (error) {
            if (required || !isExpectedCommandAbsenceError(error)) {
              console.error(
                '[containerSuggestions:runHostTextCommand] Container command failed',
                error,
                stderr.trim()
              )
            }
            handleFailure(error, stdout, stderr)
          } else resolve(stdout.trimEnd())
        }
      )
      child.stdin?.end()
    } catch (error) {
      if (required || !isExpectedCommandAbsenceError(error)) {
        console.error('[containerSuggestions:runHostTextCommand] Container command failed', error)
      }
      handleFailure(error)
    }
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

const parseDistroboxContainers = (output: string): ContainerEntry[] => {
  const names = ['name']
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
      nameIndex >= 0 && nameIndex < fields.length ? nameIndex : fields.length >= 4 ? 1 : 0
    const name = getField(fields, resolvedNameIndex)
    if (!name) return []

    return [
      {
        tool: 'distrobox',
        runtimeId:
          runtimeIdIndex >= 0 ? normalizeRuntimeId(getField(fields, runtimeIdIndex)) : null,
        name,
        image: imageIndex >= 0 ? getField(fields, imageIndex) : null,
        status: statusIndex >= 0 ? getField(fields, statusIndex) : null
      }
    ]
  })
}

const parseDockerContainers = (output: string): ContainerEntry[] =>
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
          tool: 'docker',
          runtimeId: normalizeRuntimeId(runtimeIdField?.trim() || null),
          name,
          image: imageField?.trim() || null,
          status: statusField?.trim() || null
        }
      ]
    })

const getDistroboxContainers = async (
  container?: AppContainerTarget | null
): Promise<ContainerEntry[]> =>
  parseDistroboxContainers(
    (await runHostTextCommand('distrobox', ['list', '--no-color'], container)) ??
      (await runHostTextCommand('distrobox', ['list'], container)) ??
      ''
  )

const parsePodmanContainers = (output: string): ContainerEntry[] => {
  // Even `toolbox list` can run `podman system migrate` and stop running containers.
  // Read the same labels directly, with Distrobox ownership taking precedence over
  // Toolbx labels inherited from an image.
  const rows: unknown = JSON.parse(output)
  if (!Array.isArray(rows)) throw new Error('Invalid Podman container list')

  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const labels = row.Labels ?? {}
    const tool: AppContainerTool =
      labels.manager === 'distrobox'
        ? 'distrobox'
        : labels['com.github.containers.toolbox'] === 'true' ||
            labels['com.github.debarshiray.toolbox'] === 'true'
          ? 'toolbox'
          : 'podman'
    // Wrapper tools can start stopped containers; generic Podman targets use exec.
    if (tool === 'podman' && row.State !== 'running') return []
    const name = Array.isArray(row.Names) ? row.Names[0] : null
    if (typeof name !== 'string' || !name.trim()) return []
    const runtimeId = row.Id ?? row.ID

    return [
      {
        tool,
        runtimeId: normalizeRuntimeId(typeof runtimeId === 'string' ? runtimeId : null),
        name: name.trim(),
        image: typeof row.Image === 'string' ? row.Image : null,
        status: typeof row.Status === 'string' ? row.Status : null
      }
    ]
  })
}

const getPodmanContainers = async (
  container?: AppContainerTarget | null
): Promise<ContainerEntry[]> => {
  const output = await runHostTextCommand('podman', ['ps', '--all', '--format', 'json'], container)
  if (!output) return []

  try {
    return parsePodmanContainers(output)
  } catch (error) {
    console.error('[containerSuggestions:getPodmanContainers] Invalid container list', error)
    return []
  }
}

const getDockerContainers = async (
  container?: AppContainerTarget | null
): Promise<ContainerEntry[]> =>
  parseDockerContainers(
    (await runHostTextCommand(
      'docker',
      ['ps', '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'],
      container
    )) ?? ''
  )

const isCurrentContainer = (
  entry: ContainerEntry,
  currentContainer: AppContainerTarget | null
): boolean =>
  currentContainer?.kind === 'container' &&
  entry.tool === currentContainer.tool &&
  entry.name === currentContainer.name

const withCurrentContainer = (
  entries: ContainerEntry[],
  currentContainer: AppContainerTarget | null
): ContainerEntry[] => {
  if (currentContainer?.kind !== 'container' || currentContainer.tool === 'ssh') return entries

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
  // Distrobox's table uses short IDs; Podman's JSON returns full IDs.
  if (entry.runtimeId) return `id:${entry.runtimeId.slice(0, 12)}`
  if (entry.tool === 'distrobox' || entry.tool === 'toolbox') return `wrapped:${entry.name}`

  return `${entry.tool}:${entry.name}`
}

const getContainerEntryPriority = (
  entry: ContainerEntry,
  currentContainer: AppContainerTarget | null
): number =>
  (isCurrentContainer(entry, currentContainer) ? -10 : 0) + containerToolPriority[entry.tool]

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

const combineContainerEntries = (
  distroboxContainers: ContainerEntry[],
  podmanContainers: ContainerEntry[],
  dockerContainers: ContainerEntry[],
  currentContainer: AppContainerTarget | null
): ContainerEntry[] => {
  const wrappedContainers = dedupeContainerEntries(
    [...distroboxContainers, ...podmanContainers.filter(({ tool }) => tool !== 'podman')],
    currentContainer
  )
  const wrappedContainerNames = new Set(wrappedContainers.map(({ name }) => name))

  return dedupeContainerEntries(
    withCurrentContainer(
      [
        ...wrappedContainers,
        ...[...podmanContainers, ...dockerContainers].filter(
          ({ name }) => !wrappedContainerNames.has(name)
        )
      ],
      currentContainer
    ),
    currentContainer
  )
}

const getRemoteContainers = async (container: AppContainerTarget): Promise<ContainerEntry[]> => {
  const output = await runHostTextCommand(
    'sh',
    ['-lc', getRemoteContainerDiscoveryScript()],
    container,
    { required: true, timeout: remoteContainerDiscoveryTimeoutMs }
  )
  if (output == null) {
    throw new Error('Unable to check containers over SSH. Verify the connection and try again.')
  }

  const toolOutputs = parseRemoteContainerDiscoveryOutput(output)
  return combineContainerEntries(
    parseDistroboxContainers(toolOutputs.distrobox ?? ''),
    parsePodmanContainers(toolOutputs.podman || '[]'),
    parseDockerContainers(toolOutputs.docker ?? ''),
    null
  )
}

const toSuggestion = (entry: ContainerEntry): AppContainerSuggestion => ({
  id: `${entry.tool}:${entry.name}`,
  tool: entry.tool,
  name: entry.name,
  label: entry.name,
  description: [
    entry.current ? 'Current' : null,
    containerToolLabels[entry.tool],
    entry.status,
    entry.image
  ]
    .filter(Boolean)
    .join(' - '),
  status: entry.status,
  current: entry.current || undefined
})

export const getContainerSuggestions = async (
  options: AppContainerOptions = {}
): Promise<AppContainerSuggestion[]> => {
  const container = options.container
  const isRemote = container?.kind === 'container' && container.tool === 'ssh'
  if (process.platform !== 'linux' && !isRemote) return []

  if (isRemote) {
    return (await getRemoteContainers(container)).map(toSuggestion)
  }

  const [currentContainer, distroboxContainers, podmanContainers, dockerContainers] =
    await Promise.all([
      getCurrentContainerTarget(),
      getDistroboxContainers(container),
      getPodmanContainers(container),
      getDockerContainers(container)
    ])
  const entries = combineContainerEntries(
    distroboxContainers,
    podmanContainers,
    dockerContainers,
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
