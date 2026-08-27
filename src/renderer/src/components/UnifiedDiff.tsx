import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import '../monacoEnvironment'
import * as monaco from 'monaco-editor'
import { Check, MessageSquare, Plus, Trash2 } from 'lucide-react'
import {
  Diff,
  findChangeByNewLineNumber,
  findChangeByOldLineNumber,
  getChangeKey,
  markEdits,
  parseDiff,
  tokenize
} from 'react-diff-view'
import type { ChangeData, FileData, HunkData, HunkTokens } from 'react-diff-view'
import { refractor } from 'refractor'
import jsx from 'refractor/jsx'
import tsx from 'refractor/tsx'
import type { ProviderFileDiff, ProviderReviewComment } from '../../../shared/provider'
import { appApi } from '../appApi'
import { toCssRem } from '../cssUnits'
import { appFontSettingsChangedEvent, getCodeFontAppearance } from '../fontAppearance'
import { Button } from './Button'
import { Input } from './Input'
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
const reviewMarkerHeight = 32
const reviewMarkerInset = 22.4
const reviewMarkerWidth = 57.6
const reviewBlockGap = 12.8
const reviewInputWidth = 256

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
    'editorCursor.foreground': '#111110',
    'editorGutter.background': '#f7f7f5',
    'editorLineNumber.foreground': '#858580',
    'editorLineNumber.activeForeground': '#272725',
    'editorIndentGuide.background1': '#1b1b181f',
    'editorIndentGuide.activeBackground1': '#1b1b181f',
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
    'editorCursor.foreground': '#f8f8f8',
    'editorGutter.background': '#181818',
    'editorLineNumber.foreground': '#7f7f7f',
    'editorLineNumber.activeForeground': '#f8f8f8',
    'editorIndentGuide.background1': '#ffffff1a',
    'editorIndentGuide.activeBackground1': '#ffffff1a',
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

type EditorClipboardData = {
  isFromEmptySelection: boolean
  multicursorText: string[] | null
  text: string
}

let lastEditorClipboardData: EditorClipboardData | null = null

const getEditorClipboardData = (
  editor: monaco.editor.IStandaloneCodeEditor
): EditorClipboardData | null => {
  const model = editor.getModel()
  const selections = editor.getSelections()
  if (!model || !selections?.length) return null

  const emptySelectionClipboard = editor.getOption(
    monaco.editor.EditorOption.emptySelectionClipboard
  )
  const sortedSelections = [...selections].sort(monaco.Range.compareRangesUsingStarts)
  const hasNonEmptySelection = sortedSelections.some((selection) => !selection.isEmpty())
  if (!hasNonEmptySelection && !emptySelectionClipboard) return null

  const copiedText: string[] = []
  let previousLineNumber = 0

  for (const selection of sortedSelections) {
    if (selection.isEmpty()) {
      if (emptySelectionClipboard && selection.startLineNumber !== previousLineNumber) {
        const lineNumber = selection.startLineNumber
        const lineRange = new monaco.Range(
          lineNumber,
          model.getLineMinColumn(lineNumber),
          lineNumber,
          model.getLineMaxColumn(lineNumber)
        )
        copiedText.push(model.getValueInRange(lineRange) + model.getEOL())
      }
    } else {
      copiedText.push(model.getValueInRange(selection))
    }

    previousLineNumber = selection.startLineNumber
  }

  if (copiedText.length === 0) return null

  return {
    isFromEmptySelection:
      emptySelectionClipboard && selections.length === 1 && selections[0].isEmpty(),
    multicursorText: copiedText.length > 1 ? copiedText : null,
    text: copiedText.length === 1 ? copiedText[0] : copiedText.join(model.getEOL())
  }
}

const copyEditorSelection = async (
  editor: monaco.editor.IStandaloneCodeEditor
): Promise<boolean> => {
  const clipboardData = getEditorClipboardData(editor)
  if (!clipboardData) return false

  await appApi.writeClipboardText(clipboardData.text)
  lastEditorClipboardData = clipboardData
  return true
}

