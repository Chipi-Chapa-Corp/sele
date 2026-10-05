import DOMPurify from 'dompurify'
import { marked, Renderer, type Tokens } from 'marked'
import type { AppContainerTarget } from '../../shared/app'
import { appApi } from './appApi'
import { isMermaidMarkdownCode, renderMarkdownCodeBlock } from './codeHighlighting'
import { createLocalImageUrl } from './localImage'

const defaultRenderer = new Renderer()
const renderer = new Renderer()
renderer.code = function (token: Tokens.Code): string {
  return isMermaidMarkdownCode(token.lang)
    ? renderMarkdownCodeBlock(token.text, token.lang)
    : defaultRenderer.code.call(this, token)
}

export const renderFileMarkdown = (contents: string): string => {
  const template = document.createElement('template')
  template.innerHTML = DOMPurify.sanitize(
    marked.parse(contents, { async: false, gfm: true, renderer })
  )
  for (const image of template.content.querySelectorAll('img')) {
    const source = image.getAttribute('src')
    if (!source || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(source)) continue
    image.dataset.fileImagePath = source
    image.removeAttribute('src')
    image.removeAttribute('srcset')
  }
  return template.innerHTML
}

export const hydrateFileMarkdownImages = (
  root: HTMLElement,
  options: { container?: AppContainerTarget | null; cwd: string; path: string }
): (() => void) => {
  let active = true
  const urls: string[] = []
  const filePath = options.path.replace(/\\/g, '/')
  const directory = filePath.slice(0, filePath.lastIndexOf('/') + 1)
  const images = new Map<string, Promise<string>>()
  for (const image of root.querySelectorAll<HTMLImageElement>('img[data-file-image-path]')) {
    const source = image.dataset.fileImagePath!
    const load = async (): Promise<string> => {
      const path = decodeURIComponent(source.split(/[?#]/, 1)[0])
      const result = await appApi.getLocalImage({
        container: options.container,
        cwd: options.cwd,
        path: path.startsWith('/') ? path : `${directory}${path}`,
        relativeTo: 'cwd'
      })
      if (!active) return ''
      const url = createLocalImageUrl(result)
      urls.push(url)
      return url
    }
    let pending = images.get(source)
    if (!pending) {
      pending = load()
      images.set(source, pending)
    }
    void pending
      .then((url) => {
        if (active) image.src = url
      })
      .catch((error) => {
        console.error('[caught:fileMarkdown:loadImage]', error)
        if (active) image.title = `${source} unavailable`
      })
  }
  return () => {
    active = false
    urls.forEach((url) => URL.revokeObjectURL(url))
  }
}
