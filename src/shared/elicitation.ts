export const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

export function getElicitationDefaults(schema: Record<string, unknown>): Record<string, unknown> {
  const fields = record(schema.properties) ?? {}
  return Object.fromEntries(
    Object.entries(fields).flatMap(([key, value]) => {
      const field = record(value)
      if (field?.default !== undefined && field.default !== null) return [[key, field.default]]
      if (
        field?.type === 'boolean' &&
        Array.isArray(schema.required) &&
        schema.required.includes(key)
      )
        return [[key, false]]
      return []
    })
  )
}
