import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { app } from 'electron'
import { join } from 'node:path'
import { isExpectedClaudeQueryShutdownError } from './ClaudeExpectedErrors'
import {
  createVisualizationTools,
  visualizationToolInstructions
} from '../../visualization/VisualizationTools'
import { visualizationServerName } from '../VisualizationToolPresentation'

export { visualizationServerName }

export const getVisualizationDirectory = (chatId: string): string =>
  join(app.getPath('userData'), 'visualizations', chatId.replace(/[^A-Za-z0-9_-]/g, '_'))

/** Gives Claude the inline widget tools that claude.ai provides, rendered by Sele's own frame. */
export function createClaudeVisualizationIntegration(chatId: string): {
  server: ReturnType<typeof createSdkMcpServer>
  close(): void
} {
  const server = createSdkMcpServer({
    name: visualizationServerName,
    version: '1.0.0',
    instructions: visualizationToolInstructions,
    tools: createVisualizationTools(getVisualizationDirectory(chatId)).map((definition) =>
      tool(
        definition.name,
        definition.description,
        definition.schema.shape,
        (args) => definition.execute(args),
        { alwaysLoad: true, annotations: { readOnlyHint: true } }
      )
    )
  })
  return {
    server,
    close: () => {
      void server.instance.close().catch((error: unknown) => {
        if (isExpectedClaudeQueryShutdownError(error)) return
        console.error('Unable to close Claude visualization MCP server.', error)
      })
    }
  }
}
