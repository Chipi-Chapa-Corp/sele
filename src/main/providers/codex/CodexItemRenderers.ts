import type {
  ProviderChatItem,
  ProviderFileDiff,
  ProviderMessage,
  ProviderToolActivity,
  ProviderWorkingItem,
  ProviderWorkingStep,
  ProviderWorkingToolStatus
} from '../../../shared/provider'
import { getNestedToolCalls, isPatchToolCall } from './CodexToolCalls'

export type CodexUserInput =
  | { type: 'text'; text: string }
  | { type: 'image' | 'localImage' }
  | { type: 'skill' | 'mention'; name: string }

export type CodexThreadItem = {
  type: string
  id: string
  clientId?: string | null
  content?: CodexUserInput[]
  text?: string
  phase?: 'commentary' | 'final_answer' | null
  command?: string
  server?: string
  tool?: string
  namespace?: string | null
  query?: string
  arguments?: unknown
  changes?: {
    path: string
    kind: { type: 'add' | 'delete' } | { type: 'update'; move_path: string | null }
    diff: string
  }[]
  aggregatedOutput?: string | null
  result?: unknown
  error?: unknown
  customToolName?: string
  customToolInput?: string | null
  customToolOutput?: unknown
  rawToolData?: unknown[]
  summary?: string[]
  status?: ProviderWorkingToolStatus
}

export type CodexTurn = {
  id: string
  status?: string | null
  model?: string | null
  startedAt?: number | null
  completedAt?: number | null
  items: CodexThreadItem[]
}

type GetChatItemsOptions = {
  hiddenPendingMessageIds?: ReadonlySet<string>
  pendingSteeringMessageIds?: ReadonlySet<string>
}

type WorkingItemRenderResult =
  | { type: 'message'; content: string }
  | {
      type: 'tool'
      activity: ProviderToolActivity
      toolId: string
      status: ProviderWorkingToolStatus
      label: string
      command: string | null
      stdout: string | null
      diffs: ProviderFileDiff[]
      backgroundSessionId: string | null
      finishedBackgroundSessionId: string | null
      rawInput: unknown
      rawOutput: unknown
    }

type WorkingItemRenderMatcher = {
  matches: (item: CodexThreadItem) => boolean
  render: (item: CodexThreadItem) => WorkingItemRenderResult | WorkingItemRenderResult[] | null
}

type ShellToken = {
  value: string
  quoted: boolean
}

const truncate = (value: string, length = 120): string =>
  value.length > length ? `${value.slice(0, length - 1)}…` : value

const getFileName = (path: string): string => path.split(/[/\\]/).pop() || path

const tokenizeShellCommand = (command: string): ShellToken[] => {
  const tokens: ShellToken[] = []
  const normalizedCommand = command.replace(/\r\n?/g, '\n')
  let current = ''
  let quote: string | null = null
  let escaped = false
  let quoted = false

  const pushCurrent = (): void => {
    if (!current) return
    tokens.push({ value: current, quoted })
    current = ''
    quoted = false
  }

  for (let index = 0; index < normalizedCommand.length; index += 1) {
    const character = normalizedCommand[index]
    const nextCharacter = normalizedCommand[index + 1]

    if (escaped) {
      current += character
      escaped = false
      continue
    }

    if (character === '\\') {
      escaped = true
      continue
    }

    if (quote) {
      if (character === quote) quote = null
      else current += character
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      quoted = true
      continue
    }

    if (character === '\n') {
      pushCurrent()
      tokens.push({ value: ';', quoted: false })
      continue
    }

    if (/\s/.test(character)) {
      pushCurrent()
      continue
    }

    if (character === ';' || character === '|' || (character === '&' && nextCharacter === '&')) {
      pushCurrent()
      tokens.push({ value: character === '&' ? '&&' : character, quoted: false })
      if (character === '&') index += 1
      continue
    }

    current += character
  }

  pushCurrent()
  return tokens
}

const isPathLikeToken = (token: string): boolean =>
  token.length > 0 &&
  token !== '-' &&
  !token.startsWith('-') &&
  !token.startsWith('$') &&
  !token.includes('=') &&
  !['>', '>>', '<', '2>', '2>>', '&>'].includes(token)

const skipOptions = (
  tokens: ShellToken[],
  optionValueFlags = new Set(['-C', '-d', '-e', '-f', '-g', '-m', '-p'])
): ShellToken[] => {
  const remaining: ShellToken[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const value = tokens[index].value
    if (value === '--') {
      remaining.push(...tokens.slice(index + 1))
      break
    }
    if (!value.startsWith('-') || value === '-') {
      remaining.push(tokens[index])
      continue
    }
    if (
      optionValueFlags.has(value) &&
      tokens[index + 1] &&
      !tokens[index + 1].value.startsWith('-')
    ) {
      index += 1
    }
  }

  return remaining
}

