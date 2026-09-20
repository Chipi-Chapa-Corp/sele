import type { ProviderChatTurnWindow } from '../ProviderAdapter'
import type { CodexGoalPrompt } from './CodexGoalPrompts.ts'
import { getUnchangedTranscriptPrefix } from '../transcriptProjection/recordChanges.ts'
import { getBrowserToolLabel } from './CodexBrowserToolPresentation.ts'
import type {
  ProviderChatItem,
  ProviderFileDiff,
  ProviderMessage,
  ProviderMessageAttachment,
  ProviderToolActivity,
  ProviderToolIcon,
  ProviderToolImage,
  ProviderWorkingItem,
  ProviderWorkingStep,
  ProviderWorkingToolStatus
} from '../../../shared/provider'
import { groupWorkingItemsForRenderer, rendererWorkingToolGroupLimit } from '../workingStepLazy.ts'
import {
  appendProviderConversationSegment,
  getProviderLifecycleForWorkingStatus,
  type ProviderConversationEntry
} from '../ProviderConversationEngine.ts'
import { getNestedToolCalls, isPatchToolCall } from './CodexToolCalls.ts'

export type CodexUserInput =
  | { type: 'text'; text: string; text_elements?: unknown[] }
  | { type: 'image'; url?: string }
  | { type: 'localImage'; path?: string }
  | { type: 'skill' | 'mention'; name: string; path?: string }

export type CodexThreadItem = {
  type: string
  id: string
  local?: boolean
  clientId?: string | null
  content?: CodexUserInput[]
  text?: string
  phase?: 'commentary' | 'final_answer' | null
  command?: string
  cwd?: string
  processId?: string | null
  server?: string
  tool?: string
  namespace?: string | null
  query?: string
  path?: string
  arguments?: unknown
  changes?: {
    path: string
    kind: { type: 'add' | 'delete' } | { type: 'update'; move_path: string | null }
    diff: string
  }[]
  aggregatedOutput?: string | null
  result?: unknown
  savedPath?: string
  error?: unknown
  customToolName?: string
  customToolInput?: string | null
  customToolOutput?: unknown
  senderThreadId?: string
  receiverThreadIds?: string[]
  agentThreadId?: string
  kind?: string
  agentPath?: string
  prompt?: string | null
  model?: string | null
  agentsStates?: Record<string, { status?: string; message?: string | null }>
  rawToolData?: unknown[]
  summary?: string[]
  status?: ProviderWorkingToolStatus | 'inProgress' | 'completed' | 'failed' | 'interrupted'
}

export type CodexTurn = {
  goalPrompt?: CodexGoalPrompt
  id: string
  local?: boolean
  status?: string | null
  error?: {
    message?: string | null
    additionalDetails?: string | null
    codexErrorInfo?: unknown
  } | null
  model?: string | null
  startedAt?: number | null
  completedAt?: number | null
  items: CodexThreadItem[]
}

export const getCodexSubagentTimelineAnchorId = (turnId: string, agentThreadId: string): string =>
  `${turnId}:subagent-completed:${agentThreadId}`

type GetChatItemsOptions = {
  turnWindow?: ProviderChatTurnWindow
  workingItemTailLimit?: number
  workingItemTailTurnId?: string
}

