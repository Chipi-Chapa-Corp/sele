type OpenCodeSessionEvent = {
  type: string
  sessionID: string
  directory: string | null
  properties: Record<string, unknown>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

export const parseOpenCodeSessionEvent = (globalEvent: unknown): OpenCodeSessionEvent | null => {
  if (!isRecord(globalEvent) || !isRecord(globalEvent.payload)) return null
  const type = getString(globalEvent.payload.type)
  const properties = isRecord(globalEvent.payload.properties)
    ? globalEvent.payload.properties
    : isRecord(globalEvent.payload.data)
      ? globalEvent.payload.data
      : null
  if (!type || !properties) return null

  // The event ID and a generic `properties.id` identify the event or its
  // resource. Only `sessionID` is safe to pass to OpenCode's session API.
  const sessionID = getString(properties.sessionID)
  if (!sessionID) return null

  return {
    type,
    sessionID,
    directory: getString(globalEvent.directory),
    properties
  }
}
