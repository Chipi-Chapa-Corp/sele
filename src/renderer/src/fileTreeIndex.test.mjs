import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChangeTree, getTreeFilesWithDisplayPaths } from './changeTree.ts'
import {
  buildFileTreeIndex,
  getDefaultFileTreeCollapsedFolders,
  getFileTreeIndexNodes,
  getVisibleFileTreeFolderPaths,
  isFileTreeFolderCollapsed
} from './fileTreeIndex.ts'
import { getFileTreeAbsolutePath } from '../../shared/fileTree.ts'

const root = '/project/nested'
const paths = [
  'src/main.ts',
  'src/Main.ts',
  'src/components/Button.tsx',
  'src/components/button.css',
  'src/components/forms/Input.tsx',
  'docs/guide.md',
  'docs/Ä-umlaut.md',
  'docs/a-b/c.md',
  'docs/a/b.md',
  'README.md',
  '.hidden',
  'line\nbreak.txt',
  'with space/file 1.txt',
  'node_modules/pkg/index.js',
  'node_modules/pkg/lib/deep/a.js',
  'SRC/upper.ts'
]
const listing = (listedPaths, listingRoot = root) => ({
  repositoryRoot: listingRoot,
  branchName: null,
  fileCount: listedPaths.length,
  paths: listedPaths.join('\0')
})

// The previous implementation built the whole tree with buildChangeTree; the index must
// produce the same names, order, paths and file entries one folder at a time.
const expectedTree = (listedPaths, listingRoot = root) =>
  buildChangeTree(
    getTreeFilesWithDisplayPaths(
      listedPaths.map((path) => ({ path: getFileTreeAbsolutePath(listingRoot, path) })),
      listingRoot
    )
  )

const assertSameFolder = (index, folderPath, expectedNodes) => {
  const nodes = getFileTreeIndexNodes(index, folderPath)
  assert.deepEqual(
    nodes.map((node) => [node.type, node.name, node.type === 'folder' ? node.path : node.file]),
    expectedNodes.map((node) => [
      node.type,
      node.name,
      node.type === 'folder'
        ? node.path
        : { path: node.file.path, displayPath: node.file.displayPath, displayPreviousPath: null }
    ]),
    `children of "${folderPath}"`
  )
  for (const node of expectedNodes) {
    if (node.type === 'folder') assertSameFolder(index, node.path, node.children)
  }
}

test('every folder lists the same children, in the same order, as the full change tree', () => {
  const shuffled = [...paths].reverse()
  const index = buildFileTreeIndex(listing(shuffled))
  assert.equal(index.fileCount, paths.length)
  assert.equal(index.repositoryRoot, root)
  assertSameFolder(index, '', expectedTree(shuffled))
})

test('file nodes open absolute paths and show paths relative to the listing root', () => {
  const index = buildFileTreeIndex(listing(['src/a.txt'], 'C:\\project\\'))
  const [file] = getFileTreeIndexNodes(index, 'src')
  assert.equal(file.file.path, 'C:\\project/src/a.txt')
  assert.equal(file.file.displayPath, 'src/a.txt')
})

test('empty listings, empty path segments and unknown folders are handled', () => {
  const empty = buildFileTreeIndex(listing([]))
  assert.equal(empty.fileCount, 0)
  assert.deepEqual(getFileTreeIndexNodes(empty, ''), [])
  assert.deepEqual(getFileTreeIndexNodes(empty, 'missing'), [])

  const doubled = buildFileTreeIndex(listing(['a//b.txt']))
  assert.deepEqual(
    getFileTreeIndexNodes(doubled, '').map((node) => node.name),
    expectedTree(['a//b.txt']).map((node) => node.name)
  )
})

test('folder children are decoded once per index and reused', () => {
  const index = buildFileTreeIndex(listing(paths))
  assert.equal(getFileTreeIndexNodes(index, 'src'), getFileTreeIndexNodes(index, 'src'))
  const other = buildFileTreeIndex(listing(paths))
  assert.notEqual(getFileTreeIndexNodes(other, 'src'), getFileTreeIndexNodes(index, 'src'))
})

test('top-level folders start open, nested folders closed, and explicit choices win', () => {
  assert.equal(isFileTreeFolderCollapsed({}, 'src'), false)
  assert.equal(isFileTreeFolderCollapsed({}, 'src/components'), true)
  assert.equal(isFileTreeFolderCollapsed({ src: true }, 'src'), true)
  assert.equal(isFileTreeFolderCollapsed({ 'src/components': false }, 'src/components'), false)
})

test('a top-level src folder is the only folder open by default', () => {
  const index = buildFileTreeIndex(listing(paths))
  assert.deepEqual(getDefaultFileTreeCollapsedFolders(index), {
    docs: true,
    node_modules: true,
    SRC: true,
    'with space': true
  })
  assert.deepEqual(
    getDefaultFileTreeCollapsedFolders(buildFileTreeIndex(listing(['docs/a.md', 'lib/b.js']))),
    {}
  )
})

test('visible folders follow expansion without visiting closed subtrees', () => {
  const index = buildFileTreeIndex(listing(paths))
  const collapsed = getDefaultFileTreeCollapsedFolders(index)
  assert.deepEqual(getVisibleFileTreeFolderPaths(index, collapsed), [
    'docs',
    'node_modules',
    'src',
    'src/components',
    'SRC',
    'with space'
  ])
  assert.deepEqual(
    getVisibleFileTreeFolderPaths(index, { ...collapsed, src: true, node_modules: false }),
    ['docs', 'node_modules', 'node_modules/pkg', 'src', 'SRC', 'with space']
  )
  assert.ok(
    getVisibleFileTreeFolderPaths(index, {
      ...collapsed,
      'src/components': false
    }).includes('src/components/forms')
  )
})
