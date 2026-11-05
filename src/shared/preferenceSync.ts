/** Current navigation belongs to a device. All
 * configuration, drafts and durable chat/workspace state belong to the host. */
export const isLocalPreference = (key: string): boolean =>
  key === 'sele:chat-sidebar-filter:v1' || key.startsWith('sele:browser-tabs:')

export const preferencesChangedChannel = 'sele:preferences-changed'
