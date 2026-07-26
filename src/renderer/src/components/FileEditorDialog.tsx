import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FileCode2,
  FileDiff,
  LoaderCircle,
  Maximize2,
  Minimize2,
  RefreshCw,
  Save,
  X
} from 'lucide-react'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import type { AppGitChangeKind } from '../../../shared/app'
import type { ProviderFileDiff } from '../../../shared/provider'
import { appApi } from '../appApi'
import { Button } from './Button'
import { EditableUnifiedDiff, UnifiedDiff } from './UnifiedDiff'
import './FileEditorDialog.css'

export type FileEditorTarget = {
  cwd: string
  path: string
  displayPath: string
  kind?: AppGitChangeKind | null
  previousPath?: string | null
}

type FileEditorDialogProps = {
  target: FileEditorTarget
  onClose: () => void
}

type LoadState = 'loading' | 'ready' | 'error'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type LoadDiffOptions = {
  background?: boolean
}

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error)) return fallback

  const message = error.message.replace(/^Error invoking remote method '[^']+': Error: /, '').trim()
  return message || fallback
}

const getDiffKind = (kind: AppGitChangeKind): ProviderFileDiff['kind'] => {
  if (kind === 'delete') return 'delete'
  if (kind === 'create' || kind === 'untracked') return 'create'
  return 'edit'
}

