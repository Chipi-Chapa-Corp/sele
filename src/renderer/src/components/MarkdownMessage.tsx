import DOMPurify from 'dompurify'
import { ImageOff } from 'lucide-react'
import { Marked } from 'marked'
import markedFootnote from 'marked-footnote'
import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AppContainerTarget, AppLocalImageOptions } from '../../../shared/app'
import { appApi } from '../appApi'
import { createBoundedTextCache } from '../boundedTextCache'
import { createChatMarkdownRenderer } from '../chatMarkdownRenderer'
import { chatMediaId } from '../chatMedia'
import { useStreamReveal } from '../motion/useStreamReveal'
import { visualizationExtension } from '../visualizationReference'
import { codexFileCitationExtension } from '../codexFileCitation'
import './ChatDetailItem.css'
import { useChatMedia } from './ChatMediaGallery'
import { ImageLightbox } from './ImageLightbox'
import {
  ProgressiveMarkdownContent,
  progressiveMarkdownThreshold
} from './ProgressiveMarkdownContent'
import { TableLightbox } from './TableLightbox'

const streamRenderMaxDelayMs = 180
const brokenImageIconMarkup = renderToStaticMarkup(<ImageOff aria-hidden="true" />)

type MarkdownFence = {
  marker: '`' | '~'
  length: number
}

const getMarkdownFence = (line: string): MarkdownFence | null => {
  const match = line.match(/^(?: {0,3})(`{3,}|~{3,})/)
  if (!match) return null

  const marker = match[1]
  return { marker: marker[0] as MarkdownFence['marker'], length: marker.length }
}

const isMarkdownFenceClose = (line: string, fence: MarkdownFence): boolean => {
  const match = line.match(/^(?: {0,3})(`{3,}|~{3,})(.*)$/)
  if (!match) return false

  const marker = match[1]
  return marker[0] === fence.marker && marker.length >= fence.length && !match[2].trim()
}

const withPromptMarkdownLineBreaks = (content: string): string => {
  const parts = content.split(/(\r?\n)/)
  let fence: MarkdownFence | null = null

  return parts
    .map((part, index) => {
      if (index % 2 === 1 || !parts[index + 1]) return part

      if (fence) {
        if (isMarkdownFenceClose(part, fence)) fence = null
        return part
      }

      const nextFence = getMarkdownFence(part)
      if (nextFence) {
        fence = nextFence
        return part
      }

      if (!part.trim() || part.endsWith('  ')) return part
      return `${part}  `
    })
    .join('')
}

const getNaturalStreamBoundary = (content: string, afterIndex: number): number | null => {
  let fence: MarkdownFence | null = null
  let offset = 0
  let boundary: number | null = null

  for (const part of content.match(/[^\n]*(?:\n|$)/g) ?? []) {
    if (!part) continue

    const line = part.endsWith('\n') ? part.slice(0, -1) : part
    const partEnd = offset + part.length

    if (fence) {
      if (isMarkdownFenceClose(line, fence)) {
        fence = null
        if (partEnd > afterIndex) boundary = partEnd
      }
      offset = partEnd
      continue
    }

    const nextFence = getMarkdownFence(line)
    if (nextFence) {
      fence = nextFence
      offset = partEnd
      continue
    }

    const sentenceBoundaryPattern = /[.!?](?:["')\]]*)(?=\s|$)/g
    for (const match of line.matchAll(sentenceBoundaryPattern)) {
      const matchEnd = offset + (match.index ?? 0) + match[0].length
      if (matchEnd > afterIndex) boundary = matchEnd
    }

    if (part.endsWith('\n') && partEnd > afterIndex) boundary = partEnd
    offset = partEnd
  }

  return boundary
}

const useStreamRenderedContent = (content: string, streaming: boolean): string => {
  const [streamedContent, setStreamedContent] = useState(content)
  const latestContentRef = useRef(content)
  const renderedContentRef = useRef(content)
  const flushTimerRef = useRef<number | null>(null)
  const scheduleFlushRef = useRef<() => void>(() => {})

  const clearFlushTimer = useCallback((): void => {
    if (flushTimerRef.current === null) return
    window.clearTimeout(flushTimerRef.current)
    flushTimerRef.current = null
  }, [])

  const flushContent = useCallback((nextContent: string): void => {
    renderedContentRef.current = nextContent
    startTransition(() => setStreamedContent(nextContent))
  }, [])

  const scheduleFlush = useCallback((): void => {
    if (flushTimerRef.current !== null) return

    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null
      const latestContent = latestContentRef.current
      const renderedLength = renderedContentRef.current.length
      if (latestContent.length <= renderedLength) return

      const nextLength =
        getNaturalStreamBoundary(latestContent, renderedLength) ?? latestContent.length
      flushContent(latestContent.slice(0, nextLength))

      if (nextLength < latestContent.length) scheduleFlushRef.current()
    }, streamRenderMaxDelayMs)
  }, [flushContent])

  useEffect(() => {
    scheduleFlushRef.current = scheduleFlush
  }, [scheduleFlush])

  useEffect(() => {
    latestContentRef.current = content

    if (!streaming) {
      clearFlushTimer()
      // Already rendered, e.g. on mount. A state update here, even an unchanged
      // one inside a transition, renders every newly mounted message twice.
      if (content !== renderedContentRef.current) flushContent(content)
      return
    }

    const renderedContent = renderedContentRef.current
    if (!content.startsWith(renderedContent)) {
      clearFlushTimer()
      flushContent(content)
      return
    }
    if (content.length === renderedContent.length) return

    const boundary = getNaturalStreamBoundary(content, renderedContent.length)
    if (boundary !== null) {
      clearFlushTimer()
      flushContent(content.slice(0, boundary))
    }

    if (renderedContentRef.current.length < content.length) scheduleFlush()
  }, [clearFlushTimer, content, flushContent, scheduleFlush, streaming])

  useEffect(
    () => () => {
      clearFlushTimer()
    },
    [clearFlushTimer]
  )

  return streaming ? streamedContent : content
}

