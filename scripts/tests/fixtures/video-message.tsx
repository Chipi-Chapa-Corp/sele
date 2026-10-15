import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { getProviderChatTurns } from '../../../src/shared/chatTurns'
import type { ProviderChatItem } from '../../../src/shared/provider'
import { ChatDetailItem } from '../../../src/renderer/src/components/ChatDetailItem'
import { ChatMediaGallery } from '../../../src/renderer/src/components/ChatMediaGallery'
import '../../../src/renderer/src/assets/main.css'

const container = {
  kind: 'container' as const,
  tool: 'ssh' as const,
  name: 'test',
  runtime: { kind: 'host' as const }
}
const options = { container, cwd: '/work', relativeTo: 'cwd' as const }
const items: ProviderChatItem[] = [
  {
    type: 'message',
    id: 'user',
    role: 'user',
    content: '',
    attachments: [
      { kind: 'image', name: 'Attachment one', path: './attachment.png' },
      { kind: 'image', name: 'Attachment two', path: './attachment.png' }
    ]
  },
  {
    type: 'message',
    id: 'response',
    role: 'assistant',
    content:
      '[Demo](./demo.webm)\n\n![Embedded](./embedded.MP4)\n\n[Missing](./missing.webm)\n\n![Image](./image.png)\n\n[Image file link](./excluded.png)\n\n[Website](https://example.com)'
  },
  { type: 'message', id: 'later', role: 'user', content: 'Next turn' },
  {
    type: 'message',
    id: 'later-response',
    role: 'assistant',
    content: '![Later image](./later.png)\n\n![Remote](https://example.com/remote.png)'
  }
]
const turns = getProviderChatTurns(items)

function Fixture(): React.ReactElement {
  const [page, setPage] = useState('all')
  const [chat, setChat] = useState('main')
  const displayed = page === 'later' ? turns.slice(1) : turns
  return (
    <>
      <button id="later-page" onClick={() => setPage('later')}>
        Later page
      </button>
      <button id="all-pages" onClick={() => setPage('all')}>
        All pages
      </button>
      <button id="switch-chat" onClick={() => setChat('other')}>
        Other chat
      </button>
      <ChatMediaGallery
        key={chat}
        turns={chat === 'other' ? turns.slice(1) : displayed}
        startIndex={page === 'later' ? 1 : 0}
        totalCount={2}
        localImageOptions={options}
      >
        {(chat === 'other' ? turns.slice(1) : displayed)
          .flatMap((turn) => turn.items)
          .map((item) => (
            <ChatDetailItem
              key={item.id}
              item={item}
              container={container}
              cwd="/work"
              onOpenFileLink={() => {}}
            />
          ))}
      </ChatMediaGallery>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
