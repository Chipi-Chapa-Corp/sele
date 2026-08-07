import type { Tokens } from 'marked'

export type MarkdownFileTarget = {
  path: string
  displayPath: string
  line?: number
}

const externalLinkPattern = /^(?:https?|mailto|tel):/i
const windowsAbsolutePathPattern = /^[a-z]:[\\/]/i
const sourceLocationPattern = /^(.*?):(\d+)(?::\d+)?$/
const fragmentLocationPattern = /#L(\d+)(?:C\d+)?$/i

const decodeLinkTarget = (target: string): string => {
  try {
    return decodeURIComponent(target)
  } catch {
    return target
  }
}

export const getMarkdownFileTarget = (href: string | undefined): MarkdownFileTarget | null => {
  let rawHref = href?.trim()
  if (rawHref?.startsWith('<') && rawHref.endsWith('>')) rawHref = rawHref.slice(1, -1)
  if (!rawHref || rawHref.startsWith('#') || externalLinkPattern.test(rawHref)) return null

  const fragmentLocationMatch = rawHref.match(fragmentLocationPattern)
  const withoutFragment = fragmentLocationMatch
    ? rawHref.slice(0, fragmentLocationMatch.index)
    : rawHref
  const locationMatch = withoutFragment.match(sourceLocationPattern)
  let path = decodeLinkTarget(locationMatch?.[1] ?? withoutFragment)
  const lineValue = fragmentLocationMatch?.[1] ?? locationMatch?.[2]
  const parsedLine = lineValue ? Number.parseInt(lineValue, 10) : undefined
  const line =
    parsedLine && Number.isSafeInteger(parsedLine) && parsedLine > 0 ? parsedLine : undefined

  if (/^file:\/\//i.test(path)) {
    try {
      path = decodeLinkTarget(new URL(path).pathname)
      if (/^\/[a-z]:\//i.test(path)) path = path.slice(1)
    } catch {
      return null
    }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !windowsAbsolutePathPattern.test(path)) {
    return null
  }

  const displayPath = path.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!displayPath) return null

  return { path, displayPath, line }
}

const withoutSourceLocationText = (text: string, line: number | undefined): string => {
  if (!line) return text

  const locationPattern = new RegExp(`(?::${line}(?::\\d+)?|#L${line}(?:C\\d+)?)$`, 'i')
  return text.replace(locationPattern, '')
}

export const getMarkdownFileLinkLabel = (
  token: Pick<Tokens.Link, 'text' | 'tokens'>,
  line: number | undefined
): string => {
  const text = token.tokens
    .map((inlineToken) => (inlineToken.type === 'codespan' ? inlineToken.text : inlineToken.raw))
    .join('')

  return withoutSourceLocationText(text || token.text, line)
}
