import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { ProviderChatTurn } from '../../../shared/chatTurns'
import { appApi } from '../appApi'
import { getChatItemMedia, type ChatMediaSource } from '../chatMedia'
import { createLocalImageUrl } from '../localImage'
import { ImageLightbox } from './ImageLightbox'

const ChatMediaContext = createContext<((source: ChatMediaSource) => void) | null>(null)
const ChatMediaScopeContext = createContext('')

export const ChatMediaScope = ({
  id,
  children
}: {
  id: string
  children: ReactNode
}): React.ReactElement => <ChatMediaScopeContext value={id}>{children}</ChatMediaScopeContext>

export const useChatMedia = (): {
  open: ((source: ChatMediaSource) => void) | null
  scope: string
} => ({ open: useContext(ChatMediaContext), scope: useContext(ChatMediaScopeContext) })

const GalleryPreview = ({
  source,
  onClose,
  onPrevious,
  onNext,
  position,
  count
}: {
  source: ChatMediaSource
  onClose: () => void
  onPrevious?: () => void
  onNext?: () => void
  position: number
  count: number
}): React.ReactElement => {
  const [loaded, setLoaded] = useState<{ url?: string; error?: string } | null>(null)
  useEffect(() => {
    if (source.url || !source.path) return
    let active = true
    let objectUrl: string | null = null
    const load = source.mediaType === 'video' ? appApi.getLocalVideo : appApi.getLocalImage
    void load({ ...source.localImageOptions, path: source.path })
      .then((media) => {
        if (!active) return
        objectUrl = createLocalImageUrl(media)
        setLoaded({ url: objectUrl })
      })
      .catch((error) => {
        console.error('[caught:ChatMediaGallery:load]', error)
        if (active) setLoaded({ error: `Unable to load ${source.name}` })
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [source])

  return (
    <ImageLightbox
      mediaType={source.mediaType}
      imageUrl={source.url ?? loaded?.url ?? ''}
      name={source.name}
      path={source.path}
      localImageOptions={source.localImageOptions}
      loading={!source.url && !loaded}
      error={loaded?.error}
      onClose={onClose}
      onPrevious={onPrevious}
      onNext={onNext}
      position={position}
      count={count}
    />
  )
}

export function ChatMediaGallery({
  turns,
  startIndex,
  totalCount,
  localImageOptions,
  children
}: {
  turns: ProviderChatTurn[]
  startIndex: number
  totalCount: number
  localImageOptions?: ChatMediaSource['localImageOptions']
  children: ReactNode
}): React.ReactElement {
  // Retain source metadata when older transcript pages leave the rendered window.
  // Blob URLs belong to their thumbnails and are never kept in this index.
  const history = useRef(new Map<string, { index: number; sources: ChatMediaSource[] }>())
  const currentTurns = useMemo(
    () =>
      turns.map((turn, index) => ({
        id: turn.id,
        index: startIndex + index,
        sources: turn.items.flatMap((item) => getChatItemMedia(item, localImageOptions))
      })),
    [turns, startIndex, localImageOptions]
  )
  const sources = useMemo(() => {
    const merged = new Map(history.current)
    for (const [id, turn] of merged) if (turn.index >= totalCount) merged.delete(id)
    for (const turn of currentTurns) {
      // Replaced/edited turns at a known position must not leave stale media behind.
      for (const [id, old] of merged)
        if (old.index === turn.index && id !== turn.id) merged.delete(id)
      merged.set(turn.id, turn)
    }
    return [...merged.values()].sort((a, b) => a.index - b.index).flatMap((turn) => turn.sources)
  }, [currentTurns, totalCount])
  useLayoutEffect(() => {
    for (const [id, turn] of history.current)
      if (turn.index >= totalCount) history.current.delete(id)
    for (const turn of currentTurns) {
      for (const [id, old] of history.current)
        if (old.index === turn.index && id !== turn.id) history.current.delete(id)
      history.current.set(turn.id, turn)
    }
  }, [currentTurns, totalCount])
  const [selection, setSelection] = useState<ChatMediaSource | null>(null)
  const open = useCallback((source: ChatMediaSource) => {
    setSelection(source.path ? { ...source, url: undefined } : source)
  }, [])
  const close = useCallback(() => setSelection(null), [])
  const index = selection ? sources.findIndex((source) => source.id === selection.id) : -1
  useEffect(() => {
    if (selection && index < 0) setSelection(null)
  }, [selection, index])
  const previous = index > 0 ? () => setSelection(sources[index - 1]) : undefined
  const next =
    index >= 0 && index < sources.length - 1 ? () => setSelection(sources[index + 1]) : undefined

  return (
    <ChatMediaContext value={open}>
      {children}
      {selection && (
        <GalleryPreview
          key={selection.id}
          source={selection}
          onClose={close}
          onPrevious={previous}
          onNext={next}
          position={index + 1}
          count={index >= 0 ? sources.length : 1}
        />
      )}
    </ChatMediaContext>
  )
}