const messageMarkdownCache = createBoundedTextCache<string>(100, 4_000_000, (html) => html.length)

const MarkdownMessageComponent: React.FC<{
  className: string
  content: string
  baseUrl?: string
  localImageContainer?: AppContainerTarget | null
  localImageCwd?: string | null
  onOpenFileLink?: (path: string, displayPath: string, line?: number, endLine?: number) => void
  preserveLineBreaks?: boolean
  selectionQuoteHost?: boolean
  streaming?: boolean
  mediaScope?: string
}> = ({
  className,
  content,
  baseUrl,
  localImageContainer,
  localImageCwd,
  onOpenFileLink,
  preserveLineBreaks = false,
  selectionQuoteHost = false,
  streaming = false,
  mediaScope
}) => {
  const { open: openGallery, scope } = useChatMedia()
  const containerRef = useRef<HTMLDivElement>(null)
  const footnotePrefix = `chat-${useId().replace(/:/g, '')}-footnote-`
  const [localImagePreview, setLocalImagePreview] = useState<{
    imageUrl: string
    name: string
    path?: string
    mediaType: 'image' | 'video'
  } | null>(null)
  const [expandedTableHtml, setExpandedTableHtml] = useState<string | null>(null)
  const visibleContent = useStreamRenderedContent(content, streaming)
  const progressiveRef = useRef(false)
  if (visibleContent.length >= progressiveMarkdownThreshold) progressiveRef.current = true
  const progressive = progressiveRef.current
  const interactiveFileLinks = Boolean(onOpenFileLink)
  const markdownRenderer = useMemo(
    () => createChatMarkdownRenderer(interactiveFileLinks, baseUrl),
    [interactiveFileLinks, baseUrl]
  )
  const visualizationMarkdown = useMemo(
    () =>
      new Marked({
        extensions: baseUrl ? [] : [visualizationExtension, codexFileCitationExtension]
      }).use(markedFootnote({ prefixId: footnotePrefix })),
    [footnotePrefix, baseUrl]
  )
  const renderedMarkdown = useMemo(() => {
    if (progressive) return ''
    const render = (): string =>
      DOMPurify.sanitize(
        visualizationMarkdown.parse(
          preserveLineBreaks ? withPromptMarkdownLineBreaks(visibleContent) : visibleContent,
          {
            async: false,
            gfm: true,
            renderer: markdownRenderer
          }
        ),
        { ADD_ATTR: ['target'] }
      )
    // Footnotes contain mount-specific IDs. Keep their original rendering path,
    // and avoid retaining a succession of transient streaming snapshots.
    if (streaming || visibleContent.includes('[^')) return render()
    return messageMarkdownCache.get(
      `${baseUrl ?? ''}:${interactiveFileLinks}:${preserveLineBreaks}:${visibleContent}`,
      render
    )
  }, [
    baseUrl,
    progressive,
    interactiveFileLinks,
    markdownRenderer,
    preserveLineBreaks,
    visibleContent,
    visualizationMarkdown,
    streaming
  ])
  useStreamReveal(containerRef, renderedMarkdown, streaming)
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>): void => {
      if (!(event.target instanceof Element)) return

      const tableExpandButton = event.target.closest<HTMLButtonElement>(
        '.chat-detail__table-expand'
      )
      if (tableExpandButton && containerRef.current?.contains(tableExpandButton)) {
        const table = tableExpandButton
          .closest('.chat-detail__table-frame')
          ?.querySelector<HTMLTableElement>('.chat-detail__table')
        if (table) {
          event.preventDefault()
          setExpandedTableHtml(table.outerHTML)
        }
        return
      }

      const imageButton = event.target.closest<HTMLButtonElement>(
        '.chat-detail__markdown-image[data-local-image-path]'
      )
      const remoteImage = event.target.closest<HTMLImageElement>(
        'img:not(.chat-detail__link-favicon)'
      )
      const mediaElement = imageButton ?? remoteImage
      if (mediaElement && containerRef.current?.contains(mediaElement)) {
        const path = imageButton?.dataset.localImagePath
        const name = imageButton?.dataset.localImageName ?? remoteImage?.alt ?? 'Image'
        const imageUrl = imageButton
          ? imageButton.querySelector<HTMLImageElement | HTMLVideoElement>('img, video')?.src
          : remoteImage?.src
        const mediaType = imageButton?.dataset.mediaType === 'video' ? 'video' : 'image'
        if (imageUrl) {
          event.preventDefault()
          if (openGallery) {
            const elements = Array.from(
              containerRef.current.querySelectorAll(
                '.chat-detail__markdown-image[data-local-image-path], img:not(.chat-detail__link-favicon)'
              )
            ).filter(
              (element) =>
                element.tagName !== 'IMG' || !element.closest('.chat-detail__markdown-image')
            )
            openGallery({
              id: chatMediaId(mediaScope ?? scope, 'markdown', elements.indexOf(mediaElement)),
              mediaType,
              name,
              path,
              url: imageUrl,
              localImageOptions: {
                container: localImageContainer,
                cwd: localImageCwd,
                relativeTo: 'cwd'
              }
            })
          } else {
            setLocalImagePreview({ imageUrl, name, path, mediaType })
          }
        }
        return
      }

      const browserButton = event.target.closest<HTMLButtonElement>(
        '.chat-detail__file-link-browser[data-file-browser-path]'
      )
      if (browserButton && containerRef.current?.contains(browserButton)) {
        const path = browserButton.dataset.fileBrowserPath
        if (!path) return

        event.preventDefault()
        void appApi
          .openFileInBrowser({ container: localImageContainer, cwd: localImageCwd, path })
          .catch((error: unknown) => {
            console.error('Unable to open the file in the browser.', error)
          })
        return
      }

      if (!onOpenFileLink) return

      const fileLink = event.target.closest<HTMLButtonElement>(
        '.chat-detail__file-link[data-file-link-path]'
      )
      if (!fileLink || !containerRef.current?.contains(fileLink)) return

      const path = fileLink.dataset.fileLinkPath
      const displayPath = fileLink.dataset.fileLinkDisplayPath
      if (!path || !displayPath) return

      const parsedLine = fileLink.dataset.fileLinkLine
        ? Number.parseInt(fileLink.dataset.fileLinkLine, 10)
        : undefined
      const line =
        parsedLine && Number.isSafeInteger(parsedLine) && parsedLine > 0 ? parsedLine : undefined

      event.preventDefault()
      onOpenFileLink(path, displayPath, line)
    },
    [onOpenFileLink, openGallery, mediaScope, scope, localImageContainer, localImageCwd]
  )

  const localImageOptions: Omit<AppLocalImageOptions, 'path'> = {
    container: localImageContainer,
    cwd: localImageCwd,
    relativeTo: 'cwd'
  }

  return (
    <>
      <div className={className} ref={containerRef} onClick={handleClick}>
        <ProgressiveMarkdownContent
          html={progressive ? undefined : renderedMarkdown}
          content={
            preserveLineBreaks ? withPromptMarkdownLineBreaks(visibleContent) : visibleContent
          }
          interactiveFileLinks={interactiveFileLinks}
          baseUrl={baseUrl}
          footnotePrefix={footnotePrefix}
          streaming={streaming}
          container={localImageContainer}
          cwd={localImageCwd}
          errorMarkup={brokenImageIconMarkup}
        />
        {selectionQuoteHost && <div className="chat-detail__message-quote-host" />}
      </div>
      {localImagePreview && (
        <ImageLightbox
          mediaType={localImagePreview.mediaType}
          imageUrl={localImagePreview.imageUrl}
          localImageOptions={localImageOptions}
          name={localImagePreview.name}
          path={localImagePreview.path}
          onClose={() => setLocalImagePreview(null)}
        />
      )}
      {expandedTableHtml && (
        <TableLightbox tableHtml={expandedTableHtml} onClose={() => setExpandedTableHtml(null)} />
      )}
    </>
  )
}

export const MarkdownMessage = memo(MarkdownMessageComponent)
