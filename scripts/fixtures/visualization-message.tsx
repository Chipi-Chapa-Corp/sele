import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MarkdownMessage } from '../../src/renderer/src/components/ChatDetailItem'
import '../../src/renderer/src/assets/main.css'

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
  return (
    <>
      <button id="send-message" onClick={() => setMessages((count) => count + 1)}>
        Send message
      </button>
      <MarkdownMessage
        className="test-message chat-detail__message chat-detail__message--assistant"
        content={content}
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
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConversationFixture />
  </StrictMode>
)
