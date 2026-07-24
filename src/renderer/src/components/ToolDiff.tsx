import { useMemo } from 'react'
import { Diff, markEdits, parseDiff, tokenize } from 'react-diff-view'
import type { FileData, HunkData, HunkTokens } from 'react-diff-view'
import { refractor } from 'refractor'
import jsx from 'refractor/jsx'
import tsx from 'refractor/tsx'
import type { ProviderFileDiff } from '../../../shared/provider'
import 'react-diff-view/style/index.css'

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

const getDisplayPath = (path: string, projectCwd: string | null | undefined): string => {
  const normalizedPath = path.replace(/\\/g, '/')
  const rawProjectCwd = projectCwd?.trim().replace(/\\/g, '/')
  const normalizedProjectCwd =
    rawProjectCwd === '/' || /^[A-Za-z]:\/$/.test(rawProjectCwd ?? '')
      ? rawProjectCwd
      : rawProjectCwd?.replace(/\/+$/, '')

  if (!normalizedProjectCwd) return normalizedPath

  const caseInsensitive = /^(?:[A-Za-z]:\/|\/\/)/.test(normalizedProjectCwd)
  const comparisonPath = caseInsensitive ? normalizedPath.toLocaleLowerCase() : normalizedPath
  const comparisonProjectCwd = caseInsensitive
    ? normalizedProjectCwd.toLocaleLowerCase()
    : normalizedProjectCwd

  if (comparisonPath === comparisonProjectCwd) {
    return normalizedPath.split('/').filter(Boolean).at(-1) ?? normalizedPath
  }

  const projectPrefix = comparisonProjectCwd.endsWith('/')
    ? comparisonProjectCwd
    : `${comparisonProjectCwd}/`
  if (!comparisonPath.startsWith(projectPrefix)) return normalizedPath

  return normalizedPath.slice(projectPrefix.length)
}

const getLanguage = (path: string): string | null => {
  const fileName = path.split(/[\\/]/).at(-1)?.toLocaleLowerCase() ?? ''
  const extension = fileName.includes('.') ? (fileName.split('.').at(-1) ?? '') : ''
  const language = languageByFileName[fileName] ?? languageByExtension[extension]

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

const toUnifiedDiff = ({ diff, kind }: ProviderFileDiff): string => {
  const normalized = diff.replace(/\r\n?/g, '\n')
  const trimmed = normalized.trimStart()

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
  } catch {
    return null
  }
}

const getRenderedFiles = (
  fileDiff: ProviderFileDiff
): Array<{ file: FileData; tokens: HunkTokens | null }> => {
  const unifiedDiff = toUnifiedDiff(fileDiff)
  if (!unifiedDiff) return []

  try {
    const language = getLanguage(fileDiff.path)

    return parseDiff(unifiedDiff)
      .filter((file) => file.hunks.length > 0)
      .map((file) => ({
        file,
        tokens: getTokens(file.hunks, language)
      }))
  } catch {
    return []
  }
}

export const ToolDiff = ({
  fileDiff,
  projectCwd
}: {
  fileDiff: ProviderFileDiff
  projectCwd?: string | null
}): React.JSX.Element => {
  const files = useMemo(() => getRenderedFiles(fileDiff), [fileDiff])
  const displayPath = getDisplayPath(fileDiff.path, projectCwd)

  return (
    <section className="chat-detail__diff-section">
      <div className="chat-detail__diff-path">{displayPath}</div>
      {files.length > 0 ? (
        <div className="chat-detail__diff-scroll">
          {files.map(({ file, tokens }, index) => (
            <Diff
              className="chat-detail__diff"
              diffType={file.type}
              hunks={file.hunks}
              key={`${file.oldPath}:${file.newPath}:${index}`}
              tokens={tokens}
              viewType="unified"
            />
          ))}
        </div>
      ) : (
        <pre>{fileDiff.diff}</pre>
      )}
    </section>
  )
}
