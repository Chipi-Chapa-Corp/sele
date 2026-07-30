import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Columns2,
  Copy,
  Eye,
  FileCode2,
  FileDiff,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Save,
  WrapText,
  X
} from 'lucide-react'
import {
  FileIcon as SymbolsFileIcon,
  FolderIcon as SymbolsFolderIcon
} from '@react-symbols/icons/utils'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import type { AppGitChangeKind } from '../../../shared/app'
import type { ProviderFileDiff, ProviderReviewComment } from '../../../shared/provider'
import { appApi } from '../appApi'
import { Button } from './Button'
import { SegmentedControl, type SegmentedControlOption } from './SegmentedControl'
import { EditableUnifiedDiff, UnifiedDiff, type DiffReviewLocation } from './UnifiedDiff'
import './FileEditorDialog.css'

export type FileEditorTarget = {
  cwd: string
  path: string
  displayPath: string
  line?: number
  endLine?: number
  kind?: AppGitChangeKind | null
  previousPath?: string | null
}

type FileEditorDialogProps = {
  target: FileEditorTarget
  diffTargets?: readonly FileEditorTarget[]
  initialReviewComments?: readonly ProviderReviewComment[]
  onClose: () => void
  onContinueReview?: (comments: ProviderReviewComment[]) => void
  onReviewCommentsChange?: (comments: ProviderReviewComment[]) => void
  onSelectTarget?: (target: FileEditorTarget) => void
}

type LoadState = 'loading' | 'ready' | 'error'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type CopyState = 'idle' | 'copying' | 'copied' | 'error'
type MarkdownViewMode = 'code' | 'split' | 'preview'
type FileViewMode = 'diff' | 'contents'
type LoadDiffOptions = {
  background?: boolean
}
type DiffTreeFileNode = {
  type: 'file'
  name: string
  target: FileEditorTarget
}
type DiffTreeFolderNode = {
  type: 'folder'
  name: string
  path: string
  children: DiffTreeNode[]
}
type DiffTreeNode = DiffTreeFileNode | DiffTreeFolderNode
type MutableDiffTreeFolder = {
  name: string
  path: string
  folders: Map<string, MutableDiffTreeFolder>
  files: DiffTreeFileNode[]
}

const imageFilePattern = /\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i
const markdownFilePattern = /\.(?:markdown|mdown|mkdn|mkd|md)$/i
const markdownViewOptions: readonly SegmentedControlOption<MarkdownViewMode>[] = [
  {
    value: 'code',
    label: null,
    ariaLabel: 'Code',
    icon: <Code2 />,
    title: 'Code'
  },
  {
    value: 'split',
    label: null,
    ariaLabel: 'Split',
    icon: <Columns2 />,
    title: 'Split'
  },
  {
    value: 'preview',
    label: null,
    ariaLabel: 'Preview',
    icon: <Eye />,
    title: 'Preview'
  }
]
const fileViewOptions: readonly SegmentedControlOption<FileViewMode>[] = [
  {
    value: 'diff',
    label: null,
    ariaLabel: 'Diff',
    icon: <FileDiff />,
    title: 'Diff'
  },
  {
    value: 'contents',
    label: null,
    ariaLabel: 'Regular contents',
    icon: <FileText />,
    title: 'Regular contents'
  }
]
const markdownSplitPercentageStorageKey = 'sele:markdown-split-percentage:v1'
const markdownSplitDefaultPercentage = 50
const markdownSplitMinPercentage = 20
const markdownSplitMaxPercentage = 80
const markdownSplitStackedMedia = '(max-width: 760px)'
const diffTreeWidthStorageKey = 'sele:file-diff-tree-width:v1'
const diffTreeDefaultWidth = 240
const diffTreeMinWidth = 180
const diffTreeMaxWidth = 480
const diffContentMinWidth = 480

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum)

const readStoredMarkdownSplitPercentage = (): number => {
  try {
    const storedValue = window.localStorage.getItem(markdownSplitPercentageStorageKey)
    if (storedValue === null) return markdownSplitDefaultPercentage

    const storedPercentage = Number(storedValue)
    return Number.isFinite(storedPercentage)
      ? clamp(storedPercentage, markdownSplitMinPercentage, markdownSplitMaxPercentage)
      : markdownSplitDefaultPercentage
  } catch {
    return markdownSplitDefaultPercentage
  }
}