type WorkingItemRenderResult =
  | { type: 'message'; content: string }
  | {
      type: 'tool'
      activity: ProviderToolActivity
      toolId: string
      status: ProviderWorkingToolStatus
      compact?: boolean
      label: string
      command: string | null
      cwd: string | null
      stdout: string | null
      diffs: ProviderFileDiff[]
      icon: ProviderToolIcon | null
      backgroundSessionId: string | null
      finishedBackgroundSessionId: string | null
      rawInput: unknown
      rawOutput: unknown
      images: ProviderToolImage[]
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

const codexFileAttachmentOpenTag = '<file_attachment>'
const codexFileAttachmentCloseTag = '</file_attachment>'
const codexFileAttachmentPattern = /<file_attachment>(.+?)<\/file_attachment>/g

const parseCodexFileAttachmentPayload = (
  value: string
): Extract<ProviderMessageAttachment, { kind: 'file' }> | null => {
  try {
    const payload = JSON.parse(value) as { name?: unknown; path?: unknown }
    if (typeof payload.name !== 'string' || typeof payload.path !== 'string') return null
    if (!payload.name || !payload.path) return null

    return {
      kind: 'file',
      name: payload.name,
      path: payload.path
    }
  } catch (error) {
    console.warn('Unable to parse a Codex file attachment marker', error)
    return null
  }
}

const getCodexFileAttachmentsFromText = (
  text: string
): Extract<ProviderMessageAttachment, { kind: 'file' }>[] =>
  Array.from(text.matchAll(codexFileAttachmentPattern), (match) =>
    parseCodexFileAttachmentPayload(match[1] ?? '')
  ).filter(
    (attachment): attachment is Extract<ProviderMessageAttachment, { kind: 'file' }> =>
      attachment !== null
  )

const stripCodexFileAttachmentsFromText = (text: string): string =>
  text
    .replace(codexFileAttachmentPattern, (marker, payload: string) =>
      parseCodexFileAttachmentPayload(payload) ? '' : marker
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim()

export const createCodexFileAttachmentInput = (path: string): CodexUserInput => ({
  type: 'text',
  text: `${codexFileAttachmentOpenTag}${JSON.stringify({
    name: getFileName(path),
    path
  })}${codexFileAttachmentCloseTag}`,
  text_elements: []
})

export const hasCodexUserInputAttachments = (inputs: CodexUserInput[] | undefined): boolean =>
  Boolean(
    inputs?.some(
      (input) =>
        input.type === 'image' ||
        input.type === 'localImage' ||
        (input.type === 'text' && getCodexFileAttachmentsFromText(input.text).length > 0)
    )
  )

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
const neutralCommands = new Set(['cd', 'pwd', 'which', 'command -v', 'true', 'false'])

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
  if (neutralCommands.has(command)) {
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
  } catch (error) {
    console.warn('Unable to parse Codex tool arguments', error)
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
    } catch (error) {
      console.warn('Unable to parse an embedded Codex tool argument object', error)
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
  } catch (error) {
    console.warn('Unable to decode a quoted Codex command token', error)
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

const maxToolOutputEnvelopeDepth = 16

const getOutputFromEnvelope = (
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0
): string | null => {
  if (
    depth >= maxToolOutputEnvelopeDepth ||
    !value ||
    typeof value !== 'object' ||
    seen.has(value)
  ) {
    return null
  }
  seen.add(value)

  if (Array.isArray(value)) {
    const text = value
      .map((part) => {
        if (!part || typeof part !== 'object') return ''
        const candidate = part as { text?: unknown }
        return typeof candidate.text === 'string' ? candidate.text : ''
      })
      .join('')
    return text ? getToolStdout(text, seen, depth + 1) : null
  }

  const envelope = value as {
    output?: unknown
    stdout?: unknown
    result?: unknown
    content?: unknown
  }
  if (typeof envelope.output === 'string') return getToolStdout(envelope.output, seen, depth + 1)
  if (typeof envelope.stdout === 'string') return getToolStdout(envelope.stdout, seen, depth + 1)

  const contentOutput = getOutputFromEnvelope(envelope.content, seen, depth + 1)
  if (contentOutput != null) return contentOutput

  return getOutputFromEnvelope(envelope.result, seen, depth + 1)
}

// Tool stdout is arbitrary text; a leading brace does not guarantee a JSON envelope.
const isExpectedToolOutputParseError = (error: unknown): boolean => error instanceof SyntaxError

const getToolStdout = (value: unknown, seen = new WeakSet<object>(), depth = 0): string | null => {
  if (typeof value === 'string') {
    const output = getOutputFromText(value)
    if (!output) return null
    if (depth >= maxToolOutputEnvelopeDepth) return output

    const trimmed = output.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        return getOutputFromEnvelope(parsed, seen, depth + 1) ?? output
      } catch (error) {
        if (isExpectedToolOutputParseError(error)) return output
        console.warn('Unable to parse a nested Codex tool output envelope', error)
        return output
      }
    }

    return output
  }

  const envelopeOutput = getOutputFromEnvelope(value, seen, depth + 1)
  if (envelopeOutput != null) return envelopeOutput

  return null
}

const getSearchableToolOutput = (value: unknown): string => {
  if (value == null) return ''
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value)
  } catch (error) {
    console.warn('Unable to serialize Codex tool output', error)
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

const getToolCwd = (item: CodexThreadItem): string | null => {
  if (item.cwd?.trim()) return item.cwd
  if (!item.customToolName || !item.customToolInput) return null

  return (
    getToolStringArgument(item.customToolInput, item.customToolName, 'workdir') ??
    getToolStringArgument(item.customToolInput, item.customToolName, 'cwd')
  )
}

const getFileDiffs = (item: CodexThreadItem): ProviderFileDiff[] =>
  (item.changes ?? []).map((change) => ({
    path: change.path,
    kind: change.kind.type === 'add' ? 'create' : change.kind.type === 'delete' ? 'delete' : 'edit',
    diff: truncateToolText(change.diff, maxToolDiffLength) ?? ''
  }))

const defaultRawToolOutput = Symbol('defaultRawToolOutput')

const getWorkingToolStatus = (status: CodexThreadItem['status']): ProviderWorkingToolStatus =>
  status === 'running' || status === 'inProgress' ? 'running' : 'finished'

const renderTool = (
  item: CodexThreadItem,
  activity: ProviderToolActivity,
  label: string,
  command: string | null = null,
  stdout: string | null = null,
  diffs: ProviderFileDiff[] = [],
  toolId = getToolId(item),
  rawOutput: unknown | typeof defaultRawToolOutput = defaultRawToolOutput,
  images: ProviderToolImage[] = [],
  icon: ProviderToolIcon | null = null,
  compact = false
): WorkingItemRenderResult => {
  const showRawValues = activity === 'other' && !compact

  return {
    type: 'tool',
    toolId,
    status: getWorkingToolStatus(item.status),
    ...(compact ? { compact: true } : {}),
    activity,
    icon,
    label,
    command: truncateToolText(command, maxToolCommandLength),
    cwd: getToolCwd(item),
    stdout: truncateToolText(stdout, maxToolOutputLength),
    diffs,
    backgroundSessionId: getStartedBackgroundSessionId(item),
    finishedBackgroundSessionId: getFinishedBackgroundSessionId(item),
    rawInput: showRawValues ? getBoundedRawToolValue(getRawToolInput(item)) : null,
    rawOutput: showRawValues
      ? getBoundedRawToolValue(
          rawOutput === defaultRawToolOutput ? getRawToolOutput(item) : rawOutput
        )
      : null,
    images
  }
}

type ToolPresentation = {
  activity: ProviderToolActivity
  icon?: ProviderToolIcon
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
  ['imageView', { activity: 'other', icon: 'image-view', label: 'Viewed image' }],
  ['view_image', { activity: 'other', icon: 'image-view', label: 'Viewed image' }],
  ['imageGeneration', { activity: 'other', icon: 'image-generation', label: 'Generated image' }],
  [
    'image_gen__imagegen',
    { activity: 'other', icon: 'image-generation', label: 'Generated image' }
  ],
  ['image_gen/imagegen', { activity: 'other', icon: 'image-generation', label: 'Generated image' }],
  ['imagegen', { activity: 'other', icon: 'image-generation', label: 'Generated image' }]
])

