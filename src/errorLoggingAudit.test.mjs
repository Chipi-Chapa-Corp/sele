import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const sourceExtensions = new Set(['.js', '.ts', '.tsx'])
const loggedErrorPattern =
  /console\.(?:error|warn)\s*\(|logDiagnostic\s*\(|originalError\s*\(|fail\s*\(\s*error\s*\)/
const expectedErrorBranchPattern = /\bisExpected[A-Za-z0-9]*Error\s*\(/

const listSourceFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return listSourceFiles(path)
      if (!sourceExtensions.has(extname(entry.name)) || entry.name.includes('.test.')) return []
      return [path]
    })
  )
  return nested.flat()
}

const getLine = (sourceFile, node) =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1

const blockAlwaysRethrows = (block) => {
  const finalStatement = block.statements.at(-1)
  return finalStatement != null && ts.isThrowStatement(finalStatement)
}

const blockReportsFailure = (block, sourceFile) => {
  for (const statement of block.statements) {
    const text = statement.getText(sourceFile)
    if (loggedErrorPattern.test(text)) return true
    if (/\breturn\b/.test(text) && !expectedErrorBranchPattern.test(text)) return false
  }
  return blockAlwaysRethrows(block)
}

const callbackReportsFailure = (callback, sourceFile) => {
  const text = callback.getText(sourceFile)
  if (/Promise\.reject\s*\(/.test(text)) return true
  return ts.isBlock(callback.body)
    ? blockReportsFailure(callback.body, sourceFile)
    : loggedErrorPattern.test(text)
}

test('production catch and rejection handlers do not silently discard errors', async () => {
  const failures = []
  for (const path of await listSourceFiles(fileURLToPath(new URL('.', import.meta.url)))) {
    const source = await readFile(path, 'utf8')
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx')
        ? ts.ScriptKind.TSX
        : path.endsWith('.js')
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS
    )

    const visit = (node) => {
      if (ts.isCatchClause(node)) {
        if (!blockReportsFailure(node.block, sourceFile)) {
          failures.push(`${path}:${getLine(sourceFile, node)} catch block`)
        }
      }

      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        (node.expression.name.text === 'catch' || node.expression.name.text === 'then')
      ) {
        const callback =
          node.expression.name.text === 'catch' ? node.arguments[0] : node.arguments[1]
        if (
          callback &&
          (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
          !callbackReportsFailure(callback, sourceFile)
        ) {
          failures.push(
            `${path}:${getLine(sourceFile, node)} ${node.expression.name.text} rejection handler`
          )
        }
      }

      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }

  assert.deepEqual(failures, [], `Silent error handlers:\n${failures.join('\n')}`)
})
