export const chatSleepStorageKey = 'sele:sleeping-chats:v1'
export const legacyChatBookmarksStorageKey = 'sele:bookmarked-chats:v1'
export type ChatWakeAt = number | null
export type ChatSleepSnapshot = { revision: number; sleeping: Record<string, ChatWakeAt> }
export type ChatSleepChange = { key: string; wakeAt: ChatWakeAt | false; expected?: ChatWakeAt }
