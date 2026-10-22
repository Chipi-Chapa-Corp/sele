import { markEdits, parseDiff, tokenize } from 'react-diff-view'
import type { FileData, HunkData, HunkTokens } from 'react-diff-view'
import { refractor } from 'refractor'
import jsx from 'refractor/jsx'
import tsx from 'refractor/tsx'
import type { ProviderFileDiff } from '../../shared/provider'
import { createBoundedTextCache } from './boundedTextCache.ts'
import { getSyntaxTreeCacheSize } from './syntaxTreeSize.ts'

if (!refractor.registered('jsx')) refractor.register(jsx)
if (!refractor.registered('tsx')) refractor.register(tsx)

const languageByExtension: Record<string, string> = {
  bash: 'bash',
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  cts: 'typescript',
  go: 'go',
  h: 'c',
  hpp: 'cpp',
  htm: 'markup',
  html: 'markup',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'jsx',
  kt: 'kotlin',
  less: 'less',
  lua: 'lua',
  md: 'markdown',
  mdx: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  php: 'php',
  pl: 'perl',
  py: 'python',
  r: 'r',
  rb: 'ruby',
  rs: 'rust',
  sass: 'sass',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  svg: 'markup',
  swift: 'swift',
  ts: 'typescript',
  tsx: 'tsx',
  txt: 'plain',
  vb: 'vbnet',
  xml: 'markup',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash'
}

const languageByFileName: Record<string, string> = {
  '.bashrc': 'bash',
  '.zshrc': 'bash',
  makefile: 'makefile'
}

const refractorAdapter = {
  // react-diff-view expects the pre-refractor@4 array result rather than a HAST root.
  highlight: (value: string, language: string) => refractor.highlight(value, language).children
}

export const getConfiguredLanguage = (path: string): string | null => {
  const fileName = path.split(/[\\/]/).at(-1)?.toLocaleLowerCase() ?? ''
  const extension = fileName.includes('.') ? (fileName.split('.').at(-1) ?? '') : ''
  return languageByFileName[fileName] ?? languageByExtension[extension] ?? null
}

const getLanguage = (path: string): string | null => {
  const language = getConfiguredLanguage(path)
  return language && refractor.registered(language) ? language : null
}

const getSyntheticHeader = (kind: ProviderFileDiff['kind']): string => {
  const paths =
    kind === 'create'
      ? '--- /dev/null\n+++ b/file'
      : kind === 'delete'
        ? '--- a/file\n+++ /dev/null'
        : '--- a/file\n+++ b/file'

  return `diff --git a/file b/file\n${paths}\n`
}

const getContentLines = (content: string): { lines: string[]; endsWithNewLine: boolean } => {
  const normalized = content.replace(/\r\n?/g, '\n')
  const endsWithNewLine = normalized.endsWith('\n')
  const lines = normalized ? normalized.split('\n') : []

  if (endsWithNewLine) lines.pop()
  return { lines, endsWithNewLine }
}

const contentToDiff = (content: string, kind: 'create' | 'delete'): string => {
  const { lines, endsWithNewLine } = getContentLines(content)
  if (lines.length === 0) return ''

  const marker = kind === 'create' ? '+' : '-'
  const range = kind === 'create' ? `-0,0 +1,${lines.length}` : `-1,${lines.length} +0,0`
  const noNewLineMarker = endsWithNewLine ? '' : '\n\\ No newline at end of file'

  return `@@ ${range} @@\n${lines.map((line) => `${marker}${line}`).join('\n')}${noNewLineMarker}\n`
}

export const toUnifiedDiff = ({ diff, kind }: ProviderFileDiff): string => {
  const normalized = diff.replace(/\r\n?/g, '\n')
  // jsdiff's createPatch (used by OpenCode) prefixes the patch with an
  // "Index: <path>" line and a "====" separator before the ---/+++ headers.
  const trimmed = normalized.trimStart().replace(/^Index: [^\n]*\n(?:=+\n)?/, '')

  if (trimmed.startsWith('diff --git ')) return trimmed
  if (trimmed.startsWith('--- ')) return `diff --git a/file b/file\n${trimmed}`
  if (trimmed.startsWith('@@ ')) return `${getSyntheticHeader(kind)}${trimmed}`
  if (kind === 'create' || kind === 'delete') {
    return `${getSyntheticHeader(kind)}${contentToDiff(normalized, kind)}`
  }

  return ''
}

const getTokens = (hunks: HunkData[], language: string | null): HunkTokens | null => {
  try {
    const enhancers = [markEdits(hunks)]

    if (!language) return tokenize(hunks, { enhancers })

    return tokenize(hunks, {
      highlight: true,
      refractor: refractorAdapter,
      language,
      enhancers
    })
  } catch (error) {
    console.error('[caught:unifiedDiffRendering:getTokens]', error)
    return null
  }
}

type RenderedDiffFile = { file: FileData; tokens: HunkTokens | null }

const renderedDiffCache = createBoundedTextCache<RenderedDiffFile[]>(24, 4_000_000, (files) => {
  let size = 0
  for (const { file, tokens } of files) {
    // A failed tokenizer returns the unhighlighted diff. Let a later mount retry.
    if (!tokens) return Infinity
    size += 128 + file.oldPath.length + file.newPath.length
    for (const hunk of file.hunks) {
      size += 128 + hunk.content.length
      for (const change of hunk.changes) size += 128 + change.content.length
    }
    for (const lines of [tokens.old, tokens.new]) {
      for (const line of lines) size += 32 + getSyntaxTreeCacheSize(line)
    }
  }
  return size
})

export const getRenderedDiffFiles = (fileDiff: ProviderFileDiff): RenderedDiffFile[] => {
  const language = getLanguage(fileDiff.path)

  try {
    // IPC sends fresh objects. Cache only the rendering inputs; review state and
    // editor models remain owned by each mounted view.
    return renderedDiffCache.get(`${language}:${fileDiff.kind}:${fileDiff.diff}`, () => {
      const unifiedDiff = toUnifiedDiff(fileDiff)
      if (!unifiedDiff) return []
      return parseDiff(unifiedDiff)
        .filter((file) => file.hunks.length > 0)
        .map((file) => ({ file, tokens: getTokens(file.hunks, language) }))
    })
  } catch (error) {
    console.error('[caught:unifiedDiffRendering:getRenderedFiles]', error)
    return []
  }
}
