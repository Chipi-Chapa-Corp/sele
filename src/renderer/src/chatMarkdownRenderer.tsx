import { Renderer, type Tokens } from 'marked'
import { renderToStaticMarkup } from 'react-dom/server'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import { Image as ImageIcon, Maximize2 } from 'lucide-react'
import { getVideoMimeType } from '../../shared/video'
import { getBrowserFaviconUrl } from '../../shared/browser'
import { renderMarkdownCodeBlock } from './codeHighlighting'
import { getMarkdownFileLinkLabel, getMarkdownFileTarget } from './markdownFileLink'

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })

const renderHtmlAttributes = (attributes: Record<string, string | number | undefined>): string =>
  Object.entries(attributes)
    .flatMap(([name, value]) =>
      value === undefined || value === '' ? [] : [` ${name}="${escapeHtml(String(value))}"`]
    )
    .join('')

const defaultChatMarkdownRenderer = new Renderer()
const loadingImageIconMarkup = renderToStaticMarkup(<ImageIcon aria-hidden="true" />)
const expandTableIconMarkup = renderToStaticMarkup(<Maximize2 aria-hidden="true" />)

const renderLocalMediaButton = (path: string, displayPath: string, name: string): string => {
  const video = Boolean(getVideoMimeType(path))
  return `<button${renderHtmlAttributes({
    class: `chat-detail__markdown-image${video ? ' chat-detail__markdown-video' : ''}`,
    type: 'button',
    title: `Open ${displayPath}`,
    'aria-label': `${video ? 'Play' : 'Open'} ${name}`,
    'data-local-image-path': path,
    'data-local-image-name': name,
    'data-media-type': video ? 'video' : 'image'
  })}><span class="chat-detail__markdown-image-loading" aria-label="Loading ${escapeHtml(name)}">${loadingImageIconMarkup}</span></button>`
}

export const createChatMarkdownRenderer = (interactiveFileLinks: boolean): Renderer => {
  const renderer = new Renderer()

  renderer.html = ({ text }) =>
    text
      .split(/(<\/?(?:details|summary)(?:\s+open)?\s*>|<\/?kbd\s*>)/gi)
      .map((part) =>
        /^(?:<\/?(?:details|summary)(?:\s+open)?\s*>|<\/?kbd\s*>)$/i.test(part)
          ? part
          : escapeHtml(part)
      )
      .join('')
  renderer.code = ({ lang, text }) => renderMarkdownCodeBlock(text, lang)
  renderer.link = function (token: Tokens.Link): string {
    const fileTarget = getMarkdownFileTarget(token.href)
    if (fileTarget && getVideoMimeType(fileTarget.path)) {
      return renderLocalMediaButton(
        fileTarget.path,
        fileTarget.displayPath,
        getMarkdownFileLinkLabel(token, fileTarget.line)
      )
    }
    if (fileTarget && interactiveFileLinks) {
      const label = getMarkdownFileLinkLabel(token, fileTarget.line)
      const fileName = fileTarget.displayPath.split('/').at(-1) ?? fileTarget.displayPath
      const iconMarkup = renderToStaticMarkup(
        <SymbolsFileIcon fileName={fileName} autoAssign aria-hidden="true" />
      )
      const title = fileTarget.line
        ? `Open ${fileTarget.displayPath} at line ${fileTarget.line}`
        : `Open ${fileTarget.displayPath}`
      const lineMarkup = fileTarget.line
        ? `<span class="chat-detail__file-link-separator" aria-hidden="true">·</span><span class="chat-detail__file-link-line" aria-label="Line ${fileTarget.line}">${fileTarget.line}</span>`
        : ''

      return `<button${renderHtmlAttributes({
        class: 'chat-detail__file-link',
        type: 'button',
        title,
        'data-file-link-path': fileTarget.path,
        'data-file-link-display-path': fileTarget.displayPath,
        'data-file-link-line': fileTarget.line
      })}><span class="chat-detail__file-link-icon" aria-hidden="true">${iconMarkup}</span><span class="chat-detail__file-link-label">${escapeHtml(label)}</span>${lineMarkup}</button>`
    }

    const href = token.href
    const title = token.title ?? undefined
    const children = this.parser.parseInline(token.tokens)
    const faviconUrl = getBrowserFaviconUrl(href)
    const faviconMarkup = faviconUrl
      ? `<img${renderHtmlAttributes({
          class: 'chat-detail__link-favicon',
          src: faviconUrl,
          alt: ' ',
          loading: 'lazy',
          referrerpolicy: 'no-referrer',
          'aria-hidden': 'true'
        })}>`
      : ''
    return `<a${renderHtmlAttributes({
      href,
      title,
      rel: 'noreferrer',
      target: '_blank'
    })}>${faviconMarkup}${children}</a>`
  }
  renderer.image = function (token: Tokens.Image): string {
    const fileTarget = getMarkdownFileTarget(token.href)
    if (!fileTarget) return defaultChatMarkdownRenderer.image.call(this, token)

    const fileName = fileTarget.displayPath.split('/').at(-1) ?? fileTarget.displayPath
    const name = token.text.trim() || fileName

    return renderLocalMediaButton(fileTarget.path, fileTarget.displayPath, name)
  }
  renderer.table = function (token: Tokens.Table): string {
    const tableMarkup = defaultChatMarkdownRenderer.table.call(this, token)
    const renderedTable = tableMarkup.replace('<table>', '<table class="chat-detail__table">')
    return `<div class="chat-detail__table-frame"><div class="chat-detail__table-scroll">${renderedTable}</div><button class="chat-detail__table-expand" type="button" aria-label="Expand table" aria-haspopup="dialog" title="Expand table">${expandTableIconMarkup}</button></div>`
  }

  return renderer
}
