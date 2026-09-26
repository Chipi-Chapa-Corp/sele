type ClaudePluginEntry = {
  pluginId?: string
  id?: string
  name?: string
  marketplaceName?: string
  enabled?: boolean
  status?: string
}

export type ClaudePluginInventory = {
  installed: ClaudePluginEntry[]
  available: ClaudePluginEntry[]
}

export const parseClaudePluginInventory = (value: string): ClaudePluginInventory => {
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Claude returned an invalid plugin list')
  }
  const inventory = parsed as Record<string, unknown>
  if (!Array.isArray(inventory.installed) || !Array.isArray(inventory.available)) {
    throw new Error('Claude returned an invalid plugin list')
  }
  return {
    installed: inventory.installed.filter(
      (entry): entry is ClaudePluginEntry =>
        entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    ),
    available: inventory.available.filter(
      (entry): entry is ClaudePluginEntry =>
        entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    )
  }
}

export const getClaudePluginIdForSkillPath = (path: string): string | null => {
  const normalized = path.replace(/\\/g, '/')
  const marketplace = /(?:^|\/)plugins\/marketplaces\/([^/]+)\/(?:plugins|external_plugins)\/([^/]+)\//.exec(
    normalized
  )
  if (marketplace) return `${marketplace[2]}@${marketplace[1]}`
  const cache = /(?:^|\/)plugins\/cache\/([^/]+)\/([^/]+)\//.exec(normalized)
  return cache ? `${cache[2]}@${cache[1]}` : null
}

export const getClaudePluginEntryId = (entry: ClaudePluginEntry): string | null => {
  if (typeof entry.pluginId === 'string' && entry.pluginId) return entry.pluginId
  if (typeof entry.id === 'string' && entry.id) return entry.id
  return typeof entry.name === 'string' && typeof entry.marketplaceName === 'string'
    ? `${entry.name}@${entry.marketplaceName}`
    : null
}

export const getClaudePluginState = (
  inventory: ClaudePluginInventory,
  pluginId: string
): 'unavailable' | 'available' | 'disabled' | 'enabled' => {
  const installed = inventory.installed.find((entry) => getClaudePluginEntryId(entry) === pluginId)
  if (installed) {
    return installed.enabled === false || installed.status === 'disabled' ? 'disabled' : 'enabled'
  }
  return inventory.available.some((entry) => getClaudePluginEntryId(entry) === pluginId)
    ? 'available'
    : 'unavailable'
}

export const getClaudeSkillInvocation = (name: string, path: string): string => {
  const pluginId = getClaudePluginIdForSkillPath(path)
  return pluginId && !name.includes(':') ? `/${pluginId.split('@')[0]}:${name}` : `/${name}`
}
