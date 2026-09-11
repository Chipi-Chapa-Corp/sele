type Container = { kind: 'object' | 'array'; expecting: 'key' | 'colon' | 'value' | 'separator' }

/**
 * Parses a JSON document that may be cut off at any character, as happens while a tool input
 * streams through `input_json_delta` events. Incomplete trailing tokens are dropped or closed so
 * the values received so far become visible instead of waiting for the final delta.
 *
 * Returns undefined when nothing parseable has arrived yet.
 */
export const parsePartialJson = (source: string): unknown => {
  try {
    return JSON.parse(source)
  } catch {
    // Fall through to best-effort completion of the fragment.
  }

  const stack: Container[] = []
  let inString = false
  let stringStart = -1
  let scalarStart = -1
  let index = 0

  const top = (): Container | undefined => stack[stack.length - 1]
  const finishValue = (): void => {
    const container = top()
    if (container) container.expecting = 'separator'
  }

  while (index < source.length) {
    const char = source[index]!
    if (inString) {
      if (char === '\\') {
        // A cut escape sequence has no valid completion; retreat to before the backslash.
        if (
          index + 1 >= source.length ||
          (source[index + 1] === 'u' && index + 6 > source.length)
        ) {
          source = source.slice(0, index)
          break
        }
        index += source[index + 1] === 'u' ? 6 : 2
        continue
      }
      if (char === '"') {
        inString = false
        const container = top()
        if (container?.expecting === 'key') container.expecting = 'colon'
        else finishValue()
      }
      index += 1
      continue
    }
    if (scalarStart >= 0) {
      if (/[\s,\]}]/.test(char)) {
        scalarStart = -1
        finishValue()
        continue
      }
      index += 1
      continue
    }
    if (char === '"') {
      inString = true
      stringStart = index
    } else if (char === '{' || char === '[') {
      const container = top()
      if (container) container.expecting = 'separator'
      stack.push({
        kind: char === '{' ? 'object' : 'array',
        expecting: char === '{' ? 'key' : 'value'
      })
    } else if (char === '}' || char === ']') {
      stack.pop()
      finishValue()
    } else if (char === ':') {
      const container = top()
      if (container) container.expecting = 'value'
    } else if (char === ',') {
      const container = top()
      if (container) container.expecting = container.kind === 'object' ? 'key' : 'value'
    } else if (!/\s/.test(char)) {
      scalarStart = index
    }
    index += 1
  }

  let completed = source
  if (inString) {
    if (top()?.expecting === 'key') {
      completed = completed.slice(0, stringStart)
    } else {
      completed += '"'
    }
  } else if (scalarStart >= 0) {
    const literal = completed.slice(scalarStart)
    const keyword = ['true', 'false', 'null'].find((word) => word.startsWith(literal))
    if (keyword) completed = completed.slice(0, scalarStart) + keyword
    else completed = completed.slice(0, scalarStart) + literal.replace(/[.eE+-]+$/, '')
  }

  completed = completed.replace(/\s+$/, '')
  if (/[,:]$/.test(completed) || (inString && top()?.expecting === 'key')) {
    completed = completed.replace(/\s*,?\s*$/, '')
  }
  if (/:$/.test(completed)) completed += 'null'
  else if (/"$/.test(completed) && top()?.expecting === 'colon' && !inString) {
    // A complete key with no value yet is dropped along with its leading separator.
    completed = completed
      .slice(0, completed.lastIndexOf('"', completed.length - 2))
      .replace(/\s*,?\s*$/, '')
  }
  for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
    completed += stack[depth]!.kind === 'object' ? '}' : ']'
  }

  try {
    return JSON.parse(completed)
  } catch {
    return undefined
  }
}
