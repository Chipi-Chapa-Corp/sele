import { getFileTreeAbsolutePath } from '../../shared/fileTree.ts'
import type { AppFileTreeListing } from '../../shared/app.ts'
import type { ChangeTreeNode, DisplayTreeFile, RepositoryFile } from './changeTree.ts'

// Folder listings can include dependency folders with hundreds of thousands of files.
// The index is built in a worker and holds one encoded string per folder, which is
// cheap to send back. Rendering decodes only the folders that are actually expanded.

export type FileTreeIndex = {
  repositoryRoot: string
  branchName: string | null
  fileCount: number
  /**
   * Folder path ('' for the listing root) → `${folderCount}\0name\0name…`.
   * Child folder names come first; folders and files are each sorted by name.
   */
  folders: Map<string, string>
}

export type RepositoryTreeNode = ChangeTreeNode<DisplayTreeFile<RepositoryFile>>

const collator = new Intl.Collator()

export const buildFileTreeIndex = (listing: AppFileTreeListing): FileTreeIndex => {
  const { paths } = listing
  const entries = new Map<string, { folders: string[]; files: string[] }>([
    ['', { folders: [], files: [] }]
  ])
  let fileCount = 0
  let start = 0

  while (start < paths.length) {
    let end = paths.indexOf('\0', start)
    if (end === -1) end = paths.length
    let parent = entries.get('')!
    let segmentStart = start

    for (;;) {
      const slash = paths.indexOf('/', segmentStart)
      if (slash === -1 || slash >= end) {
        if (end > segmentStart) {
          parent.files.push(paths.slice(segmentStart, end))
          fileCount += 1
        }
        break
      }
      // Empty segments ("a//b") are skipped, as the change tree does.
      if (slash > segmentStart) {
        const folderPath = paths.slice(start, slash)
        let folder = entries.get(folderPath)
        if (!folder) {
          folder = { folders: [], files: [] }
          entries.set(folderPath, folder)
          parent.folders.push(paths.slice(segmentStart, slash))
        }
        parent = folder
      }
      segmentStart = slash + 1
    }
    start = end + 1
  }

  const folders = new Map<string, string>()
  for (const [path, entry] of entries) {
    entry.folders.sort(collator.compare)
    entry.files.sort(collator.compare)
    folders.set(path, [String(entry.folders.length), ...entry.folders, ...entry.files].join('\0'))
  }

  return {
    repositoryRoot: listing.repositoryRoot,
    branchName: listing.branchName,
    fileCount,
    folders
  }
}

const nodeCache = new WeakMap<FileTreeIndex, Map<string, RepositoryTreeNode[]>>()
const noNodes: RepositoryTreeNode[] = []

/**
 * Children of one folder, created on first use and then reused for this index.
 * Folder nodes have empty `children`; ask for each expanded folder's children.
 */
export const getFileTreeIndexNodes = (
  index: FileTreeIndex,
  folderPath: string
): RepositoryTreeNode[] => {
  let cache = nodeCache.get(index)
  if (!cache) {
    cache = new Map()
    nodeCache.set(index, cache)
  }
  const cached = cache.get(folderPath)
  if (cached) return cached

  const encoded = index.folders.get(folderPath)
  if (encoded === undefined) return noNodes

  const [countText, ...names] = encoded.split('\0')
  const folderCount = Number(countText)
  const nodes = names.map((name, position): RepositoryTreeNode => {
    const path = folderPath ? `${folderPath}/${name}` : name
    return position < folderCount
      ? { type: 'folder', name, path, children: noNodes }
      : {
          type: 'file',
          name,
          file: {
            path: getFileTreeAbsolutePath(index.repositoryRoot, path),
            displayPath: path,
            displayPreviousPath: null
          }
        }
  })
  cache.set(folderPath, nodes)
  return nodes
}

/**
 * `collapsed` records explicit choices: `true` collapsed, `false` expanded. Top-level
 * folders start expanded and nested ones collapsed, so the first view stays small.
 */
export const isFileTreeFolderCollapsed = (
  collapsed: Record<string, boolean>,
  folderPath: string
): boolean => collapsed[folderPath] ?? folderPath.includes('/')

/** With a top-level `src`, start with only that folder open. */
export const getDefaultFileTreeCollapsedFolders = (
  index: FileTreeIndex
): Record<string, boolean> => {
  const topLevelFolders = getFileTreeIndexNodes(index, '').flatMap((node) =>
    node.type === 'folder' ? [node.path] : []
  )
  if (!topLevelFolders.includes('src')) return {}

  return Object.fromEntries(
    topLevelFolders.filter((path) => path !== 'src').map((path) => [path, true])
  )
}

/** Folders that currently have a row: every folder whose ancestors are all expanded. */
export const getVisibleFileTreeFolderPaths = (
  index: FileTreeIndex,
  collapsed: Record<string, boolean>
): string[] => {
  const visible: string[] = []
  const visit = (folderPath: string): void => {
    for (const node of getFileTreeIndexNodes(index, folderPath)) {
      if (node.type !== 'folder') continue
      visible.push(node.path)
      if (!isFileTreeFolderCollapsed(collapsed, node.path)) visit(node.path)
    }
  }
  visit('')
  return visible
}
