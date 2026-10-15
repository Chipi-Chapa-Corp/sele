import { Marked, Renderer, type Tokens } from 'marked'
import markedFootnote from 'marked-footnote'
import type { AppLocalImageOptions } from '../../shared/app'
import type { ProviderChatItem, ProviderWorkingItem } from '../../shared/provider'
import { getVideoMimeType } from '../../shared/video.ts'
import { createBoundedTextCache } from './boundedTextCache.ts'
import { getChatMessagePresentation } from './chatMessageResources.ts'
import { getMarkdownFileLinkLabel, getMarkdownFileTarget } from './markdownFileLink.ts'
import { getWorkingStepItemSegments } from './chatDetailWindow.ts'

export type ChatMediaSource = {
  id: string
  mediaType: 'image' | 'video'
  name: string
  path?: string | null
  url?: string | null
  localImageOptions?: Omit<AppLocalImageOptions, 'path'>
}

export const chatMediaId = (scope: string, kind: string, index: number): string =>
  JSON.stringify([scope, kind, index])

const markdownCache = createBoundedTextCache<Omit<ChatMediaSource, 'id'>[]>(
  100,
  4_000_000,
  (sources) =>
    sources.reduce((size, source) => size + (source.path?.length ?? source.url?.length ?? 0), 0)
)

export const getMarkdownMedia = (
  content: string,
  scope: string,
  options?: ChatMediaSource['localImageOptions']
): ChatMediaSource[] =>
  markdownCache
    .get(content, () => {
      const sources: Omit<ChatMediaSource, 'id'>[] = []
      const collect = (token: Tokens.Image | Tokens.Link): string => {
        const target = getMarkdownFileTarget(token.href)
        // Only video links render as previews; ordinary file and web links aren't media.
        if (token.type === 'link' && (!target || !getVideoMimeType(target.path))) return ''
        const name =
          token.type === 'link'
            ? getMarkdownFileLinkLabel(token, target?.line)
            : token.text.trim() || target?.displayPath.split('/').at(-1) || 'Image'
        sources.push({
          mediaType: target && getVideoMimeType(target.path) ? 'video' : 'image',
          name,
          ...(target ? { path: target.path } : { url: token.href })
        })
        return ''
      }
      const renderer = new Renderer()
      renderer.image = collect
      renderer.link = function (token) {
        const target = getMarkdownFileTarget(token.href)
        return target && getVideoMimeType(target.path)
          ? collect(token)
          : this.parser.parseInline(token.tokens)
      }
      // Mirror preview rendering, including links that contain image previews.
      // Code and raw HTML never contribute chat media.
      renderer.code = renderer.codespan = renderer.html = () => ''
      new Marked({ renderer }).use(markedFootnote()).parse(content, { async: false })
      return sources
    })
    .map((source, index) => ({
      ...source,
      id: chatMediaId(scope, 'markdown', index),
      localImageOptions: source.path ? options : undefined
    }))

export const getChatItemMedia = (
  item: ProviderChatItem,
  options?: ChatMediaSource['localImageOptions']
): ChatMediaSource[] => {
  if (item.type === 'message' || item.type === 'pendingMessage') {
    return [
      ...(item.attachments ?? [])
        .filter((attachment) => attachment.kind === 'image')
        .map((image, index) => ({
          id: chatMediaId(item.id, 'attachment', index),
          mediaType: 'image' as const,
          name: image.name,
          path: image.path,
          url: image.dataUrl
        })),
      ...getMarkdownMedia(getChatMessagePresentation(item.content).content, item.id, options)
    ].filter((source) => source.path || source.url)
  }
  if (item.type !== 'working') return []
  const collect = (working: ProviderWorkingItem): ChatMediaSource[] => {
    if (working.type === 'message') return getMarkdownMedia(working.content, working.id, options)
    if (working.type === 'toolGroup') return working.tools.flatMap(collect)
    return working.images.flatMap((image, index) =>
      image.path || image.dataUrl
        ? [
            {
              id: chatMediaId(working.id, 'image', index),
              mediaType: 'image' as const,
              name: image.name ?? 'Generated image',
              path: image.path,
              url: image.dataUrl
            }
          ]
        : []
    )
  }
  return getWorkingStepItemSegments(item, Number.MAX_SAFE_INTEGER).flatMap((segment) =>
    segment.items.flatMap(collect)
  )
}