const generatedImageToolNames = new Set([
  'imageGeneration',
  'image_gen__imagegen',
  'image_gen/imagegen',
  'imagegen'
])
const viewedImageToolNames = new Set(['imageView', 'view_image'])
const generatedImageExtensions = /\.(?:avif|gif|jpe?g|png|webp)$/i
const generatedImagePathPattern = /(?:[A-Za-z]:[\\/]|\/)[^\s"'`<>]+?\.(?:avif|gif|jpe?g|png|webp)/gi
const generatedImagePathKeys = new Set(['path', 'saved_path', 'savedPath'])
const generatedImageTextKeys = new Set(['output_hint', 'text'])
const generatedImageSkippedKeys = new Set(['image_url', 'result'])

const isAbsoluteGeneratedImagePath = (value: string): boolean =>
  /^(?:[A-Za-z]:[\\/]|\/)/.test(value) && generatedImageExtensions.test(value)

const getGeneratedImagePaths = (item: CodexThreadItem): ProviderToolImage[] => {
  const imagePaths = new Set<string>()
  const seen = new WeakSet<object>()

  const addPath = (value: string): void => {
    const path = value.trim().replace(/[),.;]+$/, '')
    if (isAbsoluteGeneratedImagePath(path)) imagePaths.add(path)
  }

  const addPathsFromText = (value: string): void => {
    for (const match of value.matchAll(generatedImagePathPattern)) addPath(match[0])
  }

  const visit = (value: unknown, depth = 0): void => {
    if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) return
    seen.add(value)

    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, depth + 1))
      return
    }

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (generatedImagePathKeys.has(key) && typeof entry === 'string') {
        addPath(entry)
        continue
      }
      if (generatedImageTextKeys.has(key) && typeof entry === 'string') {
        addPathsFromText(entry)
        continue
      }
      if (!generatedImageSkippedKeys.has(key)) visit(entry, depth + 1)
    }
  }

  if (item.savedPath) addPath(item.savedPath)
  visit(item.customToolOutput)
  visit(item.rawToolData)

  return [...imagePaths].map((path) => ({ path }))
}

