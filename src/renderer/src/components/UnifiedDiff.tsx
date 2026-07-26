import { useEffect, useId, useMemo, useRef } from 'react'
import '../monacoEnvironment'
import * as monaco from 'monaco-editor'
import {
  Diff,
  findChangeByNewLineNumber,
  findChangeByOldLineNumber,
  getChangeKey,
  markEdits,
  parseDiff,
  tokenize
} from 'react-diff-view'
import type { FileData, HunkData, HunkTokens } from 'react-diff-view'
import { refractor } from 'refractor'
import jsx from 'refractor/jsx'
import tsx from 'refractor/tsx'
import type { ProviderFileDiff } from '../../../shared/provider'
import 'react-diff-view/style/index.css'
import './UnifiedDiff.css'

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

const maxStructuredDiffLength = 200_000
const maxStructuredDiffLines = 4_000

const hasMoreThanLines = (value: string, maxLines: number): boolean => {
  let lineCount = 1
  let index = -1

  while ((index = value.indexOf('\n', index + 1)) >= 0) {
    lineCount += 1
    if (lineCount > maxLines) return true
  }

  return false
}

const refractorAdapter = {
  // react-diff-view expects the pre-refractor@4 array result rather than a HAST root.
  highlight: (value: string, language: string) => refractor.highlight(value, language).children
}

const getConfiguredLanguage = (path: string): string | null => {
  const fileName = path.split(/[\\/]/).at(-1)?.toLocaleLowerCase() ?? ''
  const extension = fileName.includes('.') ? (fileName.split('.').at(-1) ?? '') : ''
  return languageByFileName[fileName] ?? languageByExtension[extension] ?? null
}

const getLanguage = (path: string): string | null => {
  const language = getConfiguredLanguage(path)
  return language && refractor.registered(language) ? language : null
}

const monacoLanguageAliases: Record<string, string> = {
  bash: 'shell',
  c: 'cpp',
  jsx: 'javascript',
  makefile: 'plaintext',
  markup: 'html',
  plain: 'plaintext',
  tsx: 'typescript'
}

const getMonacoLanguage = (path: string): string => {
  const language = getConfiguredLanguage(path)
  return language ? (monacoLanguageAliases[language] ?? language) : 'plaintext'
}

const editorFontFamily =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"

monaco.editor.defineTheme('sele-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '777772' },
    { token: 'delimiter', foreground: '666661' },
    { token: 'number', foreground: 'A03C38' },
    { token: 'regexp', foreground: 'A75022' },
    { token: 'string', foreground: '39744B' },
    { token: 'keyword', foreground: '7D438E' },
    { token: 'type', foreground: '76552F' },
    { token: 'type.identifier', foreground: '76552F' },
    { token: 'function', foreground: '76552F' },
    { token: 'operator', foreground: '8C5A24' },
    { token: 'variable', foreground: '8C5A24' }
  ],
  colors: {
    'editor.background': '#f7f7f5',
    'editor.foreground': '#111110',
    'editor.lineHighlightBackground': '#7a563812',
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#7a563847',
    'editor.inactiveSelectionBackground': '#7a56381f',
    'editorCursor.foreground': '#111110',
    'editorGutter.background': '#f7f7f5',
    'editorLineNumber.foreground': '#858580',
    'editorLineNumber.activeForeground': '#272725',
    'editorIndentGuide.background1': '#1b1b181f',
    'editorIndentGuide.activeBackground1': '#7a56385c',
    'editorWhitespace.foreground': '#1b1b182e',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#1b1b182e',
    'scrollbarSlider.hoverBackground': '#1b1b1840',
    'scrollbarSlider.activeBackground': '#7a56385c',
    'diffEditor.insertedLineBackground': '#2f8f5b24',
    'diffEditor.insertedTextBackground': '#2f8f5b52',
    'diffEditor.removedLineBackground': '#b9473f24',
    'diffEditor.removedTextBackground': '#b9473f52',
    'diffEditorGutter.insertedLineBackground': '#2f8f5b66',
    'diffEditorGutter.removedLineBackground': '#b9473f66'
  }
})

