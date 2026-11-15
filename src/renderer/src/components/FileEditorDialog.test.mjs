import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { clamp } from '../chatLayout.ts'

const source = ts.createSourceFile(
  'FileEditorDialog.tsx',
  readFileSync(new URL('./FileEditorDialog.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const names = new Set([
  'diffTreeWidthStorageKey',
  'diffTreeDefaultWidth',
  'diffTreeMinWidth',
  'diffTreeMaxWidth',
  'readStoredDiffTreeWidth'
])
const declarations = source.statements
  .filter(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((declaration) =>
        names.has(declaration.name.getText(source))
      )
  )
  .map((statement) => statement.getText(source))
  .join('\n')
const readerSource = ts.transpileModule(`${declarations}\nexports.read = readStoredDiffTreeWidth`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText

const readWidth = (stored) => {
  const context = {
    exports: {},
    clamp,
    console: { error: () => {} },
    preferenceStorage: {
      getItem: (key) => {
        assert.equal(key, 'sele:file-diff-tree-width:v2')
        if (stored instanceof Error) throw stored
        return stored
      }
    }
  }
  vm.runInNewContext(readerSource, context)
  return context.exports.read()
}

test('the file sidebar opens at its default width until the user resizes it', () => {
  assert.equal(readWidth(null), 192)
  assert.equal(readWidth(''), 192)
  assert.equal(readWidth('wide'), 192)
  assert.equal(readWidth(new Error('preferences unavailable')), 192)
})

test('a stored file sidebar width is restored within its limits', () => {
  assert.equal(readWidth('240'), 240)
  assert.equal(readWidth('217.5'), 217.5)
  assert.equal(readWidth('20'), 144)
  assert.equal(readWidth('9000'), 384)
})