const getViewedImages = (item: CodexThreadItem): ProviderToolImage[] => {
  const argumentPath =
    item.arguments && typeof item.arguments === 'object' && !Array.isArray(item.arguments)
      ? (item.arguments as Record<string, unknown>).path
      : null
  const pathCandidates = [
    item.path,
    typeof argumentPath === 'string' ? argumentPath : null,
    item.customToolName && item.customToolInput
      ? getToolStringArgument(item.customToolInput, item.customToolName, 'path')
      : null
  ]
  const path = pathCandidates
    .find(
      (candidate): candidate is string =>
        typeof candidate === 'string' && isAbsoluteGeneratedImagePath(candidate.trim())
    )
    ?.trim()
  const dataUrls = new Set<string>()
  const seen = new WeakSet<object>()

  const visit = (value: unknown, depth = 0): void => {
    if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) return
    seen.add(value)

    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, depth + 1))
      return
    }

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (
        (key === 'image_url' || key === 'imageUrl') &&
        typeof entry === 'string' &&
        entry.startsWith('data:image/')
      ) {
        dataUrls.add(entry)
        continue
      }
      visit(entry, depth + 1)
    }
  }

  visit(item)

  const name = path ? getFileName(path) : 'Viewed image'
  if (dataUrls.size > 0) {
    return [...dataUrls].map((dataUrl) => ({ dataUrl, name, path }))
  }

  return path ? [{ path, name }] : []
}

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
  const browserLabel = getBrowserToolLabel(
    names,
    (item.customToolName && item.customToolInput
      ? getJsonToolArgument(item.customToolInput, item.customToolName)
      : null) ?? getRawToolInput(item)
  )
  if (browserLabel) return { activity: 'other', icon: 'browser', label: browserLabel }

  if (
    item.server === 'openaiDeveloperDocs' ||
    item.namespace === 'openaiDeveloperDocs' ||
    names.some(isOpenAiDeveloperDocsToolName)
  ) {
    return { activity: 'other', icon: 'openai-docs', label: 'Checked OpenAI docs' }
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

  const isGeneratedImage = getToolNameCandidates(item).some((name) =>
    generatedImageToolNames.has(name)
  )
  const isViewedImage = getToolNameCandidates(item).some((name) => viewedImageToolNames.has(name))
  const images = isGeneratedImage
    ? getGeneratedImagePaths(item)
    : isViewedImage
      ? getViewedImages(item)
      : []

  return renderTool(
    item,
    presentation.activity,
    presentation.label,
    null,
    null,
    [],
    toolId,
    images.length > 0 ? null : defaultRawToolOutput,
    images,
    presentation.icon ?? null,
    presentation.icon === 'browser'
  )
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
      getToolStdout(item.customToolOutput) ?? getRawToolOutput(item),
      [],
      'plan'
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
      item.tool === 'wait'
        ? renderTool(
            item,
            'other',
            'Waited for subagent',
            null,
            null,
            [],
            'wait',
            null,
            [],
            'subagent',
            true
          )
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
  if (input.type === 'text') return stripCodexFileAttachmentsFromText(input.text)
  if (input.type === 'skill') return `$${input.name}`
  if (input.type === 'mention') return `@${input.name}`
  return ''
}

const getUserInputContent = (inputs: CodexUserInput[]): string => {
  const text = inputs
    .filter((input): input is Extract<CodexUserInput, { type: 'text' }> => input.type === 'text')
    .map(getUserInputText)
    .filter(Boolean)
    .join('\n')
  const references = inputs
    .filter(
      (input): input is Extract<CodexUserInput, { type: 'skill' | 'mention' }> =>
        input.type === 'skill' || input.type === 'mention'
    )
    .map(getUserInputText)
    .filter((reference) => !text.includes(reference))

  return [text, ...references].filter(Boolean).join('\n').trim()
}

const getUserInputAttachments = (input: CodexUserInput): ProviderMessageAttachment[] => {
  if (input.type === 'text') return getCodexFileAttachmentsFromText(input.text)

  if (input.type === 'localImage') {
    return [
      {
        kind: 'image',
        name: input.path ? getFileName(input.path) : 'Image',
        path: input.path ?? null
      }
    ]
  }

  if (input.type === 'image') {
    return [
      {
        kind: 'image',
        name: 'Image',
        dataUrl: input.url?.startsWith('data:') ? input.url : null
      }
    ]
  }

  return []
}