const extractReadPathsFromSegment = (segment: ShellToken[]): string[] => {
  if (segment.length === 0) return []

  const [first, second, ...rest] = segment
  const executable = getFileName(first.value)
  const command = executable === 'command' && second?.value === '-v' ? 'command -v' : executable
  const args = command === 'command -v' ? rest : segment.slice(1)

  if (['pwd', 'which', 'command -v'].includes(command)) return []

  if (command === 'git') {
    const subcommand = args[0]?.value
    if (!subcommand || !['status', 'diff', 'log', 'show', 'branch'].includes(subcommand)) return []
    const pathSeparatorIndex = args.findIndex((token) => token.value === '--')
    return pathSeparatorIndex >= 0
      ? args
          .slice(pathSeparatorIndex + 1)
          .map((token) => token.value)
          .filter(isPathLikeToken)
      : []
  }

  if (command === 'sed') {
    const remaining = skipOptions(args)
    return remaining
      .slice(1)
      .map((token) => token.value)
      .filter(isPathLikeToken)
  }

  if (command === 'rg' || command === 'grep') {
    const hasFilesMode = args.some((token) => token.value === '--files')
    const remaining = skipOptions(args)
    return remaining
      .slice(hasFilesMode ? 0 : 1)
      .map((token) => token.value)
      .filter(isPathLikeToken)
  }

  if (
    [
      'cat',
      'head',
      'tail',
      'nl',
      'wc',
      'stat',
      'file',
      'tree',
      'du',
      'realpath',
      'readlink',
      'ls',
      'find'
    ].includes(command)
  ) {
    return skipOptions(args, new Set(command === 'head' || command === 'tail' ? ['-c', '-n'] : []))
      .map((token) => token.value)
      .filter(isPathLikeToken)
  }

  return []
}

type ShellSegment = {
  tokens: ShellToken[]
  operatorBefore: string | null
}

type SegmentClassification = {
  activity: 'read' | 'search' | 'git' | 'npm' | 'npx' | 'script' | 'command' | 'neutral'
  command: string
  args: ShellToken[]
}

type CommandClassification = {
  activity: Extract<
    ProviderToolActivity,
    'read' | 'search' | 'git' | 'npm' | 'npx' | 'script' | 'command'
  >
  label: string
  command: string
}

const readCommands = new Set([
  'cat',
  'less',
  'head',
  'tail',
  'sed',
  'nl',
  'wc',
  'stat',
  'file',
  'tree',
  'du',
  'realpath',
  'readlink',
  'ls'
])

const searchCommands = new Set(['rg', 'grep', 'find'])
const scriptCommands = new Set(['bash', 'sh', 'node', 'python', 'python3'])
const shellEvalCommands = new Set(['bash', 'sh', 'zsh'])

const executionCommands = new Set([
  'npm',
  'pnpm',
  'yarn',
  'deno',
  'bun',
  'cargo',
  'go',
  'make',
  'cmake',
  'pytest',
  'vitest',
  'jest',
  'eslint',
  'tsc',
  'vite',
  'electron',
  'codex',
  'rm',
  'dd',
  'esbuild'
])

const getShellSegments = (command: string): ShellSegment[] => {
  const segments: ShellSegment[] = []
  let segment: ShellToken[] = []
  let operatorBefore: string | null = null

  for (const token of tokenizeShellCommand(command)) {
    if ([';', '|', '&&'].includes(token.value)) {
      if (segment.length > 0) segments.push({ tokens: segment, operatorBefore })
      segment = []
      operatorBefore = token.value
      continue
    }

    segment.push(token)
  }

  if (segment.length > 0) segments.push({ tokens: segment, operatorBefore })
  return segments
}

const getSegmentCommand = (
  segment: ShellToken[]
): { command: string; args: ShellToken[] } | null => {
  if (segment.length === 0) return null

  const [first, second, ...rest] = segment
  const executable = getFileName(first.value)
  if (executable === 'command' && second?.value === '-v') {
    return { command: 'command -v', args: rest }
  }

  return { command: executable, args: segment.slice(1) }
}

const classifySegment = (segment: ShellSegment): SegmentClassification | null => {
  const parsed = getSegmentCommand(segment.tokens)
  if (!parsed) return null

  const { command, args } = parsed
  if (['cd', 'pwd', 'which', 'command -v'].includes(command)) {
    return { activity: 'neutral', command, args }
  }
  if (command === 'git') return { activity: 'git', command, args }
  if (searchCommands.has(command)) return { activity: 'search', command, args }
  if (readCommands.has(command)) return { activity: 'read', command, args }
  if (command === 'npm' && args.some((token) => token.value === 'run')) {
    return { activity: 'npm', command, args }
  }
  if (command === 'npx') return { activity: 'npx', command, args }
  if (scriptCommands.has(command)) return { activity: 'script', command, args }
  if (executionCommands.has(command)) return { activity: 'command', command, args }

  return { activity: 'command', command, args }
}

const extractReadPathsFromClassification = (classification: SegmentClassification): string[] => {
  if (classification.activity !== 'read') return []
  const segment = [{ value: classification.command, quoted: false }, ...classification.args]
  return extractReadPathsFromSegment(segment)
}

const getReadCommandTargets = (classifications: SegmentClassification[]): string[] => {
  const paths: string[] = []
  for (const classification of classifications) {
    paths.push(...extractReadPathsFromClassification(classification))
  }
  return [...new Set(paths)]
}

const getSkillNameFromPath = (path: string): string | null => {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.at(-1) !== 'SKILL.md') return null
  return parts.at(-2) ?? 'skill'
}

const getReadToolLabel = (command: string, classifications: SegmentClassification[]): string => {
  const targets = getReadCommandTargets(classifications)
  const skillNames = targets
    .map(getSkillNameFromPath)
    .filter((name): name is string => name != null)
  if (skillNames.length > 0 && skillNames.length === targets.length) {
    const visibleSkills = skillNames.slice(0, 3).join(', ')
    return skillNames.length === 1
      ? visibleSkills === 'skill'
        ? 'Read skill'
        : `Read ${visibleSkills} skill`
      : `Read ${visibleSkills}${skillNames.length > 3 ? ', …' : ''} skills`
  }

  const files = targets.map(getFileName)
  if (files.length === 0) return `Read ${truncate(command.replace(/\s+/g, ' '), 80)}`

  const visibleFiles = files.slice(0, 3).join(', ')
  return files.length === 1
    ? `Read file ${visibleFiles}`
    : `Read files ${visibleFiles}${files.length > 3 ? ', …' : ''}`
}

