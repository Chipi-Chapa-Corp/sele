import type { ProviderConfigField, ProviderConfigValue } from '../../../shared/provider'

const safeKey = (key: string): boolean => !['__proto__', 'prototype', 'constructor'].includes(key)
const isObject = (value: unknown): value is Record<string, ProviderConfigValue> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export function validateConfigValue(
  schema: ProviderConfigField,
  value: unknown
): asserts value is ProviderConfigValue {
  if (
    schema.enum &&
    !schema.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))
  )
    throw new Error('Choose an allowed value')
  switch (schema.type) {
    case 'boolean':
      if (typeof value !== 'boolean') throw new Error('Expected a boolean')
      break
    case 'string':
      if (typeof value !== 'string') throw new Error('Expected text')
      break
    case 'integer':
    case 'number':
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (schema.type === 'integer' && !Number.isInteger(value))
      )
        throw new Error('Expected a valid number')
      if (schema.minimum !== undefined && value < schema.minimum)
        throw new Error(`Minimum is ${schema.minimum}`)
      if (schema.maximum !== undefined && value > schema.maximum)
        throw new Error(`Maximum is ${schema.maximum}`)
      break
    case 'array':
      if (!Array.isArray(value) || !schema.items) throw new Error('Expected a list')
      value.forEach((item) => validateConfigValue(schema.items!, item))
      break
    case 'object':
      if (!isObject(value)) throw new Error('Expected an object')
      for (const key of schema.required ?? [])
        if (!Object.hasOwn(value, key)) throw new Error(`Missing ${key}`)
      for (const [key, child] of Object.entries(value)) {
        const field = schema.properties?.[key] ?? schema.additionalProperties
        if (!safeKey(key) || !field) throw new Error(`Unknown setting: ${key}`)
        validateConfigValue(field, child)
      }
      break
    default:
      throw new Error('This setting is not supported by the editor')
  }
}

export function updateConfigFeatureValue(
  schema: ProviderConfigField | undefined,
  current: ProviderConfigValue | undefined,
  path: string[],
  value: ProviderConfigValue,
  enabled: boolean
): ProviderConfigValue {
  if (!path.length) {
    if (typeof value !== 'boolean') throw new Error('Expected a boolean')
    if (schema?.type === 'object') {
      if (schema.properties?.enabled?.type !== 'boolean')
        throw new Error('This feature has no enabled field')
      return updateConfigFeatureValue(schema, current, ['enabled'], value, enabled)
    }
    if (isObject(current)) throw new Error('The schema for this feature is unavailable')
    return value
  }
  if (!schema || path.length > 12) throw new Error('Unknown setting')
  let field = schema
  for (const key of path) {
    if (!safeKey(key) || field.type !== 'object') throw new Error('Invalid setting path')
    const child = field.properties?.[key] ?? field.additionalProperties
    if (!child) throw new Error(`Unknown setting: ${key}`)
    field = child
  }
  validateConfigValue(field, value)
  const result: Record<string, ProviderConfigValue> = isObject(current)
    ? structuredClone(current)
    : schema.properties?.enabled?.type === 'boolean'
      ? { enabled: typeof current === 'boolean' ? current : enabled }
      : {}
  let target = result
  for (const key of path.slice(0, -1)) {
    if (!isObject(target[key])) target[key] = {}
    target = target[key] as Record<string, ProviderConfigValue>
  }
  target[path[path.length - 1]] = value
  return result
}
