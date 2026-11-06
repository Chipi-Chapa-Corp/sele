import { useEffect, useRef, useState } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  bracketMatching,
  HighlightStyle,
  LanguageDescription,
  syntaxHighlighting
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { unifiedMergeView } from '@codemirror/merge'
import { tags } from '@lezer/highlight'
import { getOriginalContents } from './diffOriginalContents'
import { groupReviewComments, ReviewMarkers, type ReviewMarker } from './diffReview'
import type { EditableUnifiedDiff } from './EditableUnifiedDiff'
import { Button } from './Button'
import { Textarea } from './Textarea'
import './MobileCodeEditor.css'

type Props = Parameters<typeof EditableUnifiedDiff>[0]
const highlighting = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--editor-comment)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--editor-number)' },
  { tag: tags.string, color: 'var(--editor-string)' },
  { tag: [tags.keyword, tags.modifier], color: 'var(--editor-keyword)' },
  {
    tag: [tags.typeName, tags.className, tags.function(tags.variableName)],
    color: 'var(--editor-type)'
  },
  { tag: [tags.operator, tags.propertyName, tags.attributeName], color: 'var(--editor-operator)' },
  { tag: tags.heading, fontWeight: 'bold', color: 'var(--editor-type)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' }
])

/** Touch/IME editing in the existing file pane, with the desktop syntax palette,
 * line numbers and inline diff. The shared file header owns all controls. */
export function MobileCodeEditor(props: Props): React.ReactElement {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const current = useRef(props)
  current.current = props
  const wrap = useRef(new Compartment())
  const access = useRef(new Compartment())
  const language = useRef(new Compartment())
  const merge = useRef(new Compartment())
  const [commenting, setCommenting] = useState<{ line: number; endLine: number } | null>(null)
  const [markers, setMarkers] = useState<ReviewMarker[]>([])
  const measureFrame = useRef(0)
  const measureComments = useRef<() => void>(() => {})
  measureComments.current = () => {
    cancelAnimationFrame(measureFrame.current)
    measureFrame.current = requestAnimationFrame(() => {
      const editor = view.current
      const root = host.current?.parentElement
      if (!editor || !root) return
      const bounds = root.getBoundingClientRect()
      const next = groupReviewComments(current.current.comments ?? []).flatMap((group) => {
        const line = editor.state.doc.line(Math.min(group.line, editor.state.doc.lines))
        const position = editor.coordsAtPos(line.from)
        if (!position || position.top < bounds.top || position.top > bounds.bottom - 32) return []
        return [{ group, top: position.top - bounds.top }]
      })
      setMarkers((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next
      )
    })
  }
  const [comment, setComment] = useState('')

  // File navigation remounts the editor via its path key. Updates within a file
  // retain history, native selection and composition instead of rebuilding it.
  useEffect(() => {
    if (!host.current) return
    const initial = current.current
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial.contents,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          history(),
          bracketMatching(),
          syntaxHighlighting(highlighting),
          EditorState.tabSize.of(2),
          EditorView.contentAttributes.of({
            'aria-label': initial.ariaLabel,
            spellcheck: 'false',
            autocorrect: 'off',
            autocapitalize: 'off'
          }),
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                current.current.onSave()
                return true
              }
            },
            {
              key: 'Alt-z',
              run: () => {
                current.current.onToggleWordWrap()
                return true
              }
            },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab
          ]),
          wrap.current.of(initial.wordWrap ? EditorView.lineWrapping : []),
          access.current.of(EditorState.readOnly.of(Boolean(initial.readOnly))),
          language.current.of([]),
          merge.current.of([]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) current.current.onChange(update.state.doc.toString())
            measureComments.current()
          })
        ]
      })
    })
    view.current = editor
    const measure = (): void => measureComments.current()
    editor.scrollDOM.addEventListener('scroll', measure)
    const description = LanguageDescription.matchFilename(languages, initial.fileDiff.path)
    if (description)
      void description
        .load()
        .then((support) => {
          if (view.current === editor)
            editor.dispatch({ effects: language.current.reconfigure(support) })
        })
        .catch((error) => console.warn('Unable to load file highlighting.', error))
    return () => {
      cancelAnimationFrame(measureFrame.current)
      editor.scrollDOM.removeEventListener('scroll', measure)
      view.current = null
      editor.destroy()
    }
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: Reposition markers when their comment data changes; the measurement callback reads current props through its ref.
  useEffect(() => {
    measureComments.current()
  }, [props.comments])

  useEffect(() => {
    const editor = view.current
    if (!editor || editor.state.doc.toString() === props.contents) return
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: props.contents } })
  }, [props.contents])
  useEffect(() => {
    view.current?.dispatch({
      effects: [
        wrap.current.reconfigure(props.wordWrap ? EditorView.lineWrapping : []),
        access.current.reconfigure(EditorState.readOnly.of(Boolean(props.readOnly)))
      ]
    })
  }, [props.wordWrap, props.readOnly])
  useEffect(() => {
    view.current?.dispatch({
      effects: merge.current.reconfigure(
        props.showOriginalLineNumbers
          ? unifiedMergeView({
              original: getOriginalContents(props.fileDiff, props.baselineContents),
              mergeControls: false,
              gutter: true,
              highlightChanges: true
            })
          : []
      )
    })
  }, [props.showOriginalLineNumbers, props.fileDiff, props.baselineContents])
  useEffect(() => {
    const editor = view.current
    if (!editor || !props.line) return
    const from = editor.state.doc.line(Math.min(props.line, editor.state.doc.lines)).from
    const to = props.endLine
      ? editor.state.doc.line(Math.min(props.endLine, editor.state.doc.lines)).to
      : from
    editor.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: 'center' })
    })
  }, [props.line, props.endLine])
  useEffect(() => {
    if (!props.onAddComment) return
    props.onCommentSelectionChange?.(() => {
      const editor = view.current
      if (!editor) return
      const { from, to } = editor.state.selection.main
      setComment('')
      setCommenting({
        line: editor.state.doc.lineAt(from).number,
        endLine: editor.state.doc.lineAt(to).number
      })
    })
    return () => props.onCommentSelectionChange?.(null)
  }, [props.onAddComment, props.onCommentSelectionChange])
  return (
    <div className={`mobile-code-editor ${props.className ?? ''}`}>
      <div className="mobile-code-editor__host" data-mobile-editor="" ref={host} />
      <ReviewMarkers
        markers={markers}
        onChangeComment={props.onChangeComment}
        onDeleteComment={props.onDeleteComment}
        onHighlightComments={() => {}}
      />
      {commenting && (
        <form
          className="mobile-code-editor__comment"
          role="dialog"
          aria-label="Add review comment"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            setCommenting(null)
          }}
          onSubmit={(event) => {
            event.preventDefault()
            if (!comment.trim()) return
            props.onAddComment?.(comment.trim(), { ...commenting, side: 'new' })
            setCommenting(null)
          }}
        >
          <label htmlFor="mobile-file-comment">Comment on line {commenting.line}</label>
          <Textarea
            id="mobile-file-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            autoFocus
            required
          />
          <div>
            <Button label="Cancel" theme="secondary" callback={() => setCommenting(null)} />
            <Button
              label="Add comment"
              theme="primary"
              disabled={!comment.trim()}
              callback={() => {
                if (!comment.trim()) return
                props.onAddComment?.(comment.trim(), { ...commenting, side: 'new' })
                setCommenting(null)
              }}
            />
          </div>
        </form>
      )}
    </div>
  )
}