monaco.editor.defineTheme('sele-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '898984' },
    { token: 'delimiter', foreground: 'B4B4AF' },
    { token: 'number', foreground: 'EE8580' },
    { token: 'regexp', foreground: 'E99B65' },
    { token: 'string', foreground: '8FC89D' },
    { token: 'keyword', foreground: 'D49AE2' },
    { token: 'type', foreground: 'D8AC7E' },
    { token: 'type.identifier', foreground: 'D8AC7E' },
    { token: 'function', foreground: 'D8AC7E' },
    { token: 'operator', foreground: 'DDB278' },
    { token: 'variable', foreground: 'DDB278' }
  ],
  colors: {
    'editor.background': '#181818',
    'editor.foreground': '#f8f8f8',
    'editor.lineHighlightBackground': '#7a56381f',
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#7a563857',
    'editor.inactiveSelectionBackground': '#7a563829',
    'editorCursor.foreground': '#f8f8f8',
    'editorGutter.background': '#181818',
    'editorLineNumber.foreground': '#7f7f7f',
    'editorLineNumber.activeForeground': '#f8f8f8',
    'editorIndentGuide.background1': '#ffffff1a',
    'editorIndentGuide.activeBackground1': '#7a563870',
    'editorWhitespace.foreground': '#ffffff24',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#ffffff24',
    'scrollbarSlider.hoverBackground': '#ffffff38',
    'scrollbarSlider.activeBackground': '#7a563870',
    'diffEditor.insertedLineBackground': '#68c58e24',
    'diffEditor.insertedTextBackground': '#68c58e52',
    'diffEditor.removedLineBackground': '#f0837924',
    'diffEditor.removedTextBackground': '#f0837952',
    'diffEditorGutter.insertedLineBackground': '#68c58e66',
    'diffEditorGutter.removedLineBackground': '#f0837966'
  }
})

const getMonacoTheme = (): 'sele-light' | 'sele-dark' =>
  document.documentElement.dataset.colorScheme === 'dark' ? 'sele-dark' : 'sele-light'

const getEditorFontSize = (element: HTMLElement): number => {
  const fontSize = Number.parseFloat(getComputedStyle(element).fontSize)
  return Number.isFinite(fontSize) ? fontSize : 14
}

let editableDiffInstanceId = 0

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

const getOriginalContents = (fileDiff: ProviderFileDiff, currentContents: string): string => {
  const unifiedDiff = toUnifiedDiff(fileDiff)
  if (!unifiedDiff) return fileDiff.kind === 'create' ? '' : currentContents

  try {
    const file = parseDiff(unifiedDiff)[0]
    if (!file || file.hunks.length === 0) {
      return fileDiff.kind === 'create' ? '' : currentContents
    }

    const oldLines = file.hunks.flatMap((hunk) =>
      hunk.changes.flatMap((change) => (change.type === 'insert' ? [] : [change.content]))
    )
    const contents = oldLines.join('\n')
    return file.oldEndingNewLine && oldLines.length > 0 ? `${contents}\n` : contents
  } catch {
    return fileDiff.kind === 'create' ? '' : currentContents
  }
}

