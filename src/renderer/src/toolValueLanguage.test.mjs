import assert from 'node:assert/strict'
import test from 'node:test'
import { getInputLanguage, getOutputLanguage, getToolValueLanguage } from './toolValueLanguage.ts'

test('tool language hints accept JSON prefixes without validating full streaming payloads', () => {
  for (const value of ['{"ok":true}', '[1,2]', '[]', '{}', '\n [null,false]', '{"incomplete":'])
    assert.equal(getOutputLanguage(value), 'json')
  assert.equal(getToolValueLanguage({ ok: true }), 'json')
  assert.equal(getToolValueLanguage('[{"text":"' + 'x'.repeat(1_000_000)), 'json')
})

test('bracketed logs are ordinary output, and other language hints remain intact', () => {
  for (const value of ['[info] Ready', '{not-json}', '[caught:tool]', 'plain output'])
    assert.equal(getOutputLanguage(value), null)
  assert.equal(getOutputLanguage('diff --git a/file b/file'), 'diff')
  assert.equal(getOutputLanguage('<section>Test</section>'), 'markup')
  assert.equal(getInputLanguage('functions.run({ command: "test" })'), 'javascript')
  assert.equal(getInputLanguage('rg needle src'), 'bash')
})