const collectUserInputAttachments = (inputs: CodexUserInput[]): ProviderMessageAttachment[] =>
  inputs.flatMap(getUserInputAttachments)

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
  if (explicitFinalIndex >= 0) {
    return items.slice(explicitFinalIndex + 1).some(hasRenderableWorkingItems)
      ? -1
      : explicitFinalIndex
  }

  if (turnStatus === 'inProgress') return getLiveFinalMessageIndex(items)

  const lastAgentMessageIndex = items.findLastIndex((item) => item.type === 'agentMessage')
  if (lastAgentMessageIndex < 0) return -1

  return items[lastAgentMessageIndex].phase === 'commentary' ? -1 : lastAgentMessageIndex
}

const getWorkingStatus = (
  turn: CodexTurn,
  aborted = turn.items.some((item) => item.type === 'turnAborted')
): ProviderWorkingStep['status'] => {
  if (turn.status === 'queued') return 'queued'
  if (turn.status === 'failed') return 'failed'

  if (turn.status === 'interrupted' || aborted) {
    return 'stopped'
  }

  if (
    turn.status === 'completed' ||
    (turn.status == null && typeof turn.completedAt === 'number')
  ) {
    return 'worked'
  }

  return 'working'
}

const getTurnErrorText = (turn: CodexTurn): string | null => {
  const details = [turn.error?.message, turn.error?.additionalDetails]
    .flatMap((detail) => (typeof detail === 'string' && detail.trim() ? [detail.trim()] : []))
    .filter((detail, index, values) => values.indexOf(detail) === index)

  return details.length > 0 ? details.join('\n') : null
}

const isRateLimitFailure = (turn: CodexTurn): boolean =>
  turn.error?.codexErrorInfo === 'usageLimitExceeded' ||
  turn.error?.codexErrorInfo === 'rateLimitExceeded'

const toMilliseconds = (seconds: number | null | undefined): number | null =>
  typeof seconds === 'number' && Number.isFinite(seconds) ? seconds * 1_000 : null

const hasUserMessageContent = (item: CodexThreadItem): boolean =>
  item.type === 'userMessage' &&
  Boolean(
    item.content &&
      (getUserInputContent(item.content) || collectUserInputAttachments(item.content).length > 0)
  )

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

type CodexProjectionScan = {
  explicitFinal: number
  lastAgent: number
  liveCandidate: number
  lastWorking: number
  aborted: boolean
}
type CodexProjectionCheckpoint = {
  index: number
  chatItems: ProviderChatItem[]
  finalMessage: ProviderMessage | null
  workingItems: ProviderWorkingItem[]
  pendingTimelineAnchors: ProviderChatItem[]
  renderedSubagentCompletionAnchorIds: Set<string>
  workingItemCount: number
  hasSeenInitialUserMessage: boolean
  renderedContextCompactionItemIds: Set<string>
  workingStepCount: number
  scan: CodexProjectionScan
}
type CodexProjectionCache = {
  turn: CodexTurn
  fallbackStartedAt: number | null
  tailLimit: number | undefined
  finalMessageIndex: number
  checkpoint: CodexProjectionCheckpoint
}

/** Bounded hot-turn checkpoints. The adapter owns one instance; eviction only loses speed. */
export class CodexTranscriptProjection {
  private turns = new Map<string, CodexProjectionCache>()
  processedRecordCount = 0

  get(turnId: string): CodexProjectionCache | undefined {
    return this.turns.get(turnId)
  }
  set(turnId: string, cache: CodexProjectionCache): void {
    this.turns.delete(turnId)
    this.turns.set(turnId, cache)
    while (this.turns.size > 16) this.turns.delete(this.turns.keys().next().value!)
  }
  clear(): void {
    this.turns.clear()
  }
}

const emptyProjectionScan = (): CodexProjectionScan => ({
  explicitFinal: -1,
  lastAgent: -1,
  liveCandidate: -1,
  lastWorking: -1,
  aborted: false
})
const scanProjectionItem = (
  scan: CodexProjectionScan,
  item: CodexThreadItem,
  index: number
): void => {
  if (item.type === 'agentMessage') {
    scan.lastAgent = index
    if (item.phase === 'final_answer') scan.explicitFinal = index
    if (item.phase !== 'commentary' && item.text?.trim()) scan.liveCandidate = index
  }
  if (hasRenderableWorkingItems(item)) scan.lastWorking = index
  if (item.type === 'turnAborted') scan.aborted = true
}