export const EditableUnifiedDiff = ({
  ariaLabel,
  baselineContents,
  className,
  contents,
  fileDiff,
  line,
  onChange,
  onSave
}: {
  ariaLabel: string
  baselineContents: string
  className?: string
  contents: string
  fileDiff: ProviderFileDiff
  line?: number
  onChange: (contents: string) => void
  onSave: () => void
}): React.JSX.Element => {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorStateRef = useRef<{
    modifiedEditor: monaco.editor.IStandaloneCodeEditor
    originalModel: monaco.editor.ITextModel
    modifiedModel: monaco.editor.ITextModel
  } | null>(null)
  const initialConfigRef = useRef({ baselineContents, contents, fileDiff })
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    const parent = hostRef.current
    if (!parent) return

    const initialConfig = initialConfigRef.current
    const original = getOriginalContents(initialConfig.fileDiff, initialConfig.baselineContents)
    const language = getMonacoLanguage(initialConfig.fileDiff.path)
    const instanceId = ++editableDiffInstanceId
    const modelPath = initialConfig.fileDiff.path.replace(/\\/g, '/').replace(/^\/+/, '')
    const originalModel = monaco.editor.createModel(
      original,
      language,
      monaco.Uri.from({
        scheme: 'inmemory',
        authority: 'sele',
        path: `/${instanceId}/original/${modelPath}`
      })
    )
    const modifiedModel = monaco.editor.createModel(
      initialConfig.contents,
      language,
      monaco.Uri.from({
        scheme: 'inmemory',
        authority: 'sele',
        path: `/${instanceId}/modified/${modelPath}`
      })
    )
    originalModel.updateOptions({ insertSpaces: true, tabSize: 2 })
    modifiedModel.updateOptions({ insertSpaces: true, tabSize: 2 })

    const editor = monaco.editor.createDiffEditor(parent, {
      ariaLabel,
      automaticLayout: true,
      diffAlgorithm: 'advanced',
      diffWordWrap: 'off',
      fontFamily: editorFontFamily,
      fontSize: getEditorFontSize(parent),
      folding: false,
      glyphMargin: false,
      ignoreTrimWhitespace: false,
      lineNumbers: 'on',
      minimap: { enabled: false },
      modifiedAriaLabel: ariaLabel,
      originalAriaLabel: `Original ${ariaLabel}`,
      originalEditable: false,
      overviewRulerLanes: 0,
      readOnly: false,
      renderGutterMenu: false,
      renderMarginRevertIcon: false,
      renderOverviewRuler: false,
      renderSideBySide: false,
      renderValidationDecorations: 'off',
      scrollBeyondLastLine: false,
      stickyScroll: { enabled: false },
      theme: getMonacoTheme(),
      wordWrap: 'off'
    })
    editor.setModel({ original: originalModel, modified: modifiedModel })
    const originalEditor = editor.getOriginalEditor()
    const modifiedEditor = editor.getModifiedEditor()
    editorStateRef.current = { modifiedEditor, modifiedModel, originalModel }
    originalEditor.updateOptions({ ariaLabel: `Original ${ariaLabel}` })
    modifiedEditor.updateOptions({ ariaLabel })

    const changeSubscription = modifiedModel.onDidChangeContent(() => {
      onChangeRef.current(modifiedModel.getValue())
    })
    modifiedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
      onSaveRef.current()
    )

    const themeObserver = new MutationObserver(() => {
      monaco.editor.setTheme(getMonacoTheme())
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-color-scheme']
    })

    queueMicrotask(() => modifiedEditor.focus())
    return () => {
      editorStateRef.current = null
      themeObserver.disconnect()
      changeSubscription.dispose()
      editor.dispose()
      originalModel.dispose()
      modifiedModel.dispose()
    }
  }, [ariaLabel])

  useEffect(() => {
    const modifiedEditor = editorStateRef.current?.modifiedEditor
    if (!modifiedEditor || !line) return

    const lineNumber = Math.min(line, modifiedEditor.getModel()?.getLineCount() ?? line)
    modifiedEditor.setPosition({ lineNumber, column: 1 })
    modifiedEditor.revealLineInCenter(lineNumber, monaco.editor.ScrollType.Immediate)
  }, [line])

  useEffect(() => {
    const editorState = editorStateRef.current
    if (!editorState) return

    const original = getOriginalContents(fileDiff, baselineContents)
    if (editorState.originalModel.getValue() !== original) {
      editorState.originalModel.setValue(original)
    }
  }, [baselineContents, fileDiff])

  return (
    <div className={['editable-unified-diff', className].filter(Boolean).join(' ')} ref={hostRef} />
  )
}

export const UnifiedDiff = ({
  className,
  fileDiff,
  line
}: {
  className?: string
  fileDiff: ProviderFileDiff
  line?: number
}): React.JSX.Element => {
  const renderStructuredDiff = useMemo(
    () =>
      fileDiff.diff.length <= maxStructuredDiffLength &&
      !hasMoreThanLines(fileDiff.diff, maxStructuredDiffLines),
    [fileDiff.diff]
  )
  const files = useMemo(
    () => (renderStructuredDiff ? getRenderedFiles(fileDiff) : []),
    [fileDiff, renderStructuredDiff]
  )
  const targetAnchorId = `unified-diff-target-${useId().replace(/:/g, '')}`
  const lineTarget = useMemo(() => {
    if (!line) return null

    for (const [fileIndex, { file }] of files.entries()) {
      const change =
        fileDiff.kind === 'delete'
          ? findChangeByOldLineNumber(file.hunks, line)
          : findChangeByNewLineNumber(file.hunks, line)
      if (change) return { fileIndex, changeKey: getChangeKey(change) }
    }

    return null
  }, [fileDiff.kind, files, line])
  const diffClassName = ['unified-diff', className].filter(Boolean).join(' ')

  useEffect(() => {
    if (!lineTarget) return

    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(targetAnchorId)
        ?.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [lineTarget, targetAnchorId])

  if (files.length === 0) {
    return <pre className="unified-diff__fallback">{fileDiff.diff}</pre>
  }

  return (
    <>
      {files.map(({ file, tokens }, index) => {
        const targetChangeKey = lineTarget?.fileIndex === index ? lineTarget.changeKey : undefined

        return (
          <Diff
            className={diffClassName}
            diffType={file.type}
            generateAnchorID={
              targetChangeKey
                ? (change) =>
                    getChangeKey(change) === targetChangeKey ? targetAnchorId : undefined
                : undefined
            }
            hunks={file.hunks}
            key={`${file.oldPath}:${file.newPath}:${index}`}
            selectedChanges={targetChangeKey ? [targetChangeKey] : undefined}
            tokens={tokens}
            viewType="unified"
          />
        )
      })}
    </>
  )
}
