import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { build } from 'esbuild'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DefaultFileIcon,
  DefaultFolderIcon,
  FileIcon as LibraryFileIcon,
  FolderIcon as LibraryFolderIcon
} from '@react-symbols/icons/utils'

const result = await build({
  entryPoints: [fileURLToPath(new URL('./SymbolIcons.tsx', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  // The icon package is ESM-only; bundle it and share React with the test.
  external: ['react', 'react/jsx-runtime'],
  jsx: 'automatic'
})
const module = { exports: {} }
vm.runInThisContext(`(function (exports, require, module) {${result.outputFiles[0].text}\n})`)(
  module.exports,
  createRequire(import.meta.url),
  module
)
const { FileIcon, FolderIcon } = module.exports
const render = (element) => renderToStaticMarkup(element)

test('the icon library still crashes on names inherited from Object.prototype', () => {
  // If this starts passing, the upstream bug is fixed and the wrapper can be removed.
  assert.throws(
    () => render(createElement(LibraryFolderIcon, { folderName: 'constructor' })),
    /Objects are not valid as a React child/
  )
})

test('file icons fall back to the default icon for inherited names', () => {
  const fallback = render(createElement(DefaultFileIcon))
  for (const fileName of ['constructor', 'Constructor', 'notes.constructor', '__proto__']) {
    assert.equal(render(createElement(FileIcon, { fileName, autoAssign: true })), fallback)
    assert.equal(render(createElement(FileIcon, { fileName })), fallback)
  }
  assert.match(
    render(createElement(FileIcon, { fileName: 'constructor', 'aria-hidden': 'true' })),
    /aria-hidden="true"/
  )
})

test('folder icons fall back to the default icon for inherited names', () => {
  const fallback = render(createElement(DefaultFolderIcon))
  for (const folderName of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.equal(render(createElement(FolderIcon, { folderName })), fallback)
  }
})

test('ordinary names keep their specific icons', () => {
  for (const fileName of ['index.ts', 'package.json', 'constructor.ts', 'Constructor.tsx']) {
    assert.equal(
      render(createElement(FileIcon, { fileName, autoAssign: true })),
      render(createElement(LibraryFileIcon, { fileName, autoAssign: true }))
    )
  }
  for (const folderName of ['src', 'node_modules', 'components']) {
    assert.equal(
      render(createElement(FolderIcon, { folderName })),
      render(createElement(LibraryFolderIcon, { folderName }))
    )
  }
})