const getSearchDetailsFromSegment = (
  classification: SegmentClassification
): { query: string | null; paths: string[] } => {
  if (classification.command === 'find') {
    const path = skipOptions(classification.args)[0]?.value
    return { query: null, paths: path && isPathLikeToken(path) ? [path] : [] }
  }

  const hasFilesMode = classification.args.some((token) => token.value === '--files')
  const remaining = skipOptions(classification.args)
  const query = hasFilesMode ? null : (remaining[0]?.value ?? null)
  const paths = remaining
    .slice(hasFilesMode ? 0 : 1)
    .map((token) => token.value)
    .filter(isPathLikeToken)

  return { query, paths }
}

const getSearchToolLabel = (command: string, classifications: SegmentClassification[]): string => {
  const search = classifications.find((classification) => classification.activity === 'search')
  if (!search) return `Searched ${truncate(command.replace(/\s+/g, ' '), 80)}`

  const details = getSearchDetailsFromSegment(search)
  const visiblePath = details.paths.map(getFileName).slice(0, 2).join(', ')

  if (details.query && visiblePath)
    return `Searched ${visiblePath} for ${truncate(details.query, 60)}`
  if (details.query) return `Searched for ${truncate(details.query, 80)}`
  if (visiblePath) return `Searched ${visiblePath}`
  return 'Searched files'
}

const getGitToolLabel = (classifications: SegmentClassification[]): string => {
  const git = classifications.find((classification) => classification.activity === 'git')
  const subcommand = git
    ? skipOptions(git.args, new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']))[0]
        ?.value
    : null

  if (subcommand === 'status') return 'Checked git status'
  if (subcommand === 'diff') return 'Viewed git diff'
  if (subcommand === 'log') return 'Viewed git log'
  if (subcommand === 'show') return 'Viewed git show'
  if (subcommand === 'branch') return 'Checked git branch'
  return subcommand ? `Ran git ${subcommand}` : 'Ran git'
}

const getNpmToolLabel = (classification: SegmentClassification): string => {
  const runIndex = classification.args.findIndex((token) => token.value === 'run')
  const script = classification.args
    .slice(runIndex + 1)
    .find((token) => !token.value.startsWith('-'))?.value

  return script ? `Ran npm script ${truncate(script, 60)}` : 'Ran npm script'
}

const getNpxToolLabel = (classification: SegmentClassification): string => {
  const tool = classification.args.find((token) => !token.value.startsWith('-'))?.value
  return tool ? `Ran npx tool ${truncate(tool, 60)}` : 'Ran npx tool'
}

const getScriptToolLabel = (classification: SegmentClassification): string => {
  const runtimeNames: Record<string, string> = {
    bash: 'Bash',
    sh: 'shell',
    node: 'Node',
    python: 'Python',
    python3: 'Python'
  }
  const evaluatesInline = classification.args.some((token) =>
    ['-c', '-lc', '-e', '--eval'].includes(token.value)
  )
  const target = evaluatesInline
    ? null
    : classification.args.find((token) => !token.value.startsWith('-'))?.value
  const runtime = runtimeNames[classification.command] ?? classification.command

  return target && isPathLikeToken(target)
    ? `Ran ${runtime} script ${truncate(getFileName(target), 60)}`
    : `Ran ${runtime} script`
}

const isShellEvalOption = (option: string): boolean =>
  option.startsWith('-') && !option.startsWith('--') && option.includes('c')

const getShellEvalCommand = (classification: SegmentClassification): string | null => {
  if (!shellEvalCommands.has(classification.command)) return null

  const commandOptionIndex = classification.args.findIndex((token) =>
    isShellEvalOption(token.value)
  )
  const commandToken =
    commandOptionIndex >= 0 ? classification.args[commandOptionIndex + 1] : undefined
  const innerCommand = commandToken?.value.trim()
  return innerCommand || null
}

const getClassifiedShellCommand = (
  command: string,
  depth = 0
): { command: string; classification: SegmentClassification | null } => {
  const firstClassification =
    getShellSegments(command)
      .map(classifySegment)
      .find((classification) => classification != null && classification.activity !== 'neutral') ??
    null

  if (!firstClassification || depth >= 3) {
    return { command, classification: firstClassification }
  }

  const innerCommand = getShellEvalCommand(firstClassification)
  return innerCommand
    ? getClassifiedShellCommand(innerCommand, depth + 1)
    : { command, classification: firstClassification }
}

const classifyCommand = (command: string): CommandClassification[] => {
  const classifiedShellCommand = getClassifiedShellCommand(command)
  const classifiedCommand = classifiedShellCommand.command
  const firstClassification = classifiedShellCommand.classification

  if (!firstClassification || firstClassification.activity === 'neutral') {
    return [{ activity: 'command', label: 'Ran a command', command: classifiedCommand }]
  }

  const { activity } = firstClassification
  if (activity === 'read') {
    return [
      {
        activity,
        label: getReadToolLabel(classifiedCommand, [firstClassification]),
        command: classifiedCommand
      }
    ]
  }
  if (activity === 'search') {
    return [
      {
        activity,
        label: getSearchToolLabel(classifiedCommand, [firstClassification]),
        command: classifiedCommand
      }
    ]
  }
  if (activity === 'git') {
    return [{ activity, label: getGitToolLabel([firstClassification]), command: classifiedCommand }]
  }
  if (activity === 'npm') {
    return [{ activity, label: getNpmToolLabel(firstClassification), command: classifiedCommand }]
  }
  if (activity === 'npx') {
    return [{ activity, label: getNpxToolLabel(firstClassification), command: classifiedCommand }]
  }
  if (activity === 'script') {
    return [
      { activity, label: getScriptToolLabel(firstClassification), command: classifiedCommand }
    ]
  }

  return [
    {
      activity: 'command',
      label: `Ran ${firstClassification.command}`,
      command: classifiedCommand
    }
  ]
}

const getToolCallMarkerIndex = (input: string, toolName: string): number => {
  const toolMarkerIndex = input.indexOf(`tools.${toolName}(`)
  if (toolMarkerIndex >= 0) return toolMarkerIndex
  return input.indexOf(`functions.${toolName}(`)
}

const getJsonRecord = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

const getJsonToolArgument = (input: string, toolName: string): Record<string, unknown> | null => {
  const trimmedInput = input.trim()
  if (trimmedInput.startsWith('{')) {
    const parsedInput = getJsonRecord(trimmedInput)
    if (parsedInput) return parsedInput
  }

  const markerIndex = getToolCallMarkerIndex(input, toolName)
  const objectStart = input.indexOf('{', markerIndex)
  if (markerIndex < 0 || objectStart < 0) return null

  let depth = 0
  let quote: string | null = null
  let escaped = false

  for (let index = objectStart; index < input.length; index += 1) {
    const character = input[index]

    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = null
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      continue
    }

    if (character === '{') depth += 1
    if (character === '}') depth -= 1
    if (depth !== 0) continue

    try {
      return JSON.parse(input.slice(objectStart, index + 1)) as Record<string, unknown>
    } catch {
      return null
    }
  }

  return null
}

