import type {
  ProviderToolActivity,
  ProviderToolIcon,
  ProviderToolVisualization
} from '../../shared/provider'
import { getString, isRecord } from './providerValues.ts'

/** Sele's inline widget server mirrors the `visualize` tool names Claude already knows. */
export const visualizationServerName = 'visualize'
export const showWidgetToolName = 'show_widget'
export const readMeToolName = 'read_me'
export const visualizationToolNames = [readMeToolName, showWidgetToolName].map(
  (tool) => `mcp__${visualizationServerName}__${tool}`
)

/** Marks a show_widget result so arbitrary tool text cannot be mistaken for a widget. */
export const widgetResultMarker = 'sele_visualization'

const htmlPath = /\.html?$/i
const absolutePath = /^(?:\/|[a-zA-Z]:[\\/])/

export const getVisualizationToolPresentation = (
  names: string[],
  input: unknown,
  provider: string
): {
  activity: ProviderToolActivity
  icon: ProviderToolIcon
  label: string
  compact?: boolean
  hidePayload?: boolean
} | null => {
  for (const name of names) {
    const tool = name.match(/^(?:mcp__)?visualize(?:__|\/)(show_widget|read_me)$/)?.[1]
    if (tool === showWidgetToolName)
      return {
        activity: 'other',
        icon: 'visualization',
        label: 'Showed visualization',
        hidePayload: true
      }
    if (tool === readMeToolName)
      return {
        activity: 'read',
        icon: 'visualization',
        label: 'Read visualization guide',
        compact: true,
        hidePayload: true
      }
  }
  // Claude Code's own Artifact tool publishes a local HTML file to a hosted page.
  if (provider !== 'claude' || names[0] !== 'Artifact') return null
  const action = (isRecord(input) && getString(input.action)) || 'publish'
  if (action === 'publish')
    return {
      activity: 'other',
      icon: 'visualization',
      label: 'Published artifact'
    }
  if (action === 'list')
    return {
      activity: 'read',
      label: 'Listed artifacts',
      icon: 'visualization',
      compact: true
    }
  if (action === 'read')
    return {
      activity: 'read',
      label: 'Read artifact',
      icon: 'visualization',
      compact: true
    }
  return null
}

const getResultText = (result: unknown): string | null => {
  if (typeof result === 'string') return result
  const blocks = Array.isArray(result) ? result : isRecord(result) ? result.content : null
  if (!Array.isArray(blocks)) return null
  for (const block of blocks)
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string')
      return block.text
  return null
}

const getWidgetVisualization = (result: unknown): ProviderToolVisualization | undefined => {
  const text = getResultText(result)
  if (!text?.includes(widgetResultMarker)) return undefined
  try {
    const data: unknown = JSON.parse(text)
    if (!isRecord(data) || data[widgetResultMarker] !== true) return undefined
    const path = getString(data.path)
    if (!path || !absolutePath.test(path) || !htmlPath.test(path)) return undefined
    // Widget titles are snake_case identifiers; show them as a readable heading.
    const title = getString(data.title)?.replace(/[_-]+/g, ' ').trim()
    return {
      path,
      location: 'host',
      ...(title ? { title: title[0].toUpperCase() + title.slice(1) } : {})
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
}

const getArtifactVisualization = (
  input: unknown,
  result: unknown
): ProviderToolVisualization | undefined => {
  if (!isRecord(result)) return undefined
  const url = getString(result.url)
  const path = getString(result.path) ?? (isRecord(input) ? getString(input.file_path) : null)
  // Markdown artifacts and non-publish actions have no HTML document to preview.
  if (!url || !path || !htmlPath.test(path)) return undefined
  const title = getString(result.title) ?? (isRecord(input) ? getString(input.title) : null)
  return {
    path,
    location: 'workspace',
    ...(title ? { title } : {}),
    ...(/^https:\/\//i.test(url) ? { url } : {})
  }
}

/** Resolves a finished visualization tool's result to the document the chat should display. */
export const getToolVisualization = (
  tool: { icon: ProviderToolIcon | null; rawInput: unknown },
  result: unknown,
  failed: boolean
): ProviderToolVisualization | undefined => {
  if (tool.icon !== 'visualization' || failed) return undefined
  return getWidgetVisualization(result) ?? getArtifactVisualization(tool.rawInput, result)
}
