import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProviderFileDiff, ProviderReviewComment } from '../../../shared/provider'
import * as monaco from 'monaco-editor'
import { getCodeFontAppearance, appFontSettingsChangedEvent } from '../fontAppearance'
import {
  getMonacoLanguage,
  getMonacoTheme,
  copyEditorSelection,
  pasteIntoEditor
} from './monacoDiffEditor'
import { getOriginalContents } from './diffOriginalContents'
import {
  noReviewComments,
  reuseReviewMarkers,
  groupReviewComments,
  getReviewCommentEndLine,
  reviewMarkerHeight,
  reviewInputWidth,
  ReviewMarkers,
  ReviewInput,
  type ReviewMarker,
  type DiffReviewLocation
} from './diffReview'
import './UnifiedDiff.css'

let editableDiffInstanceId = 0

export const EditableUnifiedDiff = ({
  ariaLabel,
  baselineContents,
  className,
  comments = noReviewComments,
  contents,
  endLine,
  fileDiff,
  line,
  onChange,
  onAddComment,
  onChangeComment,
  onDeleteComment,
  onCommentSelectionChange,
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
  onCommentSelectionChange?: (openComment: (() => void) | null) => void
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
    width?: number
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
  const onCommentSelectionChangeRef = useRef(onCommentSelectionChange)
  const onSaveRef = useRef(onSave)
  const onToggleWordWrapRef = useRef(onToggleWordWrap)
  const showOriginalLineNumbersRef = useRef(showOriginalLineNumbers)
  const reviewGroups = useMemo(() => groupReviewComments(comments), [comments])

  useEffect(() => {
    if (!reviewGroups.length) {
      setReviewMarkers((current) => (current.length ? [] : current))
      return
    }
    const frame = window.requestAnimationFrame(() => {
      const editorState = editorStateRef.current
      const parent = hostRef.current
      if (!editorState || !parent) {
        setReviewMarkers((current) => (current.length ? [] : current))
        return
      }

      const nextMarkers = reviewGroups.flatMap((group) => {
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
      setReviewMarkers((current) => reuseReviewMarkers(current, nextMarkers))
    })

    return () => window.cancelAnimationFrame(frame)
  }, [reviewGroups, reviewLayoutVersion])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onAddCommentRef.current = onAddComment
    onCommentSelectionChangeRef.current = onCommentSelectionChange
  }, [onAddComment, onCommentSelectionChange])

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
    const trackSelection = (sourceEditor: monaco.editor.IStandaloneCodeEditor): void => {
      const selection = sourceEditor.getSelection()
      onCommentSelectionChangeRef.current?.(
        onAddCommentRef.current && selection && !selection.isEmpty()
          ? () => showReviewInput(sourceEditor, selection)
          : null
      )
    }
    const originalSelectionSubscription = originalEditor.onDidChangeCursorSelection(() =>
      trackSelection(originalEditor)
    )
    const modifiedSelectionSubscription = modifiedEditor.onDidChangeCursorSelection(() =>
      trackSelection(modifiedEditor)
    )
    const originalFocusSubscription = originalEditor.onDidFocusEditorText(() =>
      trackSelection(originalEditor)
    )
    const modifiedFocusSubscription = modifiedEditor.onDidFocusEditorText(() =>
      trackSelection(modifiedEditor)
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
      onCommentSelectionChangeRef.current?.(null)
      editorStateRef.current = null
      reviewDecorationCollectionsRef.current = null
      targetDecorationCollectionRef.current = null
      themeObserver.disconnect()
      window.removeEventListener(appFontSettingsChangedEvent, handleFontSettingsChanged)
      changeSubscription.dispose()
      originalSelectionSubscription.dispose()
      modifiedSelectionSubscription.dispose()
      originalFocusSubscription.dispose()
      modifiedFocusSubscription.dispose()
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