const pasteIntoEditor = async (editor: monaco.editor.IStandaloneCodeEditor): Promise<void> => {
  const text = await appApi.readClipboardText()
  if (!text) return

  const metadata = lastEditorClipboardData?.text === text ? lastEditorClipboardData : null
  editor.trigger('keyboard', 'paste', {
    mode: null,
    multicursorText: metadata?.multicursorText ?? null,
    pasteOnNewLine: metadata?.isFromEmptySelection ?? false,
    text
  })
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

export type DiffReviewLocation = Pick<ProviderReviewComment, 'line' | 'side'> & {
  endLine: number
}

type ReviewCommentGroup = {
  key: string
  line: number
  side: ProviderReviewComment['side']
  comments: ProviderReviewComment[]
}

type ReviewMarker = {
  group: ReviewCommentGroup
  top: number
}

const getReviewCommentEndLine = (comment: ProviderReviewComment): number =>
  Math.max(comment.line, comment.endLine ?? comment.line)

const getChangeLineNumber = (
  change: ChangeData,
  side: ProviderReviewComment['side']
): number | null => {
  if (change.type === 'normal') {
    return side === 'old' ? change.oldLineNumber : change.newLineNumber
  }
  if (change.type === 'delete') return side === 'old' ? change.lineNumber : null

  return side === 'new' ? change.lineNumber : null
}

const getDiffLineTarget = (
  files: readonly { file: FileData }[],
  kind: ProviderFileDiff['kind'],
  line: number | undefined,
  endLine: number | undefined
): { anchorChangeKey: string; changeKeys: string[]; fileIndex: number } | null => {
  if (!line) return null

  const normalizedEndLine = Math.max(line, endLine ?? line)
  const side = kind === 'delete' ? 'old' : 'new'

  for (const [fileIndex, { file }] of files.entries()) {
    const changeKeys = file.hunks.flatMap((hunk) =>
      hunk.changes.flatMap((change) => {
        const lineNumber = getChangeLineNumber(change, side)
        return lineNumber != null && lineNumber >= line && lineNumber <= normalizedEndLine
          ? [getChangeKey(change)]
          : []
      })
    )
    if (changeKeys.length > 0) {
      return { anchorChangeKey: changeKeys[0], changeKeys, fileIndex }
    }
  }

  return null
}

const groupReviewComments = (comments: readonly ProviderReviewComment[]): ReviewCommentGroup[] => {
  const sortedComments = [...comments].sort(
    (first, second) =>
      first.side.localeCompare(second.side) ||
      first.line - second.line ||
      first.id.localeCompare(second.id)
  )
  const groups: ReviewCommentGroup[] = []

  sortedComments.forEach((comment) => {
    const previousGroup = groups.at(-1)
    const firstGroupLine = previousGroup?.comments[0]?.line
    const previousCommentLine = previousGroup?.comments.at(-1)?.line

    if (
      previousGroup &&
      previousGroup.side === comment.side &&
      firstGroupLine != null &&
      previousCommentLine != null &&
      comment.line - previousCommentLine <= 3 &&
      comment.line - firstGroupLine <= 5
    ) {
      previousGroup.comments.push(comment)
      return
    }

    groups.push({
      key: comment.id,
      line: comment.line,
      side: comment.side,
      comments: [comment]
    })
  })

  return groups
}

const ReviewCommentEditor = ({
  comment,
  onChange,
  onDelete,
  onHighlight
}: {
  comment: ProviderReviewComment
  onChange: (id: string, comment: string) => void
  onDelete: (id: string) => void
  onHighlight: (comments: readonly ProviderReviewComment[] | null) => void
}): React.JSX.Element => {
  const [value, setValue] = useState(comment.comment)
  const trimmedValue = value.trim()
  const endLine = getReviewCommentEndLine(comment)
  const lineLabel =
    endLine === comment.line ? `line ${comment.line}` : `lines ${comment.line}-${endLine}`

  const save = (): void => {
    if (!trimmedValue || trimmedValue === comment.comment) return
    setValue(trimmedValue)
    onChange(comment.id, trimmedValue)
  }

  return (
    <form
      className="unified-diff__review-entry"
      onMouseEnter={() => onHighlight([comment])}
      onMouseLeave={() => onHighlight(null)}
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <Input
        aria-label={`Edit comment on ${lineLabel}`}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <Button
        aria-label="Save comment"
        callback={save}
        disabled={!trimmedValue || trimmedValue === comment.comment}
        icon={<Check aria-hidden="true" />}
        theme="secondary"
        title="Save comment"
      />
      <Button
        aria-label="Delete comment"
        callback={() => {
          onHighlight(null)
          onDelete(comment.id)
        }}
        icon={<Trash2 aria-hidden="true" />}
        theme="secondary"
        title="Delete comment"
      />
    </form>
  )
}

const ReviewMarkers = ({
  markers,
  onChangeComment,
  onDeleteComment,
  onHighlightComments
}: {
  markers: ReviewMarker[]
  onChangeComment?: (id: string, comment: string) => void
  onDeleteComment?: (id: string) => void
  onHighlightComments: (comments: readonly ProviderReviewComment[] | null) => void
}): React.JSX.Element => {
  const [openCommentIds, setOpenCommentIds] = useState<readonly string[] | null>(null)
  const openComments = openCommentIds
    ? markers.flatMap((marker) =>
        marker.group.comments.filter((comment) => openCommentIds.includes(comment.id))
      )
    : []
  const openMarker =
    markers.find((marker) =>
      marker.group.comments.some((comment) => openCommentIds?.includes(comment.id))
    ) ?? null

  return (
    <>
      {markers.map((marker) => (
        <div
          className="unified-diff__review-marker"
          key={marker.group.key}
          style={{ right: toCssRem(reviewMarkerInset), top: toCssRem(marker.top) }}
        >
          <Button
            aria-label={`Open ${marker.group.comments.length} review comment${marker.group.comments.length === 1 ? '' : 's'} near line ${marker.group.line}`}
            aria-expanded={openMarker?.group.key === marker.group.key}
            callback={() =>
              setOpenCommentIds((currentIds) =>
                marker.group.comments.some((comment) => currentIds?.includes(comment.id))
                  ? null
                  : marker.group.comments.map((comment) => comment.id)
              )
            }
            icon={<MessageSquare aria-hidden="true" />}
            label={marker.group.comments.length}
            theme="secondary"
            title={`Review comments near line ${marker.group.line}`}
            onMouseEnter={() => onHighlightComments(marker.group.comments)}
            onMouseLeave={() => onHighlightComments(null)}
            onMouseUp={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          />
        </div>
      ))}
      {openMarker && onChangeComment && onDeleteComment && (
        <div
          className="unified-diff__review-overlay"
          style={{
            right: toCssRem(reviewMarkerInset + reviewMarkerWidth + reviewBlockGap),
            top: toCssRem(openMarker.top)
          }}
          onMouseUp={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            setOpenCommentIds(null)
          }}
        >
          <div className="unified-diff__review-entries">
            {openComments.map((comment) => (
              <ReviewCommentEditor
                comment={comment}
                key={comment.id}
                onChange={onChangeComment}
                onDelete={onDeleteComment}
                onHighlight={onHighlightComments}
              />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

const ReviewInput = ({
  ariaLabel,
  onCancel,
  onSubmit,
  position
}: {
  ariaLabel: string
  onCancel: () => void
  onSubmit: (comment: string) => void
  position: { left: number; top: number }
}): React.JSX.Element => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const trimmedValue = value.trim()

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const submit = (): void => {
    if (!trimmedValue) return
    onSubmit(trimmedValue)
  }

  return (
    <form
      className="unified-diff__review-form"
      style={{ left: toCssRem(position.left), top: toCssRem(position.top) }}
      onMouseUp={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <Input
        ref={inputRef}
        aria-label={ariaLabel}
        value={value}
        placeholder="Add a comment"
        onChange={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          onCancel()
        }}
      />
      <Button
        aria-label="Add comment"
        callback={submit}
        disabled={!trimmedValue}
        icon={<Plus aria-hidden="true" />}
        theme="primary"
        title="Add comment"
      />
    </form>
  )
}

export const EditableUnifiedDiff = ({
  ariaLabel,
  baselineContents,
  className,
  comments = [],
  contents,
  endLine,
  fileDiff,
  line,
  onChange,
  onAddComment,
  onChangeComment,
  onDeleteComment,
  onSave,
  onToggleWordWrap,
  readOnly = false,
  showOriginalLineNumbers = true,
  wordWrap
}: {
  ariaLabel: string
  baselineContents: string
  className?: string
  comments?: readonly ProviderReviewComment[]
  contents: string
  endLine?: number
  fileDiff: ProviderFileDiff
  line?: number
  onChange: (contents: string) => void
  onAddComment?: (comment: string, location: DiffReviewLocation) => void
  onChangeComment?: (id: string, comment: string) => void
  onDeleteComment?: (id: string) => void
  onSave: () => void
  onToggleWordWrap: () => void
  readOnly?: boolean
  showOriginalLineNumbers?: boolean
  wordWrap: boolean
}): React.JSX.Element => {
  const hostRef = useRef<HTMLDivElement>(null)
  const [reviewInputPosition, setReviewInputPosition] = useState<{
    left: number
    top: number
    location: DiffReviewLocation
  } | null>(null)
  const [reviewLayoutVersion, setReviewLayoutVersion] = useState(0)
  const [reviewMarkers, setReviewMarkers] = useState<ReviewMarker[]>([])
  const [highlightedReviewComments, setHighlightedReviewComments] = useState<
    readonly ProviderReviewComment[]
  >([])
  const reviewDecorationCollectionsRef = useRef<{
    modified: monaco.editor.IEditorDecorationsCollection
    original: monaco.editor.IEditorDecorationsCollection
  } | null>(null)
  const targetDecorationCollectionRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(
    null
  )
  const editorStateRef = useRef<{
    editor: monaco.editor.IStandaloneDiffEditor
    modifiedEditor: monaco.editor.IStandaloneCodeEditor
    originalEditor: monaco.editor.IStandaloneCodeEditor
    originalModel: monaco.editor.ITextModel
    modifiedModel: monaco.editor.ITextModel
  } | null>(null)
  const initialConfigRef = useRef({ baselineContents, contents, fileDiff })
  const onChangeRef = useRef(onChange)
  const onAddCommentRef = useRef(onAddComment)
  const onSaveRef = useRef(onSave)
  const onToggleWordWrapRef = useRef(onToggleWordWrap)
  const showOriginalLineNumbersRef = useRef(showOriginalLineNumbers)
  const reviewGroups = useMemo(() => groupReviewComments(comments), [comments])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const editorState = editorStateRef.current
      const parent = hostRef.current
      if (!editorState || !parent) {
        setReviewMarkers([])
        return
      }

      setReviewMarkers(
        reviewGroups.flatMap((group) => {
          const sourceEditor =
            group.side === 'old' ? editorState.originalEditor : editorState.modifiedEditor
          const model = sourceEditor.getModel()
          if (!model) return []

          const lineNumber = Math.min(group.line, model.getLineCount())
          const top =
            sourceEditor.getTopForLineNumber(lineNumber) -
            sourceEditor.getScrollTop() +
            sourceEditor.getOption(monaco.editor.EditorOption.lineHeight) / 2 -
            reviewMarkerHeight / 2

          return [
            {
              group,
              top
            }
          ]
        })
      )
    })

    return () => window.cancelAnimationFrame(frame)
  }, [reviewGroups, reviewLayoutVersion])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onAddCommentRef.current = onAddComment
  }, [onAddComment])

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    onToggleWordWrapRef.current = onToggleWordWrap
  }, [onToggleWordWrap])

  useEffect(() => {
    showOriginalLineNumbersRef.current = showOriginalLineNumbers
  }, [showOriginalLineNumbers])

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
    const codeFont = getCodeFontAppearance()

    const editor = monaco.editor.createDiffEditor(parent, {
      ariaLabel,
      automaticLayout: true,
      compactMode: !showOriginalLineNumbersRef.current,
      diffAlgorithm: 'advanced',
      diffWordWrap: 'off',
      fontFamily: codeFont.family,
      fontSize: codeFont.size,
      folding: false,
      glyphMargin: false,
      ignoreTrimWhitespace: false,
      lineDecorationsWidth: 8,
      lineNumbers: 'on',
      lineNumbersMinChars: showOriginalLineNumbersRef.current ? 5 : 3,
      minimap: { enabled: false },
      modifiedAriaLabel: ariaLabel,
      originalAriaLabel: `Original ${ariaLabel}`,
      originalEditable: false,
      overviewRulerLanes: 0,
      readOnly,
      renderGutterMenu: false,
      renderMarginRevertIcon: false,
      renderOverviewRuler: true,
      renderSideBySide: false,
      renderValidationDecorations: 'off',
      scrollBeyondLastLine: false,
      scrollbar: { vertical: 'hidden' },
      stickyScroll: { enabled: false },
      theme: getMonacoTheme(),
      wordWrap: 'off'
    })
    editor.setModel({ original: originalModel, modified: modifiedModel })
    const originalEditor = editor.getOriginalEditor()
    const modifiedEditor = editor.getModifiedEditor()
    editorStateRef.current = {
      editor,
      modifiedEditor,
      modifiedModel,
      originalEditor,
      originalModel
    }
    setReviewLayoutVersion((version) => version + 1)
    originalEditor.updateOptions({ ariaLabel: `Original ${ariaLabel}` })
    modifiedEditor.updateOptions({ ariaLabel })
    reviewDecorationCollectionsRef.current = {
      modified: modifiedEditor.createDecorationsCollection(),
      original: originalEditor.createDecorationsCollection()
    }
    targetDecorationCollectionRef.current = modifiedEditor.createDecorationsCollection()

    const changeSubscription = modifiedModel.onDidChangeContent(() => {
      onChangeRef.current(modifiedModel.getValue())
    })
    let reviewSelectionTimer = 0
    let reviewSelectionFrame = 0
    let pointerSelectionEditor: monaco.editor.IStandaloneCodeEditor | null = null
    const cancelScheduledReviewInput = (): void => {
      window.clearTimeout(reviewSelectionTimer)
      window.cancelAnimationFrame(reviewSelectionFrame)
    }
    const showReviewInput = (
      sourceEditor: monaco.editor.IStandaloneCodeEditor,
      selection: monaco.Selection | null
    ): void => {
      if (!onAddCommentRef.current || !selection || selection.isEmpty()) {
        setReviewInputPosition(null)
        return
      }

      const position = sourceEditor.getScrolledVisiblePosition(selection.getPosition())
      if (!position) return
      const startPosition = selection.getStartPosition()
      const endPosition = selection.getEndPosition()

      setReviewInputPosition({
        left: Math.max(6.4, Math.min(position.left, parent.clientWidth - reviewInputWidth - 6.4)),
        top: Math.max(
          6.4,
          Math.min(position.top + position.height + 4.8, parent.clientHeight - 38.4)
        ),
        location: {
          line: startPosition.lineNumber,
          endLine: endPosition.lineNumber,
          side: sourceEditor === originalEditor ? 'old' : 'new'
        }
      })
    }
    const scheduleReviewInput = (
      sourceEditor: monaco.editor.IStandaloneCodeEditor,
      selection: monaco.Selection
    ): void => {
      window.clearTimeout(reviewSelectionTimer)
      if (selection.isEmpty()) {
        setReviewInputPosition(null)
        return
      }
      if (pointerSelectionEditor === sourceEditor) return

      reviewSelectionTimer = window.setTimeout(
        () => showReviewInput(sourceEditor, sourceEditor.getSelection()),
        220
      )
    }
    const originalSelectionSubscription = originalEditor.onDidChangeCursorSelection(
      ({ selection }) => scheduleReviewInput(originalEditor, selection)
    )
    const modifiedSelectionSubscription = modifiedEditor.onDidChangeCursorSelection(
      ({ selection }) => scheduleReviewInput(modifiedEditor, selection)
    )
    const startPointerSelection = (sourceEditor: monaco.editor.IStandaloneCodeEditor): void => {
      cancelScheduledReviewInput()
      pointerSelectionEditor = sourceEditor
      setReviewInputPosition(null)
    }
    const finishPointerSelection = (sourceEditor: monaco.editor.IStandaloneCodeEditor): void => {
      if (pointerSelectionEditor !== sourceEditor) return
      pointerSelectionEditor = null
      cancelScheduledReviewInput()
      reviewSelectionFrame = window.requestAnimationFrame(() =>
        showReviewInput(sourceEditor, sourceEditor.getSelection())
      )
    }
    const originalMouseDownSubscription = originalEditor.onMouseDown(() =>
      startPointerSelection(originalEditor)
    )
    const modifiedMouseDownSubscription = modifiedEditor.onMouseDown(() =>
      startPointerSelection(modifiedEditor)
    )
    const originalMouseUpSubscription = originalEditor.onMouseUp(() =>
      finishPointerSelection(originalEditor)
    )
    const modifiedMouseUpSubscription = modifiedEditor.onMouseUp(() =>
      finishPointerSelection(modifiedEditor)
    )
    const originalScrollSubscription = originalEditor.onDidScrollChange(() =>
      setReviewLayoutVersion((version) => version + 1)
    )
    const modifiedScrollSubscription = modifiedEditor.onDidScrollChange(() =>
      setReviewLayoutVersion((version) => version + 1)
    )
    const layoutSubscription = editor.onDidUpdateDiff(() =>
      setReviewLayoutVersion((version) => version + 1)
    )
    const editorLayoutSubscription = modifiedEditor.onDidLayoutChange(() =>
      setReviewLayoutVersion((version) => version + 1)
    )
    modifiedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
      onSaveRef.current()
    )
    const copyKeybinding = monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC
    const cutKeybinding = monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX
    const pasteKeybinding = monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV
    const copySelection = (sourceEditor: monaco.editor.IStandaloneCodeEditor): void => {
      void copyEditorSelection(sourceEditor).catch((error) => {
        console.error('Unable to copy editor selection.', error)
      })
    }

    originalEditor.addCommand(copyKeybinding, () => copySelection(originalEditor))
    modifiedEditor.addCommand(copyKeybinding, () => copySelection(modifiedEditor))
    if (!readOnly) {
      modifiedEditor.addCommand(cutKeybinding, () => {
        void copyEditorSelection(modifiedEditor)
          .then((copied) => {
            if (copied) modifiedEditor.trigger('keyboard', 'cut', undefined)
          })
          .catch((error) => {
            console.error('Unable to cut editor selection.', error)
          })
      })
      modifiedEditor.addCommand(pasteKeybinding, () => {
        void pasteIntoEditor(modifiedEditor).catch((error) => {
          console.error('Unable to paste into editor.', error)
        })
      })
    }
    const toggleWordWrapKeybinding = monaco.KeyMod.Alt | monaco.KeyCode.KeyZ
    originalEditor.addCommand(toggleWordWrapKeybinding, () => onToggleWordWrapRef.current())
    modifiedEditor.addCommand(toggleWordWrapKeybinding, () => onToggleWordWrapRef.current())

    const themeObserver = new MutationObserver(() => {
      monaco.editor.setTheme(getMonacoTheme())
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-color-scheme']
    })

    const handleFontSettingsChanged = (): void => {
      const font = getCodeFontAppearance()
      originalEditor.updateOptions({ fontFamily: font.family, fontSize: font.size })
      modifiedEditor.updateOptions({ fontFamily: font.family, fontSize: font.size })
    }
    window.addEventListener(appFontSettingsChangedEvent, handleFontSettingsChanged)

    queueMicrotask(() => modifiedEditor.focus())
    return () => {
      cancelScheduledReviewInput()
      editorStateRef.current = null
      reviewDecorationCollectionsRef.current = null
      targetDecorationCollectionRef.current = null
      themeObserver.disconnect()
      window.removeEventListener(appFontSettingsChangedEvent, handleFontSettingsChanged)
      changeSubscription.dispose()
      originalSelectionSubscription.dispose()
      modifiedSelectionSubscription.dispose()
      originalMouseDownSubscription.dispose()
      modifiedMouseDownSubscription.dispose()
      originalMouseUpSubscription.dispose()
      modifiedMouseUpSubscription.dispose()
      originalScrollSubscription.dispose()
      modifiedScrollSubscription.dispose()
      layoutSubscription.dispose()
      editorLayoutSubscription.dispose()
      editor.dispose()
      originalModel.dispose()
      modifiedModel.dispose()
    }
  }, [ariaLabel, readOnly])

  useEffect(() => {
    editorStateRef.current?.editor.updateOptions({
      compactMode: !showOriginalLineNumbers,
      lineNumbersMinChars: showOriginalLineNumbers ? 5 : 3
    })
  }, [showOriginalLineNumbers])

  useEffect(() => {
    const editorState = editorStateRef.current
    const collections = reviewDecorationCollectionsRef.current
    if (!editorState || !collections) return

    const getDecorations = (
      side: ProviderReviewComment['side'],
      model: monaco.editor.ITextModel
    ): monaco.editor.IModelDeltaDecoration[] =>
      highlightedReviewComments
        .filter((comment) => comment.side === side)
        .map((comment) => ({
          startLine: Math.max(1, Math.min(comment.line, model.getLineCount())),
          endLine: Math.max(1, Math.min(getReviewCommentEndLine(comment), model.getLineCount()))
        }))
        .map(({ startLine, endLine }) => ({
          range: new monaco.Range(startLine, 1, endLine, 1),
          options: {
            className: 'editable-unified-diff__review-line-highlight',
            isWholeLine: true
          }
        }))

    collections.original.set(getDecorations('old', editorState.originalModel))
    collections.modified.set(getDecorations('new', editorState.modifiedModel))
    const renderLineHighlight = highlightedReviewComments.length > 0 ? 'none' : 'line'
    editorState.originalEditor.updateOptions({ renderLineHighlight })
    editorState.modifiedEditor.updateOptions({ renderLineHighlight })
  }, [highlightedReviewComments])

  useEffect(() => {
    editorStateRef.current?.editor.updateOptions({
      diffWordWrap: wordWrap ? 'on' : 'off',
      wordWrap: wordWrap ? 'on' : 'off'
    })
  }, [wordWrap])

  useEffect(() => {
    const modifiedEditor = editorStateRef.current?.modifiedEditor
    const decorations = targetDecorationCollectionRef.current
    if (!modifiedEditor || !decorations) return
    if (!line) {
      decorations.clear()
      return
    }

    const lineCount = modifiedEditor.getModel()?.getLineCount() ?? line
    const startLineNumber = Math.max(1, Math.min(line, lineCount))
    const endLineNumber = Math.max(
      startLineNumber,
      Math.min(Math.max(line, endLine ?? line), lineCount)
    )
    const range = new monaco.Range(startLineNumber, 1, endLineNumber, 1)

    decorations.set([
      {
        range,
        options: {
          className: 'editable-unified-diff__target-line-highlight',
          isWholeLine: true
        }
      }
    ])
    modifiedEditor.setPosition({ lineNumber: startLineNumber, column: 1 })
    modifiedEditor.revealRangeInCenter(range, monaco.editor.ScrollType.Immediate)
  }, [endLine, line])

  useEffect(() => {
    const editorState = editorStateRef.current
    if (!editorState) return

    const original = getOriginalContents(fileDiff, baselineContents)
    if (editorState.originalModel.getValue() !== original) {
      editorState.originalModel.setValue(original)
    }
  }, [baselineContents, fileDiff])

  useEffect(() => {
    if (!reviewInputPosition) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('.unified-diff__review-form')) return
      setReviewInputPosition(null)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [reviewInputPosition])

  return (
    <div className={['editable-unified-diff', className].filter(Boolean).join(' ')}>
      <div className="editable-unified-diff__editor" ref={hostRef} />
      <ReviewMarkers
        markers={reviewMarkers}
        onChangeComment={onChangeComment}
        onDeleteComment={onDeleteComment}
        onHighlightComments={(highlightedComments) =>
          setHighlightedReviewComments(highlightedComments ?? [])
        }
      />
      {reviewInputPosition && onAddComment && (
        <ReviewInput
          ariaLabel={`Comment on ${fileDiff.path}`}
          position={reviewInputPosition}
          onCancel={() => {
            setReviewInputPosition(null)
            editorStateRef.current?.modifiedEditor.focus()
          }}
          onSubmit={(comment) => {
            onAddComment(comment, reviewInputPosition.location)
            setReviewInputPosition(null)
          }}
        />
      )}
    </div>
  )
}

