/** Reserved Sele workspace paths keep general chats recognizable after restarting. */
export const noProjectWorkspaceDirectory = 'sele-no-project'
export const noProjectGroupKey = 'cwd:no-project'

export const isNoProjectCwd = (cwd: string | null | undefined): boolean =>
  /(?:^|[\\/])sele-no-project[\\/][a-f0-9-]{36}[\\/]?$/.test(cwd ?? '')

/** The saved choice takes precedence over the provider's runtime directory. */
export const isNoProjectChat = (
  chat: { noProject?: boolean; cwd?: string | null } | null | undefined
): boolean => Boolean(chat && (chat.noProject || isNoProjectCwd(chat.cwd)))
