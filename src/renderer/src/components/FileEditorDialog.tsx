import { createElement, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { RootContent } from 'hast'
import { FileCode2, LoaderCircle, Maximize2, Minimize2, RefreshCw, Save, X } from 'lucide-react'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import { refractor } from 'refractor'
import jsx from 'refractor/jsx'
import tsx from 'refractor/tsx'
import { appApi } from '../appApi'
import { Button } from './Button'
import './FileEditorDialog.css'

if (!refractor.registered('jsx')) refractor.register(jsx)
if (!refractor.registered('tsx')) refractor.register(tsx)

export type FileEditorTarget = {
  cwd: string
  path: string
  displayPath: string
}

type FileEditorDialogProps = {
  target: FileEditorTarget
  onClose: () => void
}

type LoadState = 'loading' | 'ready' | 'error'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

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
  vb: 'vbnet',
  xml: 'markup',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash'
}

const languageByFileName: Record<string, string> = {
  '.bashrc': 'bash',
  '.zshrc': 'bash',
  dockerfile: 'docker',
  makefile: 'makefile'
}

const getLanguage = (path: string): string | null => {
  const fileName = path.split(/[\\/]/).at(-1)?.toLocaleLowerCase() ?? ''
  const extension = fileName.includes('.') ? (fileName.split('.').at(-1) ?? '') : ''
  const language = languageByFileName[fileName] ?? languageByExtension[extension]

  return language && refractor.registered(language) ? language : null
}

const renderNode = (node: RootContent, key: number): ReactNode => {
  if (node.type === 'text') return node.value
  if (node.type !== 'element') return null

  const classNames = node.properties.className
  const className = Array.isArray(classNames)
    ? classNames.filter((value): value is string => typeof value === 'string').join(' ')
    : typeof classNames === 'string'
      ? classNames
      : undefined

  return createElement(
    node.tagName,
    { className, key },
    node.children.map((child, index) => renderNode(child, index))
  )
}

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error)) return fallback

  const message = error.message.replace(/^Error invoking remote method '[^']+': Error: /, '').trim()
  return message || fallback
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
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const loadRequestRef = useRef(0)
  const language = useMemo(() => getLanguage(target.path), [target.path])
  const displayPath = useMemo(() => target.displayPath.replace(/\\/g, '/'), [target.displayPath])
  const displayPathParts = useMemo(() => displayPath.split('/').filter(Boolean), [displayPath])
  const fileName = displayPathParts.at(-1) ?? displayPath
  const directoryName = displayPathParts.slice(0, -1).join('/') || '.'
  const dirty = loadState === 'ready' && contents !== savedContents

  const highlightedContents = useMemo(() => {
    if (!language) return contents

    try {
      return refractor.highlight(contents, language).children.map(renderNode)
    } catch {
      return contents
    }
  }, [contents, language])

  const loadFile = useCallback(async (): Promise<void> => {
    const request = loadRequestRef.current + 1
    loadRequestRef.current = request
    setLoadState('loading')
    setSaveState('idle')
    setError(null)

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

      setError(getErrorMessage(loadError, 'Unable to open this file.'))
      setVersion(null)
      setLoadState('error')
    }
  }, [target.cwd, target.path])

  useEffect(() => {
    queueMicrotask(() => void loadFile())
  }, [loadFile])

  useEffect(() => {
    if (loadState !== 'ready') return
    queueMicrotask(() => textareaRef.current?.focus({ preventScroll: true }))
  }, [loadState])

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
    setError(null)

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
    } catch (saveError) {
      setError(getErrorMessage(saveError, 'Unable to save this file.'))
      setSaveState('error')
    }
  }, [contents, dirty, loadState, saveState, target.cwd, target.path, version])

  const syncHighlightScroll = (): void => {
    const textarea = textareaRef.current
    const highlight = highlightRef.current
    if (!textarea || !highlight) return

    highlight.scrollTop = textarea.scrollTop
    highlight.scrollLeft = textarea.scrollLeft
  }

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 's') {
      event.preventDefault()
      void handleSave()
      return
    }

    if (event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey) return

    event.preventDefault()
    const textarea = event.currentTarget
    const selectionStart = textarea.selectionStart
    const selectionEnd = textarea.selectionEnd
    const nextContents = `${contents.slice(0, selectionStart)}  ${contents.slice(selectionEnd)}`

    setContents(nextContents)
    setSaveState('idle')
    queueMicrotask(() => {
      textarea.setSelectionRange(selectionStart + 2, selectionStart + 2)
    })
  }

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
        aria-label={`Edit ${displayPath}`}
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
          {loadState === 'loading' && (
            <div className="file-editor-dialog__state" role="status">
              <LoaderCircle className="file-editor-dialog__spinner" aria-hidden="true" />
              <span>Opening file…</span>
            </div>
          )}

          {loadState === 'error' && (
            <div className="file-editor-dialog__state" role="alert">
              <FileCode2 aria-hidden="true" />
              <p>{error}</p>
              <Button
                callback={loadFile}
                icon={<RefreshCw />}
                label="Try again"
                size="small"
                theme="secondary"
              />
            </div>
          )}

          {loadState === 'ready' && (
            <div className="file-editor-dialog__editor">
              {error && (
                <div className="file-editor-dialog__error" role="alert">
                  {error}
                </div>
              )}
              <pre ref={highlightRef} className="file-editor-dialog__highlight" aria-hidden="true">
                <code className={language ? `language-${language}` : undefined}>
                  {highlightedContents}
                  {'\n'}
                </code>
              </pre>
              <textarea
                ref={textareaRef}
                className="file-editor-dialog__input"
                aria-label={`Contents of ${target.displayPath}`}
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(event) => {
                  setContents(event.currentTarget.value)
                  setSaveState('idle')
                  setError(null)
                }}
                onKeyDown={handleEditorKeyDown}
                onScroll={syncHighlightScroll}
                spellCheck={false}
                value={contents}
                wrap="off"
              />
            </div>
          )}
        </div>
      </section>
    </div>
  )
})
