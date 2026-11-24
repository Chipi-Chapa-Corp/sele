import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ChatDetailItem,
  MarkdownMessage
} from '../../../src/renderer/src/components/ChatDetailItem'
import { unloadWorkingStepItems } from '../../../src/shared/chatTurns'
import type { ProviderWorkingStep, ProviderWorkingTool } from '../../../src/shared/provider'
import '../../../src/renderer/src/assets/main.css'

const marker = 'visualize{"path":"/work/visualization-test.html"}'
const content = `Before the visualization.\n\n${marker}\n\nAfter the visualization.

| Name | Value |
| --- | --- |
| Example | 42 |

\`\`\`text
${marker}
\`\`\``

const visualizationTool = (
  id: string,
  visualization?: ProviderWorkingTool['visualization']
): ProviderWorkingTool => ({
  type: 'tool',
  id,
  toolId: id,
  status: 'finished',
  activity: 'other',
  icon: visualization ? 'visualization' : null,
  label: visualization ? 'Showed visualization' : 'Ran a command',
  command: null,
  cwd: null,
  stdout: null,
  diffs: [],
  backgroundSessionId: null,
  finishedBackgroundSessionId: null,
  rawInput: null,
  rawOutput: null,
  images: [],
  ...(visualization ? { visualization } : {})
})

// A finished Claude turn: the step collapses, but its widget and artifact stay visible.
const workedStep: ProviderWorkingStep = {
  type: 'working',
  id: 'tool-step',
  status: 'worked',
  items: [
    visualizationTool('bash'),
    visualizationTool('widget', {
      path: '/data/visualizations/chat/load-curve.html',
      location: 'host',
      title: 'Load curve'
    }),
    visualizationTool('artifact', {
      path: 'report.html',
      location: 'workspace',
      title: 'Quarterly report',
      url: 'https://claude.ai/artifact/report'
    })
  ]
}

export function ToolVisualizationFixture(): React.JSX.Element {
  return (
    <div className="test-tool-steps">
      <ChatDetailItem
        item={workedStep}
        container={{
          kind: 'container',
          tool: 'ssh',
          name: 'test-workspace',
          runtime: { kind: 'host' }
        }}
        cwd="/work"
      />
      <div className="test-unloaded-step">
        <ChatDetailItem item={unloadWorkingStepItems({ ...workedStep, id: 'unloaded-step' })} />
      </div>
    </div>
  )
}

export function ConversationFixture(): React.JSX.Element {
  const [messages, setMessages] = useState(0)
  const [tail, setTail] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [nested, setNested] = useState(false)
  const [toolSteps, setToolSteps] = useState(false)
  return (
    <>
      <button id="send-message" onClick={() => setMessages((count) => count + 1)}>
        Send message
      </button>
      <button
        id="stream-chunk"
        onClick={() => {
          setStreaming(true)
          setTail((value) => `${value}\n\nStreamed paragraph with **formatted text**.`)
        }}
      >
        Stream chunk
      </button>
      <button id="finish-stream" onClick={() => setStreaming(false)}>
        Finish stream
      </button>
      <button id="show-tool-steps" onClick={() => setToolSteps(true)}>
        Show tool visualizations
      </button>
      <button id="show-nested" onClick={() => setNested(true)}>
        Show nested visualizations
      </button>
      <MarkdownMessage
        className="test-message chat-detail__message chat-detail__message--assistant"
        content={content + tail}
        streaming={streaming}
        localImageContainer={{
          kind: 'container',
          tool: 'ssh',
          name: 'test-workspace',
          runtime: { kind: 'host' }
        }}
        localImageCwd="/work"
        onOpenFileLink={() => {}}
      />
      {messages > 0 && (
        <MarkdownMessage className="test-new-message" content={`Message ${messages}`} />
      )}
      {nested && (
        <MarkdownMessage
          className="test-nested-message chat-detail__message"
          content={`> Before.\n>\n> ${marker}\n>\n> ${marker}\n>\n> After.${tail}`}
          localImageCwd="/work"
          streaming={streaming}
        />
      )}
      {toolSteps && <ToolVisualizationFixture />}
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConversationFixture />
  </StrictMode>
)