export const UnifiedDiff = ({
  className,
  comments = [],
  endLine,
  fileDiff,
  line,
  onAddComment,
  onChangeComment,
  onDeleteComment
}: {
  className?: string
  comments?: readonly ProviderReviewComment[]
  endLine?: number
  fileDiff: ProviderFileDiff
  line?: number
  onAddComment?: (comment: string, location: DiffReviewLocation) => void
  onChangeComment?: (id: string, comment: string) => void
  onDeleteComment?: (id: string) => void
}): React.JSX.Element => {
  const reviewHostRef = useRef<HTMLDivElement>(null)
  const [reviewInputPosition, setReviewInputPosition] = useState<{
    left: number
    top: number
    location: DiffReviewLocation
  } | null>(null)
  const [reviewMarkers, setReviewMarkers] = useState<ReviewMarker[]>([])
  const [highlightedReviewComments, setHighlightedReviewComments] = useState<
    readonly ProviderReviewComment[]
  >([])
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
  const reviewGroups = useMemo(() => groupReviewComments(comments), [comments])
  const changeLocations = useMemo(() => {
    const locations = new Map<string, DiffReviewLocation>()

    files.forEach(({ file }) => {
      file.hunks.forEach((hunk) => {
        hunk.changes.forEach((change) => {
          if (change.type === 'delete') {
            locations.set(getChangeKey(change), {
              line: change.lineNumber,
              endLine: change.lineNumber,
              side: 'old'
            })
          } else if (change.type === 'insert') {
            locations.set(getChangeKey(change), {
              line: change.lineNumber,
              endLine: change.lineNumber,
              side: 'new'
            })
          } else {
            locations.set(getChangeKey(change), {
              line: change.newLineNumber,
              endLine: change.newLineNumber,
              side: 'new'
            })
          }
        })
      })
    })

    return locations
  }, [files])
  const highlightedChangeKeys = useMemo(
    () =>
      files.map(({ file }) => {
        const changeKeys = new Set<string>()

        highlightedReviewComments.forEach((comment) => {
          for (
            let lineNumber = comment.line;
            lineNumber <= getReviewCommentEndLine(comment);
            lineNumber += 1
          ) {
            const change =
              comment.side === 'old'
                ? findChangeByOldLineNumber(file.hunks, lineNumber)
                : findChangeByNewLineNumber(file.hunks, lineNumber)
            if (change) changeKeys.add(getChangeKey(change))
          }
        })

        return [...changeKeys]
      }),
    [files, highlightedReviewComments]
  )
  const targetAnchorId = `unified-diff-target-${useId().replace(/:/g, '')}`
  const lineTarget = useMemo(
    () => getDiffLineTarget(files, fileDiff.kind, line, endLine),
    [endLine, fileDiff.kind, files, line]
  )
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

  useEffect(() => {
    if (!reviewInputPosition) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (
        target instanceof Element &&
        (target.closest('.unified-diff__review-form') ||
          target.closest('.unified-diff__review-overlay'))
      ) {
        return
      }
      setReviewInputPosition(null)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [reviewInputPosition])

  useEffect(() => {
    const host = reviewHostRef.current
    if (!host) return

    let frame = 0
    const updateMarkers = (): void => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const hostRect = host.getBoundingClientRect()
        const changeCells = Array.from(host.querySelectorAll<HTMLElement>('[data-change-key]'))
        const fallback = host.querySelector<HTMLElement>('.unified-diff__fallback')
        const fallbackStyle = fallback ? getComputedStyle(fallback) : null
        const fallbackLineHeight = fallbackStyle
          ? Number.parseFloat(fallbackStyle.lineHeight) || 16.8
          : 16.8
        const fallbackPaddingTop = fallbackStyle
          ? Number.parseFloat(fallbackStyle.paddingTop) || 0
          : 0

        setReviewMarkers(
          reviewGroups.flatMap((group) => {
            let changeKey: string | null = null

            for (const { file } of files) {
              const change =
                group.side === 'old'
                  ? findChangeByOldLineNumber(file.hunks, group.line)
                  : findChangeByNewLineNumber(file.hunks, group.line)
              if (change) {
                changeKey = getChangeKey(change)
                break
              }
            }

            const cell = changeKey
              ? changeCells.find((candidate) => candidate.dataset.changeKey === changeKey)
              : null
            const row = cell?.closest('tr')
            const gutter = row
              ? Array.from(row.querySelectorAll<HTMLElement>('.diff-gutter')).at(-1)
              : null

            if (row && gutter) {
              const rowRect = row.getBoundingClientRect()
              return [
                {
                  group,
                  top: rowRect.top - hostRect.top + rowRect.height / 2 - reviewMarkerHeight / 2
                }
              ]
            }

            if (fallback) {
              const fallbackRect = fallback.getBoundingClientRect()
              return [
                {
                  group,
                  top:
                    fallbackRect.top -
                    hostRect.top +
                    fallbackPaddingTop +
                    (group.line - 1) * fallbackLineHeight
                }
              ]
            }

            return []
          })
        )
      })
    }

    updateMarkers()
    const resizeObserver = new ResizeObserver(updateMarkers)
    resizeObserver.observe(host)
    window.addEventListener('scroll', updateMarkers, true)
    window.addEventListener('resize', updateMarkers)

    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      window.removeEventListener('scroll', updateMarkers, true)
      window.removeEventListener('resize', updateMarkers)
    }
  }, [files, reviewGroups])

  const handleSelection = useCallback((): void => {
    if (!onAddComment) return

    const host = reviewHostRef.current
    const selection = window.getSelection()
    if (!host || !selection || selection.isCollapsed || selection.rangeCount === 0) return

    const anchorElement =
      selection.anchorNode instanceof Element
        ? selection.anchorNode
        : selection.anchorNode?.parentElement
    const focusElement =
      selection.focusNode instanceof Element
        ? selection.focusNode
        : selection.focusNode?.parentElement
    if (
      !anchorElement ||
      !focusElement ||
      !host.contains(anchorElement) ||
      !host.contains(focusElement) ||
      (!anchorElement.closest('.diff-code, .unified-diff__fallback') &&
        !focusElement.closest('.diff-code, .unified-diff__fallback'))
    ) {
      return
    }

    const selectedRange = selection.getRangeAt(0)
    const selectionRect = selectedRange.getBoundingClientRect()
    const hostRect = host.getBoundingClientRect()
    const anchorChangeKey =
      anchorElement.closest<HTMLElement>('[data-change-key]')?.dataset.changeKey
    const focusChangeKey = focusElement.closest<HTMLElement>('[data-change-key]')?.dataset.changeKey
    const anchorLocation = anchorChangeKey ? changeLocations.get(anchorChangeKey) : undefined
    const focusLocation = focusChangeKey ? changeLocations.get(focusChangeKey) : undefined
    const selectedLocations = focusLocation
      ? Array.from(host.querySelectorAll<HTMLElement>('.diff-code[data-change-key]'))
          .filter((cell) => selectedRange.intersectsNode(cell))
          .flatMap((cell) => {
            const changeKey = cell.dataset.changeKey
            const cellLocation = changeKey ? changeLocations.get(changeKey) : undefined
            return cellLocation?.side === focusLocation.side ? [cellLocation] : []
          })
      : []
    let location =
      focusLocation && selectedLocations.length > 0
        ? {
            line: Math.min(...selectedLocations.map((candidate) => candidate.line)),
            endLine: Math.max(...selectedLocations.map((candidate) => candidate.endLine)),
            side: focusLocation.side
          }
        : anchorLocation && focusLocation && anchorLocation.side === focusLocation.side
          ? {
              line: Math.min(anchorLocation.line, focusLocation.line),
              endLine: Math.max(anchorLocation.endLine, focusLocation.endLine),
              side: focusLocation.side
            }
          : focusLocation

    if (!location) {
      const fallback = focusElement.closest<HTMLElement>('.unified-diff__fallback')
      if (
        fallback &&
        selection.anchorNode &&
        selection.focusNode &&
        fallback.contains(selection.anchorNode) &&
        fallback.contains(selection.focusNode)
      ) {
        const getLineNumber = (node: Node, offset: number): number => {
          const rangeToPosition = document.createRange()
          rangeToPosition.selectNodeContents(fallback)
          rangeToPosition.setEnd(node, offset)
          return rangeToPosition.toString().split('\n').length
        }
        const anchorLine = getLineNumber(selection.anchorNode, selection.anchorOffset)
        const focusLine = getLineNumber(selection.focusNode, selection.focusOffset)
        location = {
          line: Math.min(anchorLine, focusLine),
          endLine: Math.max(anchorLine, focusLine),
          side: fileDiff.kind === 'delete' ? 'old' : 'new'
        }
      }
    }
    if (!location) return

    setReviewInputPosition({
      left: Math.max(
        6.4,
        Math.min(selectionRect.left - hostRect.left, hostRect.width - reviewInputWidth - 6.4)
      ),
      top: Math.max(
        6.4,
        Math.min(selectionRect.bottom - hostRect.top + 4.8, hostRect.height - 38.4)
      ),
      location
    })
  }, [changeLocations, fileDiff.kind, onAddComment])

  const renderedDiff =
    files.length === 0 ? (
      <pre className="unified-diff__fallback">{fileDiff.diff}</pre>
    ) : (
      files.map(({ file, tokens }, index) => {
        const targetChangeKeys = lineTarget?.fileIndex === index ? lineTarget.changeKeys : undefined
        const targetAnchorChangeKey =
          lineTarget?.fileIndex === index ? lineTarget.anchorChangeKey : undefined
        const hoveredChangeKeys = highlightedChangeKeys[index] ?? []
        const selectedChanges =
          hoveredChangeKeys.length > 0
            ? hoveredChangeKeys
            : targetChangeKeys
              ? targetChangeKeys
              : []

        return (
          <Diff
            className={diffClassName}
            diffType={file.type}
            generateAnchorID={
              targetAnchorChangeKey
                ? (change) =>
                    getChangeKey(change) === targetAnchorChangeKey ? targetAnchorId : undefined
                : undefined
            }
            hunks={file.hunks}
            key={`${file.oldPath}:${file.newPath}:${index}`}
            selectedChanges={selectedChanges}
            tokens={tokens}
            viewType="unified"
          />
        )
      })
    )

  if (!onAddComment && comments.length === 0) return <>{renderedDiff}</>

  return (
    <div className="unified-diff__review-host" ref={reviewHostRef} onMouseUp={handleSelection}>
      {renderedDiff}
      <ReviewMarkers
        markers={reviewMarkers}
        onChangeComment={onChangeComment}
        onDeleteComment={onDeleteComment}
        onHighlightComments={(highlightedComments) =>
          setHighlightedReviewComments(highlightedComments ?? [])
        }
      />
      {reviewInputPosition && onAddComment && (
        <ReviewInput
          ariaLabel={`Comment on ${fileDiff.path}`}
          position={reviewInputPosition}
          onCancel={() => setReviewInputPosition(null)}
          onSubmit={(comment) => {
            onAddComment(comment, reviewInputPosition.location)
            setReviewInputPosition(null)
            window.getSelection()?.removeAllRanges()
          }}
        />
      )}
    </div>
  )
}