const getDiffTreeMaxWidth = (bodyWidth: number): number =>
  Math.max(diffTreeMinWidth, Math.min(diffTreeMaxWidth, bodyWidth - diffContentMinWidth))

const readStoredDiffTreeWidth = (): number => {
  try {
    const storedWidth = Number(window.localStorage.getItem(diffTreeWidthStorageKey))
    return Number.isFinite(storedWidth)
      ? clamp(storedWidth, diffTreeMinWidth, diffTreeMaxWidth)
      : diffTreeDefaultWidth
  } catch {
    return diffTreeDefaultWidth
  }
}

const createMutableDiffTreeFolder = (name: string, path: string): MutableDiffTreeFolder => ({
  name,
  path,
  folders: new Map(),
  files: []
})

const finalizeDiffTreeFolder = (folder: MutableDiffTreeFolder): DiffTreeNode[] => {
  const folders = Array.from(folder.folders.values())
    .sort((firstFolder, secondFolder) => firstFolder.name.localeCompare(secondFolder.name))
    .map<DiffTreeFolderNode>((childFolder) => ({
      type: 'folder',
      name: childFolder.name,
      path: childFolder.path,
      children: finalizeDiffTreeFolder(childFolder)
    }))
  const files = [...folder.files].sort((firstFile, secondFile) =>
    firstFile.name.localeCompare(secondFile.name)
  )

  return [...folders, ...files]
}

