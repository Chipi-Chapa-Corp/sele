import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MarkdownMessage } from '../../../src/renderer/src/components/ChatDetailItem'
import '../../../src/renderer/src/assets/main.css'

const marker = 'visualize{"path":"/work/visualization-test.html"}'
const content = `Before the visualization.\n\n${marker}\n\nAfter the visualization.

| Name | Value |
| --- | --- |
| Example | 42 |

\`\`\`text
${marker}
\`\`\``

export function ConversationFixture(): React.JSX.Element {
  const [messages, setMessages] = useState(0)
  const [tail, setTail] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [nested, setNested] = useState(false)
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
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConversationFixture />
  </StrictMode>
)
