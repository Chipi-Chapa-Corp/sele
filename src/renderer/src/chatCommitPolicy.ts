export const getChatCommitLaunchMode = (sourceChatId: string | null): 'new' | 'fork' =>
  sourceChatId === null ? 'new' : 'fork'

export const isChatCommitProjectLocked = (
  activeProjectCommitCount: number,
  aiCommitStarting: boolean
): boolean => activeProjectCommitCount > 0 || aiCommitStarting