const buildDiffTree = (targets: readonly FileEditorTarget[]): DiffTreeNode[] => {
  const root = createMutableDiffTreeFolder('', '')

  for (const target of targets) {
    const displayPath = target.displayPath.replace(/\\/g, '/')
    const pathParts = displayPath.split('/').filter(Boolean)
    const fileName = pathParts.pop() ?? displayPath
    let folder = root
    let folderPath = ''

    for (const folderName of pathParts) {
      folderPath = folderPath ? `${folderPath}/${folderName}` : folderName
      let childFolder = folder.folders.get(folderName)

      if (!childFolder) {
        childFolder = createMutableDiffTreeFolder(folderName, folderPath)
        folder.folders.set(folderName, childFolder)
      }

      folder = childFolder
    }

    folder.files.push({
      type: 'file',
      name: fileName,
      target
    })
  }

  return finalizeDiffTreeFolder(root)
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
  diffTargets = [],
  initialReviewComments = [],
  onClose,
  onContinueReview,
  onReviewCommentsChange,
  onSelectTarget
}: FileEditorDialogProps): React.JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadStatePath, setLoadStatePath] = useState(target.path)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const [contents, setContents] = useState('')
  const [savedContents, setSavedContents] = useState('')
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [editable, setEditable] = useState<boolean | null>(null)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [diffLoadState, setDiffLoadState] = useState<LoadState>(target.kind ? 'loading' : 'ready')
  const [diffLoadStatePath, setDiffLoadStatePath] = useState(target.path)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [diffTreeCollapsed, setDiffTreeCollapsed] = useState(false)
  const [fileView, setFileView] = useState<FileViewMode>('diff')
  const [wordWrap, setWordWrap] = useState(false)
  const [markdownView, setMarkdownView] = useState<MarkdownViewMode>('code')
  const [markdownSplitPercentage, setMarkdownSplitPercentage] = useState(
    readStoredMarkdownSplitPercentage
  )
  const [markdownSplitStacked, setMarkdownSplitStacked] = useState(
    () => window.matchMedia(markdownSplitStackedMedia).matches
  )
  const [collapsedDiffFolders, setCollapsedDiffFolders] = useState<Record<string, boolean>>({})
  const [diffTreeWidth, setDiffTreeWidth] = useState(readStoredDiffTreeWidth)
  const [reviewComments, setReviewComments] = useState<ProviderReviewComment[]>(() => [
    ...initialReviewComments
  ])
  const bodyRef = useRef<HTMLDivElement>(null)
  const markdownSplitRef = useRef<HTMLDivElement>(null)
  const loadRequestRef = useRef(0)
  const diffLoadRequestRef = useRef(0)
  const copyFeedbackTimerRef = useRef<number | null>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const isImage = imageFilePattern.test(target.path)
  const isMarkdown = markdownFilePattern.test(target.path)
  const canShowImage = isImage && target.kind !== 'delete'
  const canShowContents = !isImage && target.kind !== 'delete'
  const canOpenFile = canShowContents || canShowImage
  const visibleLoadState = loadStatePath === target.path ? loadState : 'loading'
  const visibleDiffLoadState =
    diffLoadStatePath === target.path ? diffLoadState : target.kind ? 'loading' : 'ready'
  const canEdit = canShowContents && visibleLoadState === 'ready' && editable === true
  const canShowDiff = Boolean(target.kind && !canShowImage && (target.kind === 'delete' || canEdit))
  const showFileDiff = canShowDiff && fileView === 'diff'
  const isFileDiff = Boolean(target.kind)
  const hasDiffTree = isFileDiff && diffTargets.length > 0 && Boolean(onSelectTarget)
  const showDiffTree = hasDiffTree && !diffTreeCollapsed
  const displayPath = useMemo(() => target.displayPath.replace(/\\/g, '/'), [target.displayPath])
  const displayPathParts = useMemo(() => displayPath.split('/').filter(Boolean), [displayPath])
  const fileName = displayPathParts.at(-1) ?? displayPath
  const directoryName = displayPathParts.slice(0, -1).join('/') || '.'
  const dirty = visibleLoadState === 'ready' && contents !== savedContents
  const diffTree = useMemo(() => buildDiffTree(diffTargets), [diffTargets])
  const reviewCommentCountByPath = useMemo(
    () =>
      reviewComments.reduce<Map<string, number>>((counts, comment) => {
        counts.set(comment.path, (counts.get(comment.path) ?? 0) + 1)
        return counts
      }, new Map()),
    [reviewComments]
  )
  const currentReviewComments = useMemo(
    () => reviewComments.filter((comment) => comment.path === displayPath),
    [displayPath, reviewComments]
  )
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
  const regularFileContents = useMemo<ProviderFileDiff>(
    () => ({
      path: target.path,
      kind: 'edit',
      diff: ''
    }),
    [target.path]
  )
  const displayedFileDiff = showFileDiff ? editableFileDiff : regularFileContents
  const renderedMarkdown = useMemo(
    () =>
      isMarkdown
        ? DOMPurify.sanitize(
            marked.parse(contents, {
              async: false,
              gfm: true
            })
          )
        : '',
    [contents, isMarkdown]
  )

  const loadFile = useCallback(async (): Promise<void> => {
    const request = loadRequestRef.current + 1
    loadRequestRef.current = request
    setLoadStatePath(target.path)
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
      setEditable(result.editable)
      setLoadState('ready')
    } catch (loadError) {
      if (loadRequestRef.current !== request) return

      setEditorError(getErrorMessage(loadError, 'Unable to open this file.'))
      setVersion(null)
      setEditable(null)
      setLoadState('error')
    }
  }, [target.cwd, target.path])

  const loadImage = useCallback(async (): Promise<void> => {
    const request = loadRequestRef.current + 1
    loadRequestRef.current = request
    setLoadStatePath(target.path)
    setLoadState('loading')
    setEditorError(null)
    setImageDataUrl(null)

    try {
      const result = await appApi.getLocalImage({
        cwd: target.cwd,
        path: target.path
      })
      if (loadRequestRef.current !== request) return

      setImageDataUrl(result.dataUrl)
      setEditable(false)
      setLoadState('ready')
    } catch (loadError) {
      if (loadRequestRef.current !== request) return

      setEditorError(getErrorMessage(loadError, 'Unable to open this image.'))
      setEditable(null)
      setLoadState('error')
    }
  }, [target.cwd, target.path])

  const loadDiff = useCallback(
    async (options: LoadDiffOptions = {}): Promise<void> => {
      if (!target.kind) return

      const background = options.background === true
      const request = diffLoadRequestRef.current + 1
      diffLoadRequestRef.current = request
      setDiffLoadStatePath(target.path)
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
    if (!canShowContents) return
    queueMicrotask(() => void loadFile())
  }, [canShowContents, loadFile])

  useEffect(() => {
    if (!canShowImage) return
    queueMicrotask(() => void loadImage())
  }, [canShowImage, loadImage])

  useEffect(() => {
    if (!canShowDiff) return
    queueMicrotask(() => void loadDiff())
  }, [canShowDiff, loadDiff])

  useEffect(
    () => () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
      resizeCleanupRef.current?.()
    },
    []
  )

  useEffect(() => {
    try {
      window.localStorage.setItem(diffTreeWidthStorageKey, String(diffTreeWidth))
    } catch {
      // The sidebar remains resizable when persistent storage is unavailable.
    }
  }, [diffTreeWidth])

  useEffect(() => {
    try {
      window.localStorage.setItem(
        markdownSplitPercentageStorageKey,
        String(markdownSplitPercentage)
      )
    } catch {
      // The Markdown split remains resizable when persistent storage is unavailable.
    }
  }, [markdownSplitPercentage])

  useEffect(() => {
    const mediaQuery = window.matchMedia(markdownSplitStackedMedia)
    const updateLayout = (): void => setMarkdownSplitStacked(mediaQuery.matches)

    updateLayout()
    mediaQuery.addEventListener('change', updateLayout)
    return () => mediaQuery.removeEventListener('change', updateLayout)
  }, [])

  useEffect(() => {
    onReviewCommentsChange?.(reviewComments)
  }, [onReviewCommentsChange, reviewComments])

  useEffect(() => {
    if (!showDiffTree) return

    const body = bodyRef.current
    if (!body) return

    const clampWidthToBody = (): void => {
      const maxWidth = getDiffTreeMaxWidth(body.getBoundingClientRect().width)
      setDiffTreeWidth((currentWidth) => clamp(currentWidth, diffTreeMinWidth, maxWidth))
    }

    clampWidthToBody()
    const observer = new ResizeObserver(clampWidthToBody)
    observer.observe(body)

    return () => observer.disconnect()
  }, [showDiffTree])

  const requestClose = useCallback((): void => {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return
    onClose()
  }, [dirty, onClose])
  const continueReview = useCallback((): void => {
    if (!onContinueReview || reviewComments.length === 0) return
    if (dirty && !window.confirm('Discard your unsaved changes?')) return
    onContinueReview(reviewComments)
  }, [dirty, onContinueReview, reviewComments])
  const toggleWordWrap = useCallback((): void => {
    setWordWrap((currentWordWrap) => !currentWordWrap)
  }, [])
  const selectDiffTarget = useCallback(
    (nextTarget: FileEditorTarget): void => {
      if (nextTarget.path === target.path) return
      if (dirty && !window.confirm('Discard your unsaved changes?')) return
      onSelectTarget?.(nextTarget)
    },
    [dirty, onSelectTarget, target.path]
  )
  const toggleDiffFolder = useCallback((folderPath: string): void => {
    setCollapsedDiffFolders((currentFolders) => ({
      ...currentFolders,
      [folderPath]: !currentFolders[folderPath]
    }))
  }, [])
  const addReviewComment = useCallback(
    (comment: string, location: DiffReviewLocation): void => {
      setReviewComments((comments) => [
        ...comments,
        {
          id: crypto.randomUUID(),
          path: target.displayPath.replace(/\\/g, '/'),
          comment,
          ...location
        }
      ])
    },
    [target.displayPath]
  )
  const changeReviewComment = useCallback((id: string, comment: string): void => {
    setReviewComments((comments) =>
      comments.map((candidate) => (candidate.id === id ? { ...candidate, comment } : candidate))
    )
  }, [])
  const deleteReviewComment = useCallback((id: string): void => {
    setReviewComments((comments) => comments.filter((comment) => comment.id !== id))
  }, [])
  const resizeDiffTreeBy = useCallback((delta: number): void => {
    const bodyWidth = bodyRef.current?.getBoundingClientRect().width ?? Infinity
    const maxWidth = Number.isFinite(bodyWidth) ? getDiffTreeMaxWidth(bodyWidth) : diffTreeMaxWidth
    setDiffTreeWidth((currentWidth) => clamp(currentWidth + delta, diffTreeMinWidth, maxWidth))
  }, [])
  const startDiffTreeResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return

      const body = bodyRef.current
      if (!body) return

      event.preventDefault()
      resizeCleanupRef.current?.()

      const startX = event.clientX
      const startWidth = diffTreeWidth
      const maxWidth = getDiffTreeMaxWidth(body.getBoundingClientRect().width)
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        setDiffTreeWidth(clamp(startWidth + moveEvent.clientX - startX, diffTreeMinWidth, maxWidth))
      }

      const stopResize = (): void => {
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', stopResize)
        window.removeEventListener('pointercancel', stopResize)
        resizeCleanupRef.current = null
      }

      resizeCleanupRef.current = stopResize
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', stopResize)
      window.addEventListener('pointercancel', stopResize)
    },
    [diffTreeWidth]
  )
  const resizeMarkdownSplitBy = useCallback((delta: number): void => {
    setMarkdownSplitPercentage((currentPercentage) =>
      clamp(currentPercentage + delta, markdownSplitMinPercentage, markdownSplitMaxPercentage)
    )
  }, [])
  const startMarkdownSplitResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return

      const split = markdownSplitRef.current
      if (!split) return

      const bounds = split.getBoundingClientRect()
      const splitSize = markdownSplitStacked ? bounds.height : bounds.width
      if (splitSize <= 0) return

      event.preventDefault()
      resizeCleanupRef.current?.()

      const startPosition = markdownSplitStacked ? event.clientY : event.clientX
      const startPercentage = markdownSplitPercentage
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect

      document.body.style.cursor = markdownSplitStacked ? 'row-resize' : 'col-resize'
      document.body.style.userSelect = 'none'

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        const position = markdownSplitStacked ? moveEvent.clientY : moveEvent.clientX
        const deltaPercentage = ((position - startPosition) / splitSize) * 100
        setMarkdownSplitPercentage(
          clamp(
            startPercentage + deltaPercentage,
            markdownSplitMinPercentage,
            markdownSplitMaxPercentage
          )
        )
      }

      const stopResize = (): void => {
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', stopResize)
        window.removeEventListener('pointercancel', stopResize)
        resizeCleanupRef.current = null
      }

      resizeCleanupRef.current = stopResize
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', stopResize)
      window.addEventListener('pointercancel', stopResize)
    },
    [markdownSplitPercentage, markdownSplitStacked]
  )

  const renderDiffTreeNode = (node: DiffTreeNode, depth: number): React.ReactElement => {
    if (node.type === 'folder') {
      const collapsed = Boolean(collapsedDiffFolders[node.path])

      return (
        <li
          className="file-editor-dialog__tree-item"
          key={node.path}
          role="treeitem"
          aria-expanded={!collapsed}
        >
          <button
            className="file-editor-dialog__tree-row file-editor-dialog__tree-row--folder"
            type="button"
            title={node.path}
            style={{ '--file-diff-tree-depth': depth } as React.CSSProperties}
            onClick={() => toggleDiffFolder(node.path)}
          >
            <span className="file-editor-dialog__tree-chevron" aria-hidden="true">
              {collapsed ? <ChevronRight /> : <ChevronDown />}
            </span>
            <span className="file-editor-dialog__tree-icon" aria-hidden="true">
              <SymbolsFolderIcon folderName={node.name} />
            </span>
            <span className="file-editor-dialog__tree-name">{node.name}</span>
          </button>
          {!collapsed && node.children.length > 0 && (
            <ul className="file-editor-dialog__tree-group" role="group">
              {node.children.map((childNode) => renderDiffTreeNode(childNode, depth + 1))}
            </ul>
          )}
        </li>
      )
    }

    const nodeDisplayPath = node.target.displayPath.replace(/\\/g, '/')
    const active = node.target.path === target.path
    const reviewCommentCount = reviewCommentCountByPath.get(nodeDisplayPath) ?? 0

    return (
      <li
        className={`file-editor-dialog__tree-item file-editor-dialog__tree-item--${node.target.kind ?? 'edit'}`}
        key={node.target.path}
        role="treeitem"
        aria-current={active ? 'true' : undefined}
      >
        <button
          className="file-editor-dialog__tree-row file-editor-dialog__tree-row--file"
          type="button"
          aria-label={`Open diff for ${nodeDisplayPath}`}
          data-active={active ? 'true' : undefined}
          title={nodeDisplayPath}
          style={{ '--file-diff-tree-depth': depth } as React.CSSProperties}
          onClick={() => selectDiffTarget(node.target)}
        >
          <span className="file-editor-dialog__tree-spacer" aria-hidden="true" />
          <span className="file-editor-dialog__tree-icon" aria-hidden="true">
            <SymbolsFileIcon fileName={node.name} autoAssign />
          </span>
          <span className="file-editor-dialog__tree-name">{node.name}</span>
          {reviewCommentCount > 0 && (
            <span
              className="file-editor-dialog__tree-comment-count"
              aria-label={`${reviewCommentCount} review comment${reviewCommentCount === 1 ? '' : 's'}`}
            >
              <MessageSquare aria-hidden="true" />
              <span aria-hidden="true">·</span>
              <span>{reviewCommentCount}</span>
            </span>
          )}
        </button>
      </li>
    )
  }

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        (event.target instanceof Element &&
          Boolean(
            event.target.closest('.unified-diff__review-form, .unified-diff__review-overlay')
          ))
      ) {
        return
      }

      event.preventDefault()
      requestClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [requestClose])

  const handleSave = useCallback(async (): Promise<void> => {
    if (visibleLoadState !== 'ready' || saveState === 'saving' || !version || !dirty) return

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
    saveState,
    target.cwd,
    target.path,
    version,
    visibleLoadState
  ])

  const handleCopyImage = useCallback(async (): Promise<void> => {
    if (!canShowImage || visibleLoadState !== 'ready' || copyState === 'copying') return

    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current)
      copyFeedbackTimerRef.current = null
    }
    setCopyState('copying')
    setEditorError(null)

    try {
      await appApi.copyLocalImage({
        cwd: target.cwd,
        path: target.path
      })
      setCopyState('copied')
      copyFeedbackTimerRef.current = window.setTimeout(() => {
        copyFeedbackTimerRef.current = null
        setCopyState('idle')
      }, 1000)
    } catch (copyError) {
      setEditorError(getErrorMessage(copyError, 'Unable to copy this image.'))
      setCopyState('error')
    }
  }, [canShowImage, copyState, target.cwd, target.path, visibleLoadState])

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
        aria-label={`${canEdit ? 'Edit' : showFileDiff ? 'View changes to' : 'View'} ${displayPath}${
          target.line
            ? target.endLine && target.endLine > target.line
              ? ` at lines ${target.line}-${target.endLine}`
              : ` at line ${target.line}`
            : ''
        }`}
      >
        <header className="file-editor-dialog__header">
          <div className="file-editor-dialog__header-leading">
            {hasDiffTree && (
              <Button
                aria-controls="file-editor-diff-tree"
                aria-expanded={!diffTreeCollapsed}
                aria-label={
                  diffTreeCollapsed
                    ? 'Expand changed files sidebar'
                    : 'Collapse changed files sidebar'
                }
                callback={() => setDiffTreeCollapsed((collapsed) => !collapsed)}
                icon={diffTreeCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
                size="small"
                theme="transparent"
                title={
                  diffTreeCollapsed
                    ? 'Expand changed files sidebar'
                    : 'Collapse changed files sidebar'
                }
              />
            )}
            {canShowDiff && canShowContents && (
              <SegmentedControl
                aria-label="File view"
                className="file-editor-dialog__file-view-switch"
                options={fileViewOptions}
                size="small"
                value={fileView}
                onChange={setFileView}
              />
            )}
            <span className="file-editor-dialog__file-icon" aria-hidden="true">
              <SymbolsFileIcon fileName={fileName} autoAssign />
            </span>
          </div>
          <div className="file-editor-dialog__title">
            <strong title={fileName}>{fileName}</strong>
            <span title={directoryName}>{directoryName}</span>
          </div>
          <div className="file-editor-dialog__actions">
            {isMarkdown && canShowContents && (
              <SegmentedControl
                aria-label="Markdown view"
                className="file-editor-dialog__markdown-view-switch"
                disabled={visibleLoadState !== 'ready'}
                options={markdownViewOptions}
                size="small"
                value={markdownView}
                onChange={setMarkdownView}
              />
            )}
            {isFileDiff && reviewComments.length > 0 && onContinueReview && (
              <Button
                callback={continueReview}
                icon={<MessageSquare aria-hidden="true" />}
                label={
                  <span>
                    Continue <span aria-hidden="true">·</span> {reviewComments.length}
                  </span>
                }
                size="small"
                theme="primary"
                title={`Continue with ${reviewComments.length} review comment${reviewComments.length === 1 ? '' : 's'}`}
              />
            )}
            {canShowImage && visibleLoadState === 'ready' && (
              <Button
                aria-label={`Copy ${displayPath}`}
                callback={handleCopyImage}
                disabled={copyState === 'copying'}
                icon={copyState === 'copied' ? <Check /> : <Copy />}
                label={copyState === 'copied' ? 'Copied' : 'Copy'}
                size="small"
                theme="secondary"
                title="Copy image"
              />
            )}
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
                size="small"
                theme="secondary"
                title="Save (Ctrl/Cmd+S)"
              />
            )}
            {canShowContents && (!isMarkdown || markdownView !== 'preview') && (
              <Button
                aria-label={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
                aria-pressed={wordWrap}
                callback={toggleWordWrap}
                data-pressed={wordWrap ? 'true' : undefined}
                icon={<WrapText />}
                size="small"
                theme="secondary"
                title={wordWrap ? 'Disable word wrap (Alt+Z)' : 'Enable word wrap (Alt+Z)'}
              />
            )}
            <Button
              callback={() => setExpanded((currentExpanded) => !currentExpanded)}
              icon={expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
              size="small"
              theme="secondary"
              aria-label={expanded ? 'Collapse file editor' : 'Expand file editor'}
              title={expanded ? 'Collapse' : 'Expand'}
            />
            <Button
              aria-label="Close file editor"
              callback={requestClose}
              icon={<X aria-hidden="true" />}
              size="small"
              theme="transparent"
              title="Close"
            />
          </div>
        </header>

        <div
          className={`file-editor-dialog__body${showDiffTree ? ' file-editor-dialog__body--with-diff-tree' : ''}`}
          ref={bodyRef}
          style={
            showDiffTree
              ? ({ '--file-diff-tree-width': `${diffTreeWidth}px` } as CSSProperties)
              : undefined
          }
        >
          {hasDiffTree && (
            <aside
              className="file-editor-dialog__tree-sidebar"
              id="file-editor-diff-tree"
              aria-label="Changed files"
              hidden={!showDiffTree}
            >
              <div className="file-editor-dialog__tree-scroll">
                <ul className="file-editor-dialog__tree" role="tree">
                  {diffTree.map((node) => renderDiffTreeNode(node, 0))}
                </ul>
              </div>
            </aside>
          )}
          {showDiffTree && (
            <div
              className="file-editor-dialog__tree-resize-handle"
              role="separator"
              aria-label="Resize changed files sidebar"
              aria-orientation="vertical"
              aria-valuemax={diffTreeMaxWidth}
              aria-valuemin={diffTreeMinWidth}
              aria-valuenow={Math.round(diffTreeWidth)}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                event.preventDefault()
                resizeDiffTreeBy(event.key === 'ArrowLeft' ? -16 : 16)
              }}
              onPointerDown={startDiffTreeResize}
            />
          )}

          <div className="file-editor-dialog__content">
            {canShowImage && visibleLoadState === 'ready' && editorError && (
              <div className="file-editor-dialog__error" role="alert">
                {editorError}
              </div>
            )}
            {showFileDiff && !canEdit && (
              <div className="file-editor-dialog__diff-view">
                {visibleDiffLoadState === 'loading' && (
                  <div className="file-editor-dialog__state" role="status">
                    <LoaderCircle className="file-editor-dialog__spinner" aria-hidden="true" />
                    <span>Loading diff…</span>
                  </div>
                )}
                {visibleDiffLoadState === 'error' && (
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
                {visibleDiffLoadState === 'ready' &&
                  (diff && renderedFileDiff ? (
                    <div className="file-editor-dialog__diff-scroll">
                      <UnifiedDiff
                        className="file-editor-dialog__diff"
                        comments={currentReviewComments}
                        endLine={target.endLine}
                        fileDiff={renderedFileDiff}
                        line={target.line}
                        onAddComment={isFileDiff && onContinueReview ? addReviewComment : undefined}
                        onChangeComment={
                          isFileDiff && onContinueReview ? changeReviewComment : undefined
                        }
                        onDeleteComment={
                          isFileDiff && onContinueReview ? deleteReviewComment : undefined
                        }
                      />
                    </div>
                  ) : (
                    <div className="file-editor-dialog__state">
                      <FileDiff aria-hidden="true" />
                      <p>No changes to display.</p>
                    </div>
                  ))}
              </div>
            )}

            {canOpenFile &&
              (visibleLoadState === 'loading' ||
                (showFileDiff && visibleDiffLoadState === 'loading')) && (
                <div className="file-editor-dialog__state" role="status">
                  <LoaderCircle className="file-editor-dialog__spinner" aria-hidden="true" />
                  <span>
                    {canShowImage
                      ? 'Opening image…'
                      : showFileDiff
                        ? 'Opening editable diff…'
                        : 'Opening file…'}
                  </span>
                </div>
              )}

            {canOpenFile &&
              (visibleLoadState === 'error' ||
                (showFileDiff && visibleDiffLoadState === 'error')) && (
                <div className="file-editor-dialog__state" role="alert">
                  {canShowImage ? (
                    <ImageIcon aria-hidden="true" />
                  ) : showFileDiff ? (
                    <FileDiff aria-hidden="true" />
                  ) : (
                    <FileCode2 aria-hidden="true" />
                  )}
                  <p>{editorError ?? diffError}</p>
                  <Button
                    callback={() => {
                      if (canShowImage) void loadImage()
                      else {
                        void loadFile()
                        if (showFileDiff) void loadDiff()
                      }
                    }}
                    icon={<RefreshCw />}
                    label="Try again"
                    size="small"
                    theme="secondary"
                  />
                </div>
              )}

            {canShowImage && visibleLoadState === 'ready' && imageDataUrl && (
              <div className="file-editor-dialog__image-preview">
                <img src={imageDataUrl} alt={fileName} draggable={false} />
              </div>
            )}

            {canShowContents &&
              visibleLoadState === 'ready' &&
              (!showFileDiff || visibleDiffLoadState === 'ready') && (
                <div
                  className={[
                    'file-editor-dialog__inline-diff',
                    isMarkdown ? 'file-editor-dialog__inline-diff--markdown' : null,
                    isMarkdown ? `file-editor-dialog__inline-diff--markdown-${markdownView}` : null
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  ref={markdownSplitRef}
                  style={
                    isMarkdown && markdownView === 'split'
                      ? ({
                          '--markdown-split-percentage': `${markdownSplitPercentage}%`
                        } as CSSProperties)
                      : undefined
                  }
                >
                  {editorError && (
                    <div className="file-editor-dialog__error" role="alert">
                      {editorError}
                    </div>
                  )}
                  <div className="file-editor-dialog__editor-pane">
                    <EditableUnifiedDiff
                      key={target.path}
                      ariaLabel={`Contents of ${target.displayPath}`}
                      baselineContents={showFileDiff ? savedContents : contents}
                      className="file-editor-dialog__diff"
                      comments={currentReviewComments}
                      contents={contents}
                      endLine={target.endLine}
                      fileDiff={displayedFileDiff}
                      line={target.line}
                      onChange={(nextContents) => {
                        setContents(nextContents)
                        setSaveState('idle')
                        setEditorError(null)
                      }}
                      onAddComment={isFileDiff && onContinueReview ? addReviewComment : undefined}
                      onChangeComment={
                        isFileDiff && onContinueReview ? changeReviewComment : undefined
                      }
                      onDeleteComment={
                        isFileDiff && onContinueReview ? deleteReviewComment : undefined
                      }
                      onSave={() => void handleSave()}
                      onToggleWordWrap={toggleWordWrap}
                      readOnly={!canEdit}
                      wordWrap={wordWrap}
                    />
                  </div>
                  {isMarkdown && markdownView === 'split' && (
                    <div
                      className="file-editor-dialog__markdown-resize-handle"
                      role="separator"
                      aria-label="Resize Markdown editor and preview"
                      aria-orientation={markdownSplitStacked ? 'horizontal' : 'vertical'}
                      aria-valuemax={markdownSplitMaxPercentage}
                      aria-valuemin={markdownSplitMinPercentage}
                      aria-valuenow={Math.round(markdownSplitPercentage)}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        const decreaseKey = markdownSplitStacked ? 'ArrowUp' : 'ArrowLeft'
                        const increaseKey = markdownSplitStacked ? 'ArrowDown' : 'ArrowRight'
                        if (event.key !== decreaseKey && event.key !== increaseKey) return
                        event.preventDefault()
                        resizeMarkdownSplitBy(event.key === decreaseKey ? -2 : 2)
                      }}
                      onPointerDown={startMarkdownSplitResize}
                    />
                  )}
                  {isMarkdown && markdownView !== 'code' && (
                    <article
                      className="file-editor-dialog__markdown-preview"
                      aria-label={`Preview of ${target.displayPath}`}
                      dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
                    />
                  )}
                </div>
              )}
          </div>
        </div>
      </section>
    </div>
  )
})
