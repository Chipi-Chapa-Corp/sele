import { useLayoutEffect, useRef, type RefObject } from 'react'
import type { AppContainerTarget } from '../../shared/app'
import { appApi } from './appApi'
import { getContainerTargetKey } from './containerSelection'
import { createLocalImageUrl } from './localImage'

type RetainedImage = {
  key: string
  node: HTMLElement
  active: boolean
  dispose: () => void
}

// Markdown owns its HTML, so text updates replace even unchanged image elements.
// Restore those elements before paint, retaining their decoded pixels and any
// in-progress local file read. Resources live only as long as their image does.
export function useMarkdownImages(
  ref: RefObject<HTMLDivElement | null>,
  html: string,
  container: AppContainerTarget | null | undefined,
  cwd: string | null | undefined,
  errorMarkup: string
): void {
  const retained = useRef<RetainedImage[]>([])
  useLayoutEffect(
    () => () => {
      retained.current.forEach((entry) => entry.dispose())
      retained.current = []
    },
    []
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: HTML signals replacement of the DOM-owned Markdown subtree.
  useLayoutEffect(() => {
    const root = ref.current?.querySelector('.chat-detail__message-markdown')
    if (!root) return
    const available = new Map<string, RetainedImage[]>()
    for (const entry of retained.current) {
      const entries = available.get(entry.key) ?? []
      entries.push(entry)
      available.set(entry.key, entries)
    }
    const next: RetainedImage[] = []
    const nodes = root.querySelectorAll<HTMLElement>(
      '.chat-detail__markdown-image[data-local-image-path], img'
    )
    for (const node of nodes) {
      // Local images belong to their retained button, not a second entry.
      if (node.tagName === 'IMG' && node.closest('.chat-detail__markdown-image')) continue
      const path = node.dataset.localImagePath
      const name = node.dataset.localImageName ?? 'Image'
      const key = path
        ? JSON.stringify(['local', getContainerTargetKey(container), cwd ?? null, path, name])
        : JSON.stringify([
            'remote',
            ...Array.from(node.attributes, ({ name, value }) => [name, value]).filter(
              ([name]) => name !== 'hidden' || !node.classList.contains('chat-detail__link-favicon')
            )
          ])
      const existing = available.get(key)?.shift()
      if (existing) {
        if (existing.node !== node) node.replaceWith(existing.node)
        next.push(existing)
        continue
      }

      let objectUrl: string | null = null
      const handleError = (): void => {
        if (node.classList.contains('chat-detail__link-favicon')) node.hidden = true
      }
      const entry: RetainedImage = {
        key,
        node,
        active: true,
        dispose: () => {
          entry.active = false
          node.removeEventListener('error', handleError)
          if (objectUrl) URL.revokeObjectURL(objectUrl)
        }
      }
      next.push(entry)
      if (!path) {
        node.addEventListener('error', handleError)
        continue
      }
      const video = node.dataset.mediaType === 'video'
      const loadMedia = video ? appApi.getLocalVideo : appApi.getLocalImage
      void loadMedia({ container, cwd, path, relativeTo: 'cwd' })
        .then((image) => {
          if (!entry.active) return
          objectUrl = createLocalImageUrl(image)
          if (video) {
            const videoElement = document.createElement('video')
            videoElement.src = objectUrl
            videoElement.muted = true
            videoElement.playsInline = true
            videoElement.preload = 'auto'
            videoElement.setAttribute('aria-hidden', 'true')
            const playIcon = document.createElement('span')
            playIcon.className = 'chat-detail__markdown-video-play'
            playIcon.setAttribute('aria-hidden', 'true')
            playIcon.textContent = '▶'
            node.replaceChildren(videoElement, playIcon)
          } else {
            const imageElement = document.createElement('img')
            imageElement.src = objectUrl
            imageElement.alt = name
            node.replaceChildren(imageElement)
          }
        })
        .catch((error) => {
          if (!entry.active) return
          console.error('[caught:useMarkdownImages]', error)
          const placeholder = document.createElement('span')
          placeholder.className = 'chat-detail__markdown-image-error'
          placeholder.innerHTML = errorMarkup
          node.replaceChildren(placeholder)
          node.setAttribute('aria-disabled', 'true')
          node.setAttribute('aria-label', `${name} unavailable`)
          node.title = `${path} unavailable`
        })
    }
    available.forEach((entries) => entries.forEach((entry) => entry.dispose()))
    retained.current = next
  }, [container, cwd, errorMarkup, html, ref])
}
