import { createRoot } from 'react-dom/client'
import { MarkdownMessage } from '../../../src/renderer/src/components/ChatDetailItem'
import '../../../src/renderer/src/assets/main.css'

createRoot(document.getElementById('root')!).render(
  <MarkdownMessage
    className="chat-detail__message chat-detail__message--assistant"
    content={
      '[Demo](./demo.webm)\n\n![Embedded](./embedded.MP4)\n\n[Missing](./missing.webm)\n\n![Image](./image.png)'
    }
    localImageContainer={{
      kind: 'container',
      tool: 'ssh',
      name: 'test',
      runtime: { kind: 'host' }
    }}
    localImageCwd="/work"
    onOpenFileLink={() => {
      throw new Error('Video opened as a file')
    }}
  />
)
