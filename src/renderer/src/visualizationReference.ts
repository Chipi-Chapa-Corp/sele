import type { TokenizerExtension, RendererExtension } from 'marked'

export type VisualizationReference = { path: string; title?: string; mode?: 'wide' }

export function parseVisualizationReference(value: string): VisualizationReference | null {
  try {
    const data = JSON.parse(value)
    if (
      !data ||
      typeof data.path !== 'string' ||
      !/^(?:\/|[a-zA-Z]:[\\/])/.test(data.path) ||
      !/\.html?$/i.test(data.path) ||
      Array.from(data.path as string).some((character) => character.charCodeAt(0) < 32) ||
      (data.mode !== undefined && data.mode !== 'wide') ||
      (data.title !== undefined && typeof data.title !== 'string')
    )
      return null
    return { path: data.path, title: data.title, mode: data.mode }
  } catch {
    return null
  }
}

// A block extension keeps examples in code fences and inline code as literal text.
export const visualizationExtension: TokenizerExtension & RendererExtension = {
  name: 'visualization',
  level: 'block',
  start: (source) => source.indexOf('visualize'),
  tokenizer(source) {
    const match = /^visualize([^\n]*?)(?:[ \t]*(?:\n|$))/.exec(source)
    if (!match) return undefined
    const reference = parseVisualizationReference(match[1])
    if (!reference) return undefined
    return { type: 'visualization', raw: match[0], reference }
  },
  renderer(token) {
    const reference = encodeURIComponent(JSON.stringify(token.reference)).replace(/'/g, '%27')
    return `<div data-visualization="${reference}"></div>`
  }
}

export function decodeVisualizationReference(value: string): VisualizationReference | null {
  try {
    return parseVisualizationReference(decodeURIComponent(value))
  } catch {
    return null
  }
}