const getToolStringArgument = (input: string, toolName: string, key: string): string | null => {
  const parsedValue = getJsonToolArgument(input, toolName)?.[key]
  if (typeof parsedValue === 'string') return parsedValue

  const markerIndex = getToolCallMarkerIndex(input, toolName)
  const searchInput = markerIndex >= 0 ? input.slice(markerIndex) : input

  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = searchInput.match(
    new RegExp(`["']?${escapedKey}["']?\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`)
  )
  if (!match) return null

  try {
    const value = JSON.parse(match[1])
    return typeof value === 'string' ? value : null
  } catch {
    return match[1]
      .slice(1, -1)
      .replace(/\\(u[\dA-Fa-f]{4}|x[\dA-Fa-f]{2}|[\\"'bfnrtv0])/g, (_, escape: string) => {
        if (escape.startsWith('u')) return String.fromCharCode(Number.parseInt(escape.slice(1), 16))
        if (escape.startsWith('x')) return String.fromCharCode(Number.parseInt(escape.slice(1), 16))

        return (
          {
            '\\': '\\',
            '"': '"',
            "'": "'",
            b: '\b',
            f: '\f',
            n: '\n',
            r: '\r',
            t: '\t',
            v: '\v',
            0: '\0'
          } as Record<string, string>
        )[escape]
      })
  }
}

const getRawToolOutput = (item: CodexThreadItem): unknown => {
  if (item.customToolOutput !== undefined) return item.customToolOutput
  if (item.aggregatedOutput !== undefined) return item.aggregatedOutput
  if (item.result !== undefined || item.error !== undefined) {
    return { result: item.result ?? null, error: item.error ?? null }
  }
  return item.rawToolData ?? item
}

const getRawToolInput = (item: CodexThreadItem): unknown => {
  if (item.customToolInput !== undefined) return item.customToolInput
  if (item.command !== undefined) return item.command
  if (item.arguments !== undefined) return item.arguments
  if (item.query !== undefined) return item.query
  return null
}

const maxToolCommandLength = 80_000
const maxToolOutputLength = 160_000
const maxToolDiffLength = 400_000
const maxRawToolValueLength = 80_000
const maxRawToolCollectionEntries = 200
const maxRawToolDepth = 8
const truncatedToolValueMarker = '… [truncated to keep the app responsive]'

const truncateToolText = (value: string | null, limit: number): string | null => {
  if (value == null || value.length <= limit) return value
  return `${value.slice(0, limit)}\n${truncatedToolValueMarker}`
}

type RawToolValueBudget = {
  remaining: number
  seen: WeakSet<object>
}

const getBoundedRawToolValue = (
  value: unknown,
  budget: RawToolValueBudget = {
    remaining: maxRawToolValueLength,
    seen: new WeakSet<object>()
  },
  depth = 0
): unknown => {
  if (typeof value === 'string') {
    if (value.length <= budget.remaining) {
      budget.remaining -= value.length
      return value
    }

    const visibleValue = value.slice(0, Math.max(0, budget.remaining))
    budget.remaining = 0
    return `${visibleValue}\n${truncatedToolValueMarker}`
  }
  if (
    value == null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return value
  }
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return String(value)
  }
  if (depth >= maxRawToolDepth || budget.remaining <= 0) return truncatedToolValueMarker
  if (budget.seen.has(value)) return '[Circular]'

  budget.seen.add(value)

  if (Array.isArray(value)) {
    const boundedValue: unknown[] = []
    const entryLimit = Math.min(value.length, maxRawToolCollectionEntries)

    for (let index = 0; index < entryLimit && budget.remaining > 0; index += 1) {
      budget.remaining -= 1
      boundedValue.push(getBoundedRawToolValue(value[index], budget, depth + 1))
    }
    if (entryLimit < value.length || budget.remaining <= 0) {
      boundedValue.push(truncatedToolValueMarker)
    }

    return boundedValue
  }

  const boundedValue: Record<string, unknown> = {}
  const entries = Object.entries(value as Record<string, unknown>)
  const entryLimit = Math.min(entries.length, maxRawToolCollectionEntries)

  for (let index = 0; index < entryLimit && budget.remaining > 0; index += 1) {
    const [key, entryValue] = entries[index]
    budget.remaining -= key.length + 1
    boundedValue[key] = getBoundedRawToolValue(entryValue, budget, depth + 1)
  }
  if (entryLimit < entries.length || budget.remaining <= 0) {
    boundedValue.__truncated__ = truncatedToolValueMarker
  }

  return boundedValue
}

