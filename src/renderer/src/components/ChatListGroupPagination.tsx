import { ChevronDown, ChevronUp } from 'lucide-react'
import { formatProjectLabel } from '../projectPresentation'
import { Button } from './Button'
import type { ChatListGroupProps } from './ChatListGroup'
import { appMaxChatsRenderedDefault } from '../performanceSettings'

export function ChatListGroupPagination({
  group,
  visibleChatCount = group.chats.length,
  chatPageSize = appMaxChatsRenderedDefault,
  onLoadMoreChats,
  onShowLessChats
}: Pick<
  ChatListGroupProps,
  'group' | 'visibleChatCount' | 'chatPageSize' | 'onLoadMoreChats' | 'onShowLessChats'
>) {
  const groupLabel =
    group.kind === 'cwd'
      ? group.projectName?.trim() || formatProjectLabel(group.label)
      : group.label
  const remainingChatCount = Math.max(0, group.chats.length - visibleChatCount)
  const nextChatCount = Math.min(chatPageSize, remainingChatCount)
  const canShowLessChats = visibleChatCount > chatPageSize
  const showChatPaginationActions =
    (remainingChatCount > 0 && onLoadMoreChats) || (canShowLessChats && onShowLessChats)
  return showChatPaginationActions ? (
    <div className="chat-list-group__more">
      {canShowLessChats && onShowLessChats && (
        <Button
          theme="secondary"
          size="small"
          fill
          aria-label={`Show fewer ${groupLabel} chats`}
          title="Show less"
          callback={() => onShowLessChats(group)}
          icon={<ChevronUp aria-hidden="true" />}
          label="Show less"
        />
      )}
      {remainingChatCount > 0 && onLoadMoreChats && (
        <Button
          theme="secondary"
          size="small"
          fill
          aria-label={`Load next ${nextChatCount} ${groupLabel} chats`}
          title={`Load next ${nextChatCount} chats`}
          callback={() => onLoadMoreChats(group)}
          icon={<ChevronDown aria-hidden="true" />}
          label={`Load next ${nextChatCount}`}
        />
      )}
    </div>
  ) : null
}
