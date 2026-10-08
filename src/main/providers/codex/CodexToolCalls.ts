export type NestedToolCall = {
  name: string
  offset: number
}

type NestedToolCallOptions = {
  includeQuoted?: boolean
}

const nestedToolNames = new Set([
  'exec_command',
  'apply_patch',
  'update_plan',
  'write_stdin',
  'view_image',
  'request_user_input',
  'request_user_input_async',
  'request_plugin_install'
])

const isNestedToolName = (name: string): boolean =>
  nestedToolNames.has(name) ||
  name.startsWith('mcp__') ||
  name.startsWith('web__') ||
  name.startsWith('image_gen__')

const getToolCallNameAt = (input: string, index: number): string | null => {
  const match = input.slice(index).match(/^(?:tools|functions)\.([A-Za-z0-9_]+)\s*\(/)
  if (!match || !isNestedToolName(match[1])) return null
  return match[1]
}

export const getNestedToolCalls = (
  input: string,
  options: NestedToolCallOptions = {}
): NestedToolCall[] => {
  const calls: NestedToolCall[] = []
  let quote: string | null = null
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    const nextCharacter = input[index + 1]

    if (lineComment) {
      if (character === '\n') lineComment = false
      continue
    }

    if (blockComment) {
      if (character === '*' && nextCharacter === '/') {
        blockComment = false
        index += 1
      }
      continue
    }

    if (!quote || options.includeQuoted) {
      const name = getToolCallNameAt(input, index)
      if (name) calls.push({ name, offset: index })
    }

    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = null
      continue
    }

    if (character === '/' && nextCharacter === '/') {
      lineComment = true
      index += 1
      continue
    }

    if (character === '/' && nextCharacter === '*') {
      blockComment = true
      index += 1
      continue
    }

    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }
  }

  return calls
}

export const isPatchToolCall = (input: string, calls = getNestedToolCalls(input)): boolean =>
  calls.some((call) => call.name === 'apply_patch') || input.includes('*** Begin Patch')