const getToolId = (item: CodexThreadItem): string =>
  item.customToolName ??
  (item.server && item.tool ? `${item.server}/${item.tool}` : null) ??
  (item.namespace && item.tool ? `${item.namespace}/${item.tool}` : null) ??
  item.tool ??
  item.type

const getOutputFromText = (text: string): string | null => {
  const outputMarker = '\nOutput:\n'
  const outputIndex = text.lastIndexOf(outputMarker)
  const output = outputIndex >= 0 ? text.slice(outputIndex + outputMarker.length) : text
  const trimmedOutput = output.trimEnd()
  if (!trimmedOutput) return null
  return trimmedOutput
}

const getOutputFromEnvelope = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null

  if (Array.isArray(value)) {
    const text = value
      .map((part) => {
        if (!part || typeof part !== 'object') return ''
        const candidate = part as { text?: unknown }
        return typeof candidate.text === 'string' ? candidate.text : ''
      })
      .join('')
    return text ? getToolStdout(text) : null
  }

  const envelope = value as {
    output?: unknown
    stdout?: unknown
    result?: unknown
    content?: unknown
  }
  if (typeof envelope.output === 'string') return getToolStdout(envelope.output)
  if (typeof envelope.stdout === 'string') return getToolStdout(envelope.stdout)

  const contentOutput = getOutputFromEnvelope(envelope.content)
  if (contentOutput != null) return contentOutput

  return getOutputFromEnvelope(envelope.result)
}

const getToolStdout = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const output = getOutputFromText(value)
    if (!output) return null

    const trimmed = output.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        return getOutputFromEnvelope(parsed) ?? output
      } catch {
        return output
      }
    }

    return output
  }

  const envelopeOutput = getOutputFromEnvelope(value)
  if (envelopeOutput != null) return envelopeOutput

  return null
}