export const FileEditorDialog = memo(function FileEditorDialog({
  target,
  onClose
}: FileEditorDialogProps): React.JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [contents, setContents] = useState('')
  const [savedContents, setSavedContents] = useState('')
  const [version, setVersion] = useState<string | null>(null)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [diffLoadState, setDiffLoadState] = useState<LoadState>(target.kind ? 'loading' : 'ready')
  const [diffError, setDiffError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const loadRequestRef = useRef(0)
  const diffLoadRequestRef = useRef(0)
  const canShowDiff = Boolean(target.kind)
  const canEdit = target.kind !== 'delete'
  const displayPath = useMemo(() => target.displayPath.replace(/\\/g, '/'), [target.displayPath])
  const displayPathParts = useMemo(() => displayPath.split('/').filter(Boolean), [displayPath])
  const fileName = displayPathParts.at(-1) ?? displayPath
  const directoryName = displayPathParts.slice(0, -1).join('/') || '.'
  const dirty = loadState === 'ready' && contents !== savedContents
  const renderedFileDiff = useMemo<ProviderFileDiff | null>(
    () =>
      target.kind
        ? {
            path: target.path,
            kind: getDiffKind(target.kind),
            diff
          }
        : null,
    [diff, target.kind, target.path]
  )
  const editableFileDiff = useMemo<ProviderFileDiff>(
    () =>
      renderedFileDiff ?? {
        path: target.path,
        kind: 'edit',
        diff: ''
      },
    [renderedFileDiff, target.path]
  )

  const loadFile = useCallback(async (): Promise<void> => {
    const request = loadRequestRef.current + 1
    loadRequestRef.current = request
    setLoadState('loading')
    setSaveState('idle')
    setEditorError(null)

    try {
      const result = await appApi.getFileContents({
        cwd: target.cwd,
        path: target.path
      })
      if (loadRequestRef.current !== request) return

      setContents(result.contents)
      setSavedContents(result.contents)
      setVersion(result.version)
      setLoadState('ready')
    } catch (loadError) {
      if (loadRequestRef.current !== request) return

      setEditorError(getErrorMessage(loadError, 'Unable to open this file.'))
      setVersion(null)
      setLoadState('error')
    }
  }, [target.cwd, target.path])

  const loadDiff = useCallback(
    async (options: LoadDiffOptions = {}): Promise<void> => {
      if (!target.kind) return

      const background = options.background === true
      const request = diffLoadRequestRef.current + 1
      diffLoadRequestRef.current = request
      if (!background) setDiffLoadState('loading')
      setDiffError(null)

      try {
        const result = await appApi.getGitFileDiff({
          cwd: target.cwd,
          path: target.path,
          previousPath: target.previousPath
        })
        if (diffLoadRequestRef.current !== request) return

        setDiff(result.diff)
        setDiffLoadState('ready')
      } catch (loadError) {
        if (diffLoadRequestRef.current !== request) return

        const message = getErrorMessage(loadError, 'Unable to load this diff.')
        setDiffError(message)
        if (background) {
          setEditorError(message)
        } else {
          setDiffLoadState('error')
        }
      }
    },
    [target.cwd, target.kind, target.path, target.previousPath]
  )

  useEffect(() => {
    if (!canEdit) return
    queueMicrotask(() => void loadFile())
  }, [canEdit, loadFile])

  useEffect(() => {
    if (!canShowDiff) return
    queueMicrotask(() => void loadDiff())
  }, [canShowDiff, loadDiff])

  const requestClose = useCallback((): void => {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return
    onClose()
  }, [dirty, onClose])

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return

      event.preventDefault()
      requestClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [requestClose])

  const handleSave = useCallback(async (): Promise<void> => {
    if (loadState !== 'ready' || saveState === 'saving' || !version || !dirty) return

    const contentsToSave = contents
    setSaveState('saving')
    setEditorError(null)

    try {
      const result = await appApi.writeFileContents({
        cwd: target.cwd,
        path: target.path,
        contents: contentsToSave,
        expectedVersion: version
      })

      setSavedContents(contentsToSave)
      setVersion(result.version)
      setSaveState('saved')
      if (canShowDiff) void loadDiff({ background: true })
    } catch (saveError) {
      setEditorError(getErrorMessage(saveError, 'Unable to save this file.'))
      setSaveState('error')
    }
  }, [
    canShowDiff,
    contents,
    dirty,
    loadDiff,
    loadState,
    saveState,
    target.cwd,
    target.path,
    version
  ])

  return (
    <div
      className={`file-editor-overlay${expanded ? ' file-editor-overlay--expanded' : ''}`}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) requestClose()
      }}
    >
      <section
        className={`file-editor-dialog${expanded ? ' file-editor-dialog--expanded' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${canEdit ? 'Edit' : 'View changes to'} ${displayPath}`}
      >
        <header className="file-editor-dialog__header">
          <span className="file-editor-dialog__file-icon" aria-hidden="true">
            <SymbolsFileIcon fileName={fileName} autoAssign />
          </span>
          <div className="file-editor-dialog__title">
            <strong title={fileName}>{fileName}</strong>
            <span title={directoryName}>{directoryName}</span>
          </div>
          <div className="file-editor-dialog__actions">
            {canEdit && (
              <Button
                aria-label={`Save ${displayPath}`}
                callback={handleSave}
                disabled={!dirty || saveState === 'saving'}
                icon={
                  saveState === 'saving' ? (
                    <LoaderCircle className="file-editor-dialog__spinner" />
                  ) : (
                    <Save />
                  )
                }
                label={saveState === 'saving' ? 'Saving' : 'Save'}
                size="small"
                theme="primary"
                title="Save (Ctrl/Cmd+S)"
              />
            )}
            <button
              className="file-editor-dialog__control"
              type="button"
              aria-label={expanded ? 'Collapse file editor' : 'Expand file editor'}
              title={expanded ? 'Collapse' : 'Expand'}
              onClick={() => setExpanded((currentExpanded) => !currentExpanded)}
            >
              {expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            </button>
            <button
              className="file-editor-dialog__control file-editor-dialog__control--close"
              type="button"
              aria-label="Close file editor"
              title="Close"
              onClick={requestClose}
            >
              <X aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="file-editor-dialog__body">
          {canShowDiff && !canEdit && (
            <div className="file-editor-dialog__diff-view">
              {diffLoadState === 'loading' && (
                <div className="file-editor-dialog__state" role="status">
                  <LoaderCircle className="file-editor-dialog__spinner" aria-hidden="true" />
                  <span>Loading diff…</span>
                </div>
              )}
              {diffLoadState === 'error' && (
                <div className="file-editor-dialog__state" role="alert">
                  <FileDiff aria-hidden="true" />
                  <p>{diffError}</p>
                  <Button
                    callback={loadDiff}
                    icon={<RefreshCw />}
                    label="Try again"
                    size="small"
                    theme="secondary"
                  />
                </div>
              )}
              {diffLoadState === 'ready' &&
                (diff && renderedFileDiff ? (
                  <div className="file-editor-dialog__diff-scroll">
                    <UnifiedDiff className="file-editor-dialog__diff" fileDiff={renderedFileDiff} />
                  </div>
                ) : (
                  <div className="file-editor-dialog__state">
                    <FileDiff aria-hidden="true" />
                    <p>No changes to display.</p>
                  </div>
                ))}
            </div>
          )}

          {canEdit && (loadState === 'loading' || (canShowDiff && diffLoadState === 'loading')) && (
            <div className="file-editor-dialog__state" role="status">
              <LoaderCircle className="file-editor-dialog__spinner" aria-hidden="true" />
              <span>{canShowDiff ? 'Opening editable diff…' : 'Opening file…'}</span>
            </div>
          )}

          {canEdit && (loadState === 'error' || (canShowDiff && diffLoadState === 'error')) && (
            <div className="file-editor-dialog__state" role="alert">
              {canShowDiff ? <FileDiff aria-hidden="true" /> : <FileCode2 aria-hidden="true" />}
              <p>{editorError ?? diffError}</p>
              <Button
                callback={() => {
                  void loadFile()
                  if (canShowDiff) void loadDiff()
                }}
                icon={<RefreshCw />}
                label="Try again"
                size="small"
                theme="secondary"
              />
            </div>
          )}

          {canEdit && loadState === 'ready' && (!canShowDiff || diffLoadState === 'ready') && (
            <div className="file-editor-dialog__inline-diff">
              {editorError && (
                <div className="file-editor-dialog__error" role="alert">
                  {editorError}
                </div>
              )}
              <EditableUnifiedDiff
                key={target.path}
                ariaLabel={`Contents of ${target.displayPath}`}
                baselineContents={savedContents}
                className="file-editor-dialog__diff"
                contents={contents}
                fileDiff={editableFileDiff}
                onChange={(nextContents) => {
                  setContents(nextContents)
                  setSaveState('idle')
                  setEditorError(null)
                }}
                onSave={() => void handleSave()}
              />
            </div>
          )}
        </div>
      </section>
    </div>
  )
})