const renderChatItems = (
  turns: CodexTurn[],
  fallbackStartedAt: number | null = null,
  options: GetChatItemsOptions = {},
  projection?: CodexTranscriptProjection
): ProviderChatItem[] => {
  let chatItems: ProviderChatItem[] = []

  for (const turn of turns) {
    const startedAt = turn.startedAt ?? fallbackStartedAt
    const completedAt = turn.completedAt ?? startedAt
    const cached = projection?.get(turn.id)
    const prefix = cached ? getUnchangedTranscriptPrefix(cached.turn.items, turn.items) : 0
    const tailLimit =
      options.workingItemTailTurnId === turn.id ? options.workingItemTailLimit : undefined
    const reusable =
      cached &&
      cached.fallbackStartedAt === fallbackStartedAt &&
      cached.tailLimit === tailLimit &&
      cached.turn.startedAt === turn.startedAt &&
      cached.turn.completedAt === turn.completedAt &&
      cached.turn.model === turn.model &&
      cached.turn.status === turn.status &&
      cached.turn.error === turn.error &&
      cached.turn.local === turn.local &&
      cached.turn.goalPrompt === turn.goalPrompt &&
      prefix >= cached.checkpoint.index
        ? cached.checkpoint
        : null
    const scan = reusable ? { ...reusable.scan } : emptyProjectionScan()
    let checkpointScan = { ...scan }
    for (let index = reusable?.index ?? 0; projection && index < turn.items.length; index += 1) {
      if (index === turn.items.length - 1) checkpointScan = { ...scan }
      scanProjectionItem(scan, turn.items[index], index)
      if (projection) projection.processedRecordCount += 1
    }
    const finalMessageIndex = projection
      ? scan.explicitFinal >= 0
        ? scan.lastWorking > scan.explicitFinal
          ? -1
          : scan.explicitFinal
        : turn.status === 'inProgress'
          ? scan.lastWorking > scan.liveCandidate
            ? -1
            : scan.liveCandidate
          : scan.lastAgent >= 0 && turn.items[scan.lastAgent].phase !== 'commentary'
            ? scan.lastAgent
            : -1
      : getFinalMessageIndex(turn.items, turn.status ?? null)
    // A suffix can change how an older final answer is classified. Rebuild rather than reuse a
    // checkpoint that has already consumed that answer (including steering after final_answer).
    const resume =
      reusable &&
      cached &&
      (cached.finalMessageIndex === finalMessageIndex ||
        Math.min(...[cached.finalMessageIndex, finalMessageIndex].filter((index) => index >= 0)) >=
          reusable.index) &&
      !(
        reusable.scan.explicitFinal >= 0 &&
        (turn.items.slice(prefix).some(hasUserMessageContent) ||
          cached.turn.items.slice(prefix).some(hasUserMessageContent))
      )
        ? reusable
        : null
    const workingStatus = getWorkingStatus(turn, projection ? scan.aborted : undefined)
    if (resume) chatItems = resume.chatItems.slice()
    else if (turn.goalPrompt) {
      chatItems.push({
        type: 'goalContinuation',
        id: `${turn.id}:${turn.goalPrompt.id}`
      })
    }
    let finalMessage: ProviderMessage | null = resume?.finalMessage ?? null
    const workingItems: ProviderWorkingItem[] = resume?.workingItems.slice() ?? []
    const pendingTimelineAnchors: ProviderChatItem[] = resume?.pendingTimelineAnchors.slice() ?? []
    const renderedSubagentCompletionAnchorIds = new Set(resume?.renderedSubagentCompletionAnchorIds)
    let workingItemCount = resume?.workingItemCount ?? 0
    const workingItemTailLimit = Math.max(1, tailLimit ?? Number.MAX_SAFE_INTEGER)
    let hasSeenInitialUserMessage = resume?.hasSeenInitialUserMessage ?? false
    const renderedContextCompactionItemIds = new Set(resume?.renderedContextCompactionItemIds)
    let workingStepCount = resume?.workingStepCount ?? 0
    let checkpoint: CodexProjectionCheckpoint | null = null
    const pushWorkingStep = (
      status: ProviderWorkingStep['status'],
      segmentFinalMessage: ProviderMessage | null = null
    ): void => {
      const omitBeforeInitialUser =
        !hasSeenInitialUserMessage &&
        workingItemCount === 0 &&
        pendingTimelineAnchors.length === 0 &&
        (status === 'stopped' || status === 'working' || status === 'queued')
      const omitEmptyCompletedStep =
        workingItemCount === 0 &&
        pendingTimelineAnchors.length === 0 &&
        status !== 'stopped' &&
        status !== 'failed' &&
        status !== 'working' &&
        status !== 'queued'
      const showWorking = !omitBeforeInitialUser && !omitEmptyCompletedStep
      const entries: ProviderConversationEntry[] = [
        ...workingItems.map((item) => ({ kind: 'working' as const, item })),
        ...(segmentFinalMessage
          ? [{ kind: 'assistant' as const, message: segmentFinalMessage }]
          : [])
      ]
      appendProviderConversationSegment(chatItems, {
        id: `${turn.id}:working${workingStepCount === 0 ? '' : `:${workingStepCount}`}`,
        entries,
        finalMessageIndex: segmentFinalMessage ? entries.length - 1 : -1,
        lifecycle: getProviderLifecycleForWorkingStatus(status),
        failureReason: status === 'failed' && isRateLimitFailure(turn) ? 'rateLimit' : undefined,
        showWorking,
        betweenWorkingAndFinal: pendingTimelineAnchors,
        ...(workingItemTailLimit < Number.MAX_SAFE_INTEGER
          ? {
              workingItemWindow: {
                itemCount: workingItemCount,
                itemsStartIndex: Math.max(0, workingItemCount - workingItems.length)
              }
            }
          : {})
      })
      workingItems.length = 0
      workingItemCount = 0
      if (showWorking) workingStepCount += 1
      pendingTimelineAnchors.length = 0
    }
    const appendWorkingItems = (items: ProviderWorkingItem[]): void => {
      if (workingItemTailLimit === Number.MAX_SAFE_INTEGER) {
        workingItemCount += items.length
        workingItems.push(...items)
        return
      }

      items.forEach((item) => {
        const previousItem = workingItems.at(-1)
        if (item.type !== 'message' && previousItem && previousItem.type !== 'message') {
          const groupedItems = groupWorkingItemsForRenderer([previousItem, item])
          const groupedItem = groupedItems[0]
          if (groupedItems.length === 1 && groupedItem?.type === 'toolGroup') {
            const toolCount = Math.max(groupedItem.toolCount ?? 0, groupedItem.tools.length)
            const tools = groupedItem.tools.slice(-rendererWorkingToolGroupLimit)
            workingItems[workingItems.length - 1] = {
              ...groupedItem,
              tools,
              toolCount,
              toolsStartIndex: Math.max(0, toolCount - tools.length)
            }
            return
          }
        }

        workingItemCount += 1
        if (item.type === 'toolGroup') {
          const toolCount = Math.max(item.toolCount ?? 0, item.tools.length)
          const tools = item.tools.slice(-rendererWorkingToolGroupLimit)
          workingItems.push({
            ...item,
            tools,
            toolCount,
            toolsStartIndex: Math.max(0, toolCount - tools.length)
          })
        } else {
          workingItems.push(item)
        }
        if (workingItems.length > workingItemTailLimit) {
          workingItems.splice(0, workingItems.length - workingItemTailLimit)
        }
      })
    }
    const flushBufferedFinalMessage = (): boolean => {
      if (!finalMessage) return false

      pushWorkingStep(workingStatus, finalMessage)
      finalMessage = null
      return true
    }

    for (let itemIndex = resume?.index ?? 0; itemIndex < turn.items.length; itemIndex += 1) {
      const item = turn.items[itemIndex]
      if (projection) projection.processedRecordCount += 1
      if (projection && itemIndex === turn.items.length - 1) {
        checkpoint = {
          index: itemIndex,
          chatItems: chatItems.slice(),
          finalMessage,
          workingItems: workingItems.slice(),
          pendingTimelineAnchors: pendingTimelineAnchors.slice(),
          renderedSubagentCompletionAnchorIds: new Set(renderedSubagentCompletionAnchorIds),
          workingItemCount,
          hasSeenInitialUserMessage,
          renderedContextCompactionItemIds: new Set(renderedContextCompactionItemIds),
          workingStepCount,
          scan: checkpointScan
        }
      }
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
        const content = getUserInputContent(item.content)
        const attachments = collectUserInputAttachments(item.content)
        if (content || attachments.length > 0) {
          const itemId = `${turn.id}:${item.id}`

          if (hasSeenInitialUserMessage) {
            pushWorkingStep('worked')

            chatItems.push({
              type: 'message',
              id: itemId,
              editTargetId: null,
              role: 'user',
              content,
              attachments,
              kind: 'steering',
              label: 'Steering with',
              createdAt: toMilliseconds(startedAt),
              model: turn.model ?? null
            })
          } else {
            chatItems.push({
              type: 'message',
              id: itemId,
              editTargetId: turn.local === true ? null : turn.id,
              role: 'user',
              content,
              attachments,
              createdAt: toMilliseconds(startedAt),
              model: turn.model ?? null
            })
            hasSeenInitialUserMessage = true
          }
        }
        continue
      }

      if (item.type === 'subAgentActivity' && item.kind === 'completed' && item.agentThreadId) {
        const anchorId = getCodexSubagentTimelineAnchorId(turn.id, item.agentThreadId)
        if (!renderedSubagentCompletionAnchorIds.has(anchorId)) {
          renderedSubagentCompletionAnchorIds.add(anchorId)
          pendingTimelineAnchors.push({
            type: 'timelineAnchor',
            id: anchorId
          })
        }
        continue
      }

      if (item.type === 'agentMessage' && item.phase === 'final_answer' && item.text?.trim()) {
        const hasLaterSteeringMessage = turn.items.slice(itemIndex + 1).some(hasUserMessageContent)
        if (hasLaterSteeringMessage || itemIndex !== finalMessageIndex) {
          pushWorkingStep('worked')
          chatItems.push(createAssistantMessage(turn, item, completedAt))
          continue
        }
      }

      if (itemIndex === finalMessageIndex && item.text?.trim()) {
        finalMessage = createAssistantMessage(turn, item, completedAt)
        continue
      }

      appendWorkingItems(renderWorkingItems(item, turn.id))
    }

    if (workingStatus === 'failed') {
      const errorText = getTurnErrorText(turn)
      if (errorText) {
        appendWorkingItems([{ type: 'message', id: `${turn.id}:failure`, content: errorText }])
      }
    }
    if (!flushBufferedFinalMessage()) pushWorkingStep(workingStatus)
    if (projection && checkpoint)
      projection.set(turn.id, {
        turn,
        fallbackStartedAt,
        tailLimit,
        finalMessageIndex,
        checkpoint
      })
  }

  // Automatic goal turns have no user message to establish their paging boundary. Mark the
  // first rendered item on every snapshot, including when an empty live turn gains content.
  const firstItem = chatItems[0]
  if (firstItem && !(firstItem.type === 'message' && firstItem.role === 'user')) {
    chatItems[0] = { ...firstItem, startsTurn: true }
  }
  return chatItems
}