const getSearchableToolOutput = (value: unknown): string => {
  if (value == null) return ''
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

const getToolSearchText = (item: CodexThreadItem): string =>
  [
    item.command,
    item.aggregatedOutput,
    item.customToolInput,
    getSearchableToolOutput(item.customToolOutput),
    getSearchableToolOutput(item.result),
    getSearchableToolOutput(item.error)
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n')

const getSessionIdFromText = (text: string): string | null => {
  const runningMatch = text.match(/Process running with session ID\s+([A-Za-z0-9_-]+)/i)
  if (runningMatch?.[1]) return runningMatch[1]

  const jsonMatch = text.match(/["']?session_id["']?\s*[:=]\s*["']?([A-Za-z0-9_-]+)["']?/i)
  if (jsonMatch?.[1]) return jsonMatch[1]

  const camelMatch = text.match(/["']?sessionId["']?\s*[:=]\s*["']?([A-Za-z0-9_-]+)["']?/i)
  return camelMatch?.[1] ?? null
}

const getStartedBackgroundSessionId = (item: CodexThreadItem): string | null => {
  const outputText = [
    item.aggregatedOutput,
    getSearchableToolOutput(item.customToolOutput),
    getSearchableToolOutput(item.result)
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n')

  if (
    !/Process running with session ID|running in background|background process|session_id/i.test(
      outputText
    )
  ) {
    return null
  }

  return getSessionIdFromText(outputText)
}

const getFinishedBackgroundSessionId = (item: CodexThreadItem): string | null => {
  const searchText = getToolSearchText(item)
  if (!/Process exited|process has exited|session finished|session completed/i.test(searchText)) {
    return null
  }

  return getSessionIdFromText(searchText)
}

const getFileDiffs = (item: CodexThreadItem): ProviderFileDiff[] =>
  (item.changes ?? []).map((change) => ({
    path: change.path,
    kind: change.kind.type === 'add' ? 'create' : change.kind.type === 'delete' ? 'delete' : 'edit',
    diff: truncateToolText(change.diff, maxToolDiffLength) ?? ''
  }))

const defaultRawToolOutput = Symbol('defaultRawToolOutput')

const renderTool = (
  item: CodexThreadItem,
  activity: ProviderToolActivity,
  label: string,
  command: string | null = null,
  stdout: string | null = null,
  diffs: ProviderFileDiff[] = [],
  toolId = getToolId(item),
  rawOutput: unknown | typeof defaultRawToolOutput = defaultRawToolOutput
): WorkingItemRenderResult => {
  const showRawValues = activity === 'other'

  return {
    type: 'tool',
    toolId,
    status: item.status ?? 'finished',
    activity,
    label,
    command: truncateToolText(command, maxToolCommandLength),
    stdout: truncateToolText(stdout, maxToolOutputLength),
    diffs,
    backgroundSessionId: getStartedBackgroundSessionId(item),
    finishedBackgroundSessionId: getFinishedBackgroundSessionId(item),
    rawInput: showRawValues ? getBoundedRawToolValue(getRawToolInput(item)) : null,
    rawOutput: showRawValues
      ? getBoundedRawToolValue(
          rawOutput === defaultRawToolOutput ? getRawToolOutput(item) : rawOutput
        )
      : null
  }
}

type ToolPresentation = {
  activity: ProviderToolActivity
  label: string
}

const openAiDeveloperDocsToolNames = new Set(['search_openai_docs', 'fetch_openai_doc'])

const isOpenAiDeveloperDocsToolName = (name: string | null | undefined): boolean =>
  Boolean(
    name &&
    (openAiDeveloperDocsToolNames.has(name) ||
      name.startsWith('openaiDeveloperDocs/') ||
      name.startsWith('mcp__openaiDeveloperDocs__'))
  )

const exactToolPresentations = new Map<string, ToolPresentation>([
  ['webSearch', { activity: 'search', label: 'Searched the web' }],
  ['web_search', { activity: 'search', label: 'Searched the web' }],
  ['imageView', { activity: 'other', label: 'Viewed image' }],
  ['view_image', { activity: 'other', label: 'Viewed image' }],
  ['imageGeneration', { activity: 'other', label: 'Generated image' }],
  ['image_gen__imagegen', { activity: 'other', label: 'Generated image' }]
])

const getToolNameCandidates = (item: CodexThreadItem): string[] => {
  const names = [
    item.customToolName,
    item.server && item.tool ? `${item.server}/${item.tool}` : null,
    item.namespace && item.tool ? `${item.namespace}/${item.tool}` : null,
    item.tool,
    item.type
  ]

  return [...new Set(names.filter((name): name is string => Boolean(name)))]
}

const getMappedToolPresentation = (item: CodexThreadItem): ToolPresentation | null => {
  const names = getToolNameCandidates(item)

  if (
    item.server === 'openaiDeveloperDocs' ||
    item.namespace === 'openaiDeveloperDocs' ||
    names.some(isOpenAiDeveloperDocsToolName)
  ) {
    return { activity: 'other', label: 'Checked OpenAI docs' }
  }

  for (const name of names) {
    const presentation = exactToolPresentations.get(name)
    if (presentation) return presentation
  }

  return null
}

const renderMappedTool = (
  item: CodexThreadItem,
  toolId = getToolId(item)
): WorkingItemRenderResult | null => {
  const presentation = getMappedToolPresentation(item)
  if (!presentation) return null

  return renderTool(item, presentation.activity, presentation.label, null, null, [], toolId)
}

const getCustomToolArgument = (item: CodexThreadItem, key: string): string | null =>
  item.customToolName && item.customToolInput
    ? getToolStringArgument(item.customToolInput, item.customToolName, key)
    : null

const renderKnownCustomTool = (item: CodexThreadItem): WorkingItemRenderResult | null => {
  const name = item.customToolName
  if (!name) return null

  if (name === 'tool_search') {
    const query = getCustomToolArgument(item, 'query')
    return renderTool(
      item,
      'search',
      query ? `Searched tools for ${truncate(query, 80)}` : 'Searched tools',
      item.customToolInput ?? null,
      getToolStdout(item.customToolOutput),
      [],
      name
    )
  }

  if (name === 'apply_patch') {
    return renderTool(
      item,
      'edit',
      'Applied patch',
      null,
      getToolStdout(item.customToolOutput),
      [],
      name
    )
  }

  if (name === 'update_plan') {
    return renderTool(
      item,
      'other',
      'Updated plan',
      null,
      null,
      [],
      name,
      getToolStdout(item.customToolOutput) ?? getRawToolOutput(item)
    )
  }

  return renderMappedTool(item, name)
}

const renderNestedToolCommand = (item: CodexThreadItem): WorkingItemRenderResult[] | null => {
  if (!item.command) return null

  const nestedCalls = getNestedToolCalls(item.command, { includeQuoted: true })
  if (isPatchToolCall(item.command, nestedCalls)) {
    if ((item.changes?.length ?? 0) > 0) return renderFileChanges(item)

    return [
      renderTool(
        item,
        'edit',
        'Applied patch',
        null,
        getToolStdout(item.aggregatedOutput),
        [],
        'apply_patch'
      )
    ]
  }

  if (nestedCalls.length === 0) return null

  return nestedCalls.map((call) => {
    const toolItem: CodexThreadItem = {
      ...item,
      type: 'customToolCall',
      customToolName: call.name,
      customToolInput: item.command?.slice(call.offset) ?? null,
      customToolOutput: item.aggregatedOutput,
      rawToolData: item.rawToolData ?? [item]
    }
    return (
      renderKnownCustomTool(toolItem) ??
      renderTool(toolItem, 'other', call.name, null, null, [], call.name)
    )
  })
}

const renderFileChanges = (item: CodexThreadItem): WorkingItemRenderResult[] => {
  const diffs = getFileDiffs(item)
  return diffs.map((diff) => {
    const file = getFileName(diff.path)
    const label =
      diff.kind === 'create'
        ? `Created ${file}`
        : diff.kind === 'delete'
          ? `Deleted ${file}`
          : `Changed ${file}`

    return renderTool(item, diff.kind, label, null, null, [diff])
  })
}

const workingItemRenderMatchers: WorkingItemRenderMatcher[] = [
  {
    matches: (item) => item.type === 'agentMessage',
    render: (item) => {
      const content = item.text?.trim()
      return content ? { type: 'message', content } : null
    }
  },
  {
    matches: (item) => item.type === 'customToolCall',
    render: (item) => {
      if ((item.changes?.length ?? 0) > 0) {
        return renderFileChanges(item)
      }

      const name = item.customToolName
      if (!name) return null

      const knownTool = renderKnownCustomTool(item)
      if (knownTool) return knownTool

      if (name === 'exec_command') {
        const command = getToolStringArgument(item.customToolInput ?? '', name, 'cmd')
        const classifications = command
          ? classifyCommand(command)
          : [
              {
                activity: 'command',
                label: 'Ran a command',
                command: ''
              } satisfies CommandClassification
            ]
        return classifications.map((classification) =>
          renderTool(
            item,
            classification.activity,
            classification.label,
            shouldShowCommandText(classification.activity) ? classification.command || null : null,
            getToolStdout(item.customToolOutput)
          )
        )
      }

      return renderTool(item, 'other', name, null, null, [], name)
    }
  },
  {
    matches: (item) => item.type === 'commandExecution',
    render: (item) => {
      const nestedToolCommand = renderNestedToolCommand(item)
      if (nestedToolCommand) return nestedToolCommand

      return item.command
        ? classifyCommand(item.command).map((classification) =>
            renderTool(
              item,
              classification.activity,
              classification.label,
              shouldShowCommandText(classification.activity)
                ? classification.command || null
                : null,
              getToolStdout(item.aggregatedOutput)
            )
          )
        : null
    }
  },
  {
    matches: (item) => item.type === 'fileChange',
    render: renderFileChanges
  },
  {
    matches: (item) => item.type === 'mcpToolCall',
    render: (item) => {
      if (!item.tool) return null
      const name = item.server ? `${item.server}/${item.tool}` : item.tool
      return renderMappedTool(item, name) ?? renderTool(item, 'other', name, null, null, [], name)
    }
  },
  {
    matches: (item) => item.type === 'dynamicToolCall',
    render: (item) => {
      if (!item.tool) return null
      const name = item.namespace ? `${item.namespace}/${item.tool}` : item.tool
      return renderMappedTool(item, name) ?? renderTool(item, 'other', name, null, null, [], name)
    }
  },
  {
    matches: (item) => item.type === 'collabAgentToolCall',
    render: (item) =>
      item.tool
        ? (renderMappedTool(item, item.tool) ??
          renderTool(item, 'other', item.tool, null, null, [], item.tool))
        : null
  },
  {
    matches: (item) => getMappedToolPresentation(item) !== null,
    render: (item) => renderMappedTool(item)
  }
]

const renderWorkingItems = (item: CodexThreadItem, turnId: string): ProviderWorkingItem[] => {
  const matcher = workingItemRenderMatchers.find((candidate) => candidate.matches(item))
  const result = matcher?.render(item)
  if (!result) return []

  const results = Array.isArray(result) ? result : [result]
  return results.map((workingItem, index) => ({
    ...workingItem,
    id: `${turnId}:${item.id}${results.length > 1 ? `:${index}` : ''}`
  }))
}

const getUserInputText = (input: CodexUserInput): string => {
  if (input.type === 'text') return input.text
  if (input.type === 'skill') return `$${input.name}`
  if (input.type === 'mention') return `@${input.name}`
  return '[Image]'
}

const shouldShowCommandText = (activity: ProviderToolActivity): boolean => activity !== 'script'

const hasRenderableWorkingItems = (item: CodexThreadItem): boolean =>
  renderWorkingItems(item, 'working-probe').length > 0

const getLiveFinalMessageIndex = (items: CodexThreadItem[]): number => {
  const candidateIndex = items.findLastIndex(
    (item) =>
      item.type === 'agentMessage' && item.phase !== 'commentary' && Boolean(item.text?.trim())
  )
  if (candidateIndex < 0) return -1

  const hasLaterWorkingItems = items.slice(candidateIndex + 1).some(hasRenderableWorkingItems)
  return hasLaterWorkingItems ? -1 : candidateIndex
}

const getFinalMessageIndex = (items: CodexThreadItem[], turnStatus: string | null): number => {
  const explicitFinalIndex = items.findLastIndex(
    (item) => item.type === 'agentMessage' && item.phase === 'final_answer'
  )
  if (explicitFinalIndex >= 0) return explicitFinalIndex

  if (turnStatus === 'inProgress') return getLiveFinalMessageIndex(items)

  const lastAgentMessageIndex = items.findLastIndex((item) => item.type === 'agentMessage')
  if (lastAgentMessageIndex < 0) return -1

  return items[lastAgentMessageIndex].phase === 'commentary' ? -1 : lastAgentMessageIndex
}

const getWorkingStatus = (turn: CodexTurn): ProviderWorkingStep['status'] => {
  if (turn.status === 'queued') return 'queued'

  if (
    turn.status === 'interrupted' ||
    turn.status === 'failed' ||
    turn.items.some((item) => item.type === 'turnAborted')
  ) {
    return 'stopped'
  }

  if (turn.status === 'completed') return 'worked'

  return 'working'
}

const getWorkingStepStatus = (
  workingStatus: ProviderWorkingStep['status'],
  finalMessage: ProviderMessage | null
): ProviderWorkingStep['status'] => {
  if (!finalMessage || workingStatus === 'stopped' || workingStatus === 'queued') {
    return workingStatus
  }
  return 'worked'
}

const toMilliseconds = (seconds: number | null | undefined): number | null =>
  typeof seconds === 'number' && Number.isFinite(seconds) ? seconds * 1_000 : null

const hasUserMessageContent = (item: CodexThreadItem): boolean =>
  item.type === 'userMessage' &&
  Boolean(item.content?.map(getUserInputText).filter(Boolean).join('\n').trim())

const isContextCompactionItem = (item: CodexThreadItem): boolean =>
  item.type === 'contextCompaction' ||
  item.type === 'context_compaction' ||
  item.type === 'context_compacted'

const isFinishedContextCompactionItem = (item: CodexThreadItem): boolean =>
  isContextCompactionItem(item) && item.status !== 'running'

const isFinishedTurn = (turn: CodexTurn): boolean =>
  turn.status == null
    ? typeof turn.completedAt === 'number'
    : turn.status !== 'inProgress' && turn.status !== 'queued'

const createAssistantMessage = (
  turn: CodexTurn,
  item: CodexThreadItem,
  completedAt: number | null | undefined
): ProviderMessage => ({
  type: 'message',
  id: `${turn.id}:${item.id}`,
  role: 'assistant',
  content: item.text?.trim() ?? '',
  createdAt: toMilliseconds(completedAt),
  model: turn.model ?? null
})

const renderChatItems = (
  turns: CodexTurn[],
  fallbackStartedAt: number | null = null,
  options: GetChatItemsOptions = {}
): ProviderChatItem[] => {
  const chatItems: ProviderChatItem[] = []

  for (const turn of turns) {
    const startedAt = turn.startedAt ?? fallbackStartedAt
    const completedAt = turn.completedAt ?? startedAt
    const workingStatus = getWorkingStatus(turn)
    const finalMessageIndex = getFinalMessageIndex(turn.items, turn.status ?? null)
    let finalMessage: ProviderMessage | null = null
    const workingItems: ProviderWorkingItem[] = []
    let hasSeenInitialUserMessage = false
    const renderedContextCompactionItemIds = new Set<string>()
    let workingStepCount = 0
    const pushWorkingStep = (status: ProviderWorkingStep['status']): void => {
      if (
        workingItems.length === 0 &&
        status !== 'stopped' &&
        status !== 'working' &&
        status !== 'queued'
      ) {
        return
      }

      chatItems.push({
        type: 'working',
        id: `${turn.id}:working${workingStepCount === 0 ? '' : `:${workingStepCount}`}`,
        status,
        items: [...workingItems]
      })
      workingItems.length = 0
      workingStepCount += 1
    }
    const flushBufferedFinalMessage = (): boolean => {
      if (!finalMessage) return false

      const workingStepStatus = getWorkingStepStatus(workingStatus, finalMessage)
      pushWorkingStep(workingStepStatus)
      chatItems.push(finalMessage)
      finalMessage = null
      return true
    }

    for (const [itemIndex, item] of turn.items.entries()) {
      if (isContextCompactionItem(item)) {
        const itemId = `${turn.id}:${item.id}`
        if (
          isFinishedTurn(turn) &&
          isFinishedContextCompactionItem(item) &&
          !renderedContextCompactionItemIds.has(itemId)
        ) {
          renderedContextCompactionItemIds.add(itemId)
          if (!flushBufferedFinalMessage()) pushWorkingStep('worked')
          chatItems.push({
            type: 'contextCompaction',
            id: itemId
          })
        }
        continue
      }

      if (item.type === 'userMessage' && item.content) {
        const content = item.content.map(getUserInputText).filter(Boolean).join('\n').trim()
        if (content) {
          const itemId = `${turn.id}:${item.id}`

          if (hasSeenInitialUserMessage) {
            pushWorkingStep('worked')

            if (options.pendingSteeringMessageIds?.has(itemId)) {
              if (!options.hiddenPendingMessageIds?.has(itemId)) {
                chatItems.push({
                  type: 'pendingMessage',
                  id: itemId,
                  kind: 'steering',
                  content,
                  createdAt: toMilliseconds(startedAt)
                })
              }
            } else {
              chatItems.push({
                type: 'message',
                id: itemId,
                role: 'user',
                content,
                label: 'Steering with',
                createdAt: toMilliseconds(startedAt),
                model: turn.model ?? null
              })
            }
          } else {
            chatItems.push({
              type: 'message',
              id: itemId,
              role: 'user',
              content,
              createdAt: toMilliseconds(startedAt),
              model: turn.model ?? null
            })
            hasSeenInitialUserMessage = true
          }
        }
        continue
      }

      if (itemIndex === finalMessageIndex && item.text?.trim()) {
        if (turn.items.slice(itemIndex + 1).some(hasUserMessageContent)) {
          workingItems.push(...renderWorkingItems(item, turn.id))
        } else {
          finalMessage = createAssistantMessage(turn, item, completedAt)
        }
        continue
      }

      workingItems.push(...renderWorkingItems(item, turn.id))
    }

    if (!flushBufferedFinalMessage()) pushWorkingStep(workingStatus)
  }

  return chatItems
}

const finishedTurnChatItemsCache = new WeakMap<
  CodexTurn,
  { fallbackStartedAt: number | null; items: ProviderChatItem[] }
>()

export const getChatItems = (
  turns: CodexTurn[],
  fallbackStartedAt: number | null = null,
  options: GetChatItemsOptions = {}
): ProviderChatItem[] => {
  const chatItems: ProviderChatItem[] = []
  const hasPendingItemOverrides =
    Boolean(options.hiddenPendingMessageIds?.size) ||
    Boolean(options.pendingSteeringMessageIds?.size)

  for (const turn of turns) {
    if (!isFinishedTurn(turn) || hasPendingItemOverrides) {
      chatItems.push(...renderChatItems([turn], fallbackStartedAt, options))
      continue
    }

    const cachedTurn = finishedTurnChatItemsCache.get(turn)
    if (cachedTurn && cachedTurn.fallbackStartedAt === fallbackStartedAt) {
      chatItems.push(...cachedTurn.items)
      continue
    }

    const items = renderChatItems([turn], fallbackStartedAt, options)
    finishedTurnChatItemsCache.set(turn, { fallbackStartedAt, items })
    chatItems.push(...items)
  }

  return chatItems
}
