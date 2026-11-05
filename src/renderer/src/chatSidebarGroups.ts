import type { ChatListGroupData } from './components/ChatListGroup'

/** Keep unrelated project groups and the whole list stable across workspace updates. */
export const reuseChatGroups = (
  groups: ChatListGroupData[],
  previous: ChatListGroupData[]
): ChatListGroupData[] => {
  const byKey = new Map(previous.map((group) => [group.key, group]))
  const next = groups.map((group) => {
    const before = byKey.get(group.key)
    return before &&
      before.chats === group.chats &&
      before.cwd === group.cwd &&
      before.label === group.label &&
      before.kind === group.kind &&
      before.projectName === group.projectName &&
      before.hasWorkingChat === group.hasWorkingChat
      ? before
      : group
  })
  return next.length === previous.length && next.every((group, index) => group === previous[index])
    ? previous
    : next
}
