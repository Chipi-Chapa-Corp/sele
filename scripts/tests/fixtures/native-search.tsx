import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useSidebarSearch } from '../../../src/renderer/src/workspace/useSidebarSearch'

// biome-ignore lint/suspicious/noExplicitAny: this isolated fixture exposes a dynamic test bridge
const fixture = window as unknown as Record<string, any>
fixture.requests = []
fixture.deferred = {}
fixture.providerApi = {
  getChats: async (_provider, options) => {
    fixture.requests.push(options)
    if (options.searchTerm === 'stale') {
      return new Promise((resolve) => {
        fixture.deferred.sidebar = resolve
      })
    }
    if (options.searchTerm === 'error') throw new Error('Fixture search failed')
    return {
      chats: [
        {
          id: options.cursor ? 'older-chat' : 'matching-chat',
          providerId: 'codex',
          title: 'Unrelated title',
          preview: options.searchTerm
        }
      ],
      nextCursor: options.cursor ? null : 'sidebar-next'
    }
  }
}

function Fixture() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(true)
  const sidebar = useSidebarSearch(query, [null], open)
  fixture.setQuery = (value) => flushSync(() => setQuery(value))
  fixture.setOpen = (value) => flushSync(() => setOpen(value))
  fixture.sidebar = sidebar
  return (
    <main>
      <input
        aria-label="Search conversations"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p role="status">{sidebar.loading ? 'Searching…' : sidebar.error}</p>
      <ul>
        {sidebar.chats.map((chat) => (
          <li key={chat.id}>
            {chat.title}: {chat.preview}
          </li>
        ))}
      </ul>
      {sidebar.hasMore && (
        <button disabled={sidebar.loading} onClick={sidebar.loadMore}>
          More search results
        </button>
      )}
    </main>
  )
}
flushSync(() => createRoot(document.getElementById('root')!).render(<Fixture />))
fixture.ready = true
