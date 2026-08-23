import type { RootContent } from 'hast'
import { refractor } from 'refractor'
import jsx from 'refractor/jsx'
import tsx from 'refractor/tsx'

if (!refractor.registered('jsx')) refractor.register(jsx)
if (!refractor.registered('tsx')) refractor.register(tsx)

export const maxHighlightedCodeLength = 100_000

const markdownLanguageAliases: Readonly<Record<string, string>> = {
  'c#': 'csharp',
  'c++': 'cpp',
  jsonc: 'json',
  mdx: 'markdown',
  shellscript: 'bash',
  zsh: 'bash'
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })

const renderHighlightedNodeToHtml = (node: RootContent): string => {
  if (node.type === 'text') return escapeHtml(node.value)
  if (node.type !== 'element') return ''

  const children = node.children.map(renderHighlightedNodeToHtml).join('')
  if (node.tagName !== 'span') return children

  const classNames = node.properties.className
  const className = Array.isArray(classNames)
    ? classNames.filter((value): value is string => typeof value === 'string').join(' ')
    : typeof classNames === 'string'
      ? classNames
      : ''

  return `<span${className ? ` class="${escapeHtml(className)}"` : ''}>${children}</span>`
}

export const getMarkdownCodeLanguage = (infoString: string | null | undefined): string | null => {
  let language = infoString?.trim().split(/\s+/, 1)[0]?.toLowerCase()
  if (!language) return null

  if (language.startsWith('{.') && language.endsWith('}')) language = language.slice(2, -1)
  if (language.startsWith('language-')) language = language.slice('language-'.length)
  language = markdownLanguageAliases[language] ?? language

  return refractor.registered(language) ? language : null
}

export const highlightCode = (code: string, language: string | null): RootContent[] | null => {
  if (code.length > maxHighlightedCodeLength || !language || !refractor.registered(language)) {
    return null
  }

  try {
    return refractor.highlight(code, language).children
  } catch {
    return null
  }
}

export const renderMarkdownCodeBlock = (
  code: string,
  infoString: string | null | undefined
): string => {
  const language = getMarkdownCodeLanguage(infoString)
  const highlighted = highlightCode(code, language)
  const contents = highlighted
    ? highlighted.map(renderHighlightedNodeToHtml).join('')
    : escapeHtml(code)
  const languageClass = language ? ` class="language-${language}"` : ''

  return `<pre class="chat-detail__highlighted-code"><code${languageClass}>${contents}\n</code></pre>\n`
}
