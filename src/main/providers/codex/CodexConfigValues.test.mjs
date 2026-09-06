import assert from 'node:assert/strict'
import test from 'node:test'
import { codexFeatureSchemas } from './CodexFeatureSchemas.ts'
import { updateConfigFeatureValue, validateConfigValue } from './CodexConfigValues.ts'

test('editing a nested field preserves siblings, unknown fields, and the original input', () => {
  const original = { enabled: false, excluded_tool_namespaces: ['secret'], future_option: 42 }
  const result = updateConfigFeatureValue(
    codexFeatureSchemas.code_mode,
    original,
    ['default_exec_yield_time_ms'],
    1200,
    false
  )
  assert.deepEqual(result, { ...original, default_exec_yield_time_ms: 1200 })
  assert.equal(original.default_exec_yield_time_ms, undefined)
})

test('converting a boolean feature preserves its disabled state when supported', () => {
  assert.deepEqual(
    updateConfigFeatureValue(
      codexFeatureSchemas.code_mode,
      false,
      ['excluded_tool_namespaces'],
      ['web'],
      false
    ),
    { enabled: false, excluded_tool_namespaces: ['web'] }
  )
})

test('context management has no invented enabled field', () => {
  assert.deepEqual(
    updateConfigFeatureValue(
      codexFeatureSchemas.context_management,
      true,
      ['experimental_mode'],
      true,
      true
    ),
    { experimental_mode: true }
  )
  assert.throws(
    () =>
      updateConfigFeatureValue(codexFeatureSchemas.context_management, {}, ['enabled'], true, true),
    /Unknown setting/
  )
  assert.throws(
    () => updateConfigFeatureValue(codexFeatureSchemas.context_management, {}, [], false, true),
    /no enabled field/
  )
})

test('toggling structured features retains their advanced values', () => {
  assert.deepEqual(
    updateConfigFeatureValue(
      codexFeatureSchemas.code_mode,
      { enabled: true, excluded_tool_namespaces: ['web'] },
      [],
      false,
      true
    ),
    { enabled: false, excluded_tool_namespaces: ['web'] }
  )
  assert.throws(
    () => updateConfigFeatureValue(undefined, { future: 1 }, [], false, true),
    /unavailable/
  )
})

test('validates numeric, enum, array, object, and unsafe path inputs', () => {
  assert.throws(() => validateConfigValue({ type: 'integer', minimum: 0 }, -1), /Minimum/)
  assert.throws(() => validateConfigValue({ type: 'integer' }, 1.5), /valid number/)
  assert.throws(() => validateConfigValue({ type: 'number' }, NaN), /valid number/)
  assert.throws(
    () => validateConfigValue({ type: 'string', enum: ['one'] }, 'two'),
    /allowed value/
  )
  assert.throws(
    () =>
      updateConfigFeatureValue(
        codexFeatureSchemas.code_mode,
        {},
        ['excluded_tool_namespaces'],
        [1],
        true
      ),
    /Expected text/
  )
  assert.throws(
    () =>
      updateConfigFeatureValue(
        codexFeatureSchemas.code_mode,
        {},
        ['__proto__', 'polluted'],
        true,
        true
      ),
    /Invalid setting path/
  )
  assert.throws(
    () =>
      validateConfigValue(
        { type: 'object', additionalProperties: { type: 'boolean' } },
        JSON.parse('{"__proto__":true}')
      ),
    /Unknown setting/
  )
})

test('editing a deeper object preserves its siblings', () => {
  const schema = {
    type: 'object',
    properties: {
      group: {
        type: 'object',
        properties: { count: { type: 'integer' }, label: { type: 'string' } }
      }
    }
  }
  assert.deepEqual(
    updateConfigFeatureValue(
      schema,
      { group: { count: 2, label: 'keep' } },
      ['group', 'count'],
      3,
      true
    ),
    { group: { count: 3, label: 'keep' } }
  )
})
