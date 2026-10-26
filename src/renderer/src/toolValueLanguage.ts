// Language detection is a lexical hint, not JSON validation. Provider output can
// be incomplete while streaming, and failed probes are normal text, not errors.
const looksLikeJson = (value: string): boolean =>
  /^(?:\{\s*(?:"|\})|\[\s*(?:\{|\[|"|-?\d|true\b|false\b|null\b|\]))/.test(
    value.trimStart().slice(0, 256)
  )

export const getOutputLanguage = (value: string): string | null => {
  if (looksLikeJson(value)) return 'json'
  const trimmed = value.trimStart()
  if (trimmed.startsWith('diff --git ') || trimmed.startsWith('@@ ')) return 'diff'
  if (/^<(?!!--)[A-Za-z][^>]*>/.test(trimmed)) return 'markup'
  return null
}

export const getInputLanguage = (value: string): string => {
  if (looksLikeJson(value)) return 'json'
  if (/^(?:tools|functions)\.[A-Za-z0-9_]+\s*\(/.test(value.trimStart())) return 'javascript'
  return 'bash'
}

export const getToolValueLanguage = (value: unknown, input = false): string | null => {
  if (typeof value !== 'string') return 'json'
  return input ? getInputLanguage(value) : getOutputLanguage(value)
}
