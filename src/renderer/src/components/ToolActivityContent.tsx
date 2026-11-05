import 'react-diff-view/style/index.css'
import type { ProviderWorkingTool } from '../../../shared/provider'
import { getInputLanguage,getOutputLanguage,getToolValueLanguage } from '../toolValueLanguage'
import { BoundedHighlightedCode } from './BoundedHighlightedCode'
import './ChatDetailItem.css'
import { HighlightedCode } from './HighlightedCode'
import { ToolDiff } from './ToolDiff'
import './UnifiedDiff.css'

export const hasToolValue = (value: unknown): boolean =>
  value != null && (typeof value !== 'string' || value.trim().length > 0)


export const DiffContent: React.FC<{
  tools: ProviderWorkingTool[]
  projectCwd?: string | null
}> = ({ tools, projectCwd }) => (
  <div className="chat-detail__activity-content">
    {tools.flatMap((tool) =>
      tool.diffs.map((diff, index) => (
        <ToolDiff
          fileDiff={diff}
          key={`${tool.id}:${diff.path}:${index}`}
          projectCwd={projectCwd}
        />
      ))
    )}
  </div>
)

export const CommandContent: React.FC<{ tools: ProviderWorkingTool[] }> = ({ tools }) => (
  <div className="chat-detail__activity-content chat-detail__activity-content--command">
    {tools.map((tool) => (
      <section key={tool.id}>
        {tool.command && (
          <HighlightedCode language={getInputLanguage(tool.command)}>
            {tool.command}
          </HighlightedCode>
        )}
        {tool.command && tool.stdout && (
          <span className="chat-detail__command-divider" aria-hidden="true" />
        )}
        {tool.stdout && (
          <BoundedHighlightedCode language={getOutputLanguage(tool.stdout)}>
            {tool.stdout}
          </BoundedHighlightedCode>
        )}
      </section>
    ))}
  </div>
)

export const formatToolValue = (value: unknown): string => {
  if (value == null) return 'null'
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch (error) {
    console.error('[caught:ChatDetailItem:formatToolValue]', error)
    return String(value)
  }
}

export const RawContent: React.FC<{ tools: ProviderWorkingTool[] }> = ({ tools }) => (
  <div className="chat-detail__activity-content chat-detail__activity-content--command">
    {tools.map((tool) => (
      <section key={tool.id}>
        {hasToolValue(tool.rawInput) && (
          <HighlightedCode language={getToolValueLanguage(tool.rawInput, true)}>
            {formatToolValue(tool.rawInput)}
          </HighlightedCode>
        )}
        {hasToolValue(tool.rawInput) && hasToolValue(tool.rawOutput) && (
          <span className="chat-detail__command-divider" aria-hidden="true" />
        )}
        {hasToolValue(tool.rawOutput) && (
          <BoundedHighlightedCode language={getToolValueLanguage(tool.rawOutput)}>
            {formatToolValue(tool.rawOutput)}
          </BoundedHighlightedCode>
        )}
      </section>
    ))}
  </div>
)