const turnChatItemsCache = new WeakMap<
  CodexTurn,
  { fallbackStartedAt: number | null; items: ProviderChatItem[]; workingItemTailLimit?: number }
>()

export const getChatItems = (
  turns: CodexTurn[],
  fallbackStartedAt: number | null = null,
  options: GetChatItemsOptions = {},
  projection?: CodexTranscriptProjection
): ProviderChatItem[] => {
  if (options.turnWindow) {
    const { startIndex, limit } = options.turnWindow
    const count = Math.max(1, Math.floor(limit))
    const start = Math.max(0, startIndex ?? turns.length - count)
    return getChatItems(
      turns.slice(start, start + count),
      fallbackStartedAt,
      { ...options, turnWindow: undefined },
      projection
    )
  }
  const chatItems: ProviderChatItem[] = []
  for (const turn of turns) {
    const workingItemTailLimit =
      options.workingItemTailTurnId === turn.id ? options.workingItemTailLimit : undefined
    // Keep the explicit incremental projection independent from the full-read cache.
    if (!isFinishedTurn(turn) && projection) {
      chatItems.push(...renderChatItems([turn], fallbackStartedAt, options, projection))
      continue
    }
    const cachedTurn = turnChatItemsCache.get(turn)
    if (
      cachedTurn &&
      cachedTurn.fallbackStartedAt === fallbackStartedAt &&
      cachedTurn.workingItemTailLimit === workingItemTailLimit
    ) {
      chatItems.push(...cachedTurn.items)
      continue
    }

    const items = renderChatItems(
      [turn],
      fallbackStartedAt,
      options,
      isFinishedTurn(turn) ? undefined : projection
    )
    turnChatItemsCache.set(turn, { fallbackStartedAt, items, workingItemTailLimit })
    chatItems.push(...items)
  }

  return chatItems
}
