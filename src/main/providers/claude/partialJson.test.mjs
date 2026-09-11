import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePartialJson } from './partialJson.ts'

const cases = [
  ['{"command": "npm run build"}', { command: 'npm run build' }],
  ['', undefined],
  ['{', {}],
  ['{"command": "npm run bui', { command: 'npm run bui' }],
  ['{"command": "ls", "cwd', { command: 'ls' }],
  ['{"command": "ls", "cwd"', { command: 'ls' }],
  ['{"command": "ls", "cwd":', { command: 'ls', cwd: null }],
  ['{"command": "ls",', { command: 'ls' }],
  ['{"command": "ls", ', { command: 'ls' }],
  ['{"a": [1, 2', { a: [1, 2] }],
  ['{"a": [1, 2,', { a: [1, 2] }],
  ['{"a": tr', { a: true }],
  ['{"a": 12.', { a: 12 }],
  ['{"a": -', { a: null }],
  ['{"a": "x\\', { a: 'x' }],
  ['{"a": "x\\u00', { a: 'x' }],
  ['{"a": "x\\"y', { a: 'x"y' }],
  ['{"a": "x\\ny', { a: 'x\ny' }],
  ['{"a": {"b": "c', { a: { b: 'c' } }],
  ['[[1, [2', [[1, [2]]]],
  [
    '{"file_path": "/tmp/a.ts", "content": "line 1\\nline',
    { file_path: '/tmp/a.ts', content: 'line 1\nline' }
  ]
]

for (const [source, expected] of cases) {
  test(`parses fragment ${JSON.stringify(source)}`, () => {
    assert.deepEqual(parsePartialJson(source), expected)
  })
}

test('every prefix of a document parses without throwing', () => {
  const document =
    '{"command": "git commit -m \\"fix\\"", "flags": [true, null, -1.5e3], "nested": {"k": [{"x": 1}]}}'
  for (let length = 0; length <= document.length; length += 1) {
    const value = parsePartialJson(document.slice(0, length))
    assert.ok(length === 0 || value !== undefined, `prefix ${length} should parse`)
  }
  assert.deepEqual(parsePartialJson(document), JSON.parse(document))
})
