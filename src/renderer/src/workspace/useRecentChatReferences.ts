import { startTransition, useEffect, useMemo, useState } from 'react'
import type { ProviderChatItem, ProviderMessage } from '../../../shared/provider'
import { requestChatReferences } from '../chatMarkdownClient'
import type { RecentChatReference } from '../chatRecents'
import { appRecentsMessageLimitDefault } from '../performanceSettings'

import { useShallowStable } from './stableProps'

const emptyReferences: RecentChatReference[] = []

const equalReferences = (before: RecentChatReference[], after: RecentChatReference[]): boolean =>
  before.length === after.length &&
  before.every((reference, index) => {
    const next = after[index]
    return (
      reference.kind === next.kind &&
      reference.messageId === next.messageId &&
      reference.role === next.role &&
      reference.label === next.label &&
      (reference.kind === 'file' && next.kind === 'file'
        ? reference.path === next.path &&
          reference.displayPath === next.displayPath &&
          reference.line === next.line &&
          reference.endLine === next.endLine
        : reference.kind === 'link' && next.kind === 'link' && reference.href === next.href)
    )
  })

/** Parse links off the UI thread; superseded revisions must never publish into another chat. */
export function useRecentChatReferences(
  items: readonly ProviderChatItem[],
  messageLimit: number,
  chatKey: string | null
): RecentChatReference[] {
  const [snapshot, setSnapshot] = useState<{
    chatKey: string | null
    references: RecentChatReference[]
  } | null>(null)
  // Do not clone tool output or entire transcripts into the worker. Unchanged
  // message objects retain their identity even when the provider sends a snapshot.
  const messages = useShallowStable(
    useMemo(() => {
      const limit = Number.isFinite(messageLimit)
        ? Math.max(0, Math.floor(messageLimit))
        : appRecentsMessageLimitDefault
      const recent: ProviderMessage[] = []
      for (let index = items.length - 1; index >= 0 && recent.length < limit; index--) {
        const message = items[index]
        if (message.type !== 'message') continue
        recent.push(message)
      }
      return recent.reverse()
    }, [items, messageLimit])
  )
  useEffect(() => {
    if (!chatKey) return
    if (!messages.length) {
      setSnapshot((current) =>
        current?.references.length ? { chatKey, references: emptyReferences } : current
      )
      return
    }
    let active = true
    const request = requestChatReferences(
      messages.map((message) => ({
        type: 'message',
        id: message.id,
        role: message.role,
        content: message.content,
        contentLoaded: message.contentLoaded,
        // Reference extraction needs paths, never the image bytes.
        attachments: message.attachments?.map((attachment) =>
          attachment.kind === 'image'
            ? { kind: 'image', name: attachment.name, path: attachment.path }
            : attachment
        )
      })),
      messageLimit
    )
    void request.result
      .then((references) => {
        if (!active) return
        startTransition(() =>
          setSnapshot((current) =>
            current?.chatKey === chatKey && equalReferences(current.references, references)
              ? current
              : { chatKey, references }
          )
        )
      })
      .catch((error: unknown) => {
        if (active) console.error('Unable to read recent chat references.', error)
      })
    return () => {
      active = false
      request.cancel()
    }
  }, [chatKey, messages, messageLimit])
  return snapshot?.chatKey === chatKey ? snapshot.references : emptyReferences
}
