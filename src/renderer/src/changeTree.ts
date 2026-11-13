import type { AppGitChangeKind, AppGitChangesResult } from '../../shared/app'

export type ChangedFile = {
  path: string
  previousPath?: string | null
  displayPath?: string
  displayPreviousPath?: string | null
  kind: AppGitChangeKind
  status?: string
}

export type RepositoryFile = {
  path: string
  previousPath?: string | null
  displayPath?: string
  displayPreviousPath?: string | null
  kind?: AppGitChangeKind | null
  status?: string | null
}

export type TreeFile = ChangedFile | RepositoryFile

export type DisplayTreeFile<TFile extends TreeFile> = TFile & {
  displayPath: string
  displayPreviousPath: string | null
}

export type ChangeTreeFileNode<TFile extends TreeFile = TreeFile> = {
  type: 'file'
  name: string
  file: TFile
}

export type ChangeTreeFolderNode<TFile extends TreeFile = TreeFile> = {
  type: 'folder'
  name: string
  path: string
  children: ChangeTreeNode<TFile>[]
}

export type ChangeTreeNode<TFile extends TreeFile = TreeFile> =
  | ChangeTreeFolderNode<TFile>
  | ChangeTreeFileNode<TFile>

type MutableChangeTreeFolder<TFile extends TreeFile = TreeFile> = {
  name: string
  path: string
  folders: Map<string, MutableChangeTreeFolder<TFile>>
  files: ChangeTreeFileNode<TFile>[]
}

const getLastPathPart = (path: string): string => {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
}

const normalizeDisplayPath = (path: string, root: string | null): string => {
  const normalizedPath = path.replace(/\\/g, '/')
  const normalizedRoot = root?.trim().replace(/\\/g, '/').replace(/\/+$/, '')

  if (!normalizedRoot) return normalizedPath
  if (normalizedPath === normalizedRoot) return getLastPathPart(normalizedPath)
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }

  return normalizedPath
}

export const getChangedFileDisplayPath = (file: TreeFile): string => file.displayPath ?? file.path

export const getChangedFileDisplayPreviousPath = (file: TreeFile): string | null =>
  file.displayPreviousPath ?? file.previousPath ?? null

export const getTreeFilesWithDisplayPaths = <TFile extends TreeFile>(
  files: TFile[],
  root: string | null
): DisplayTreeFile<TFile>[] =>
  files.map((file) => ({
    ...file,
    displayPath: normalizeDisplayPath(file.path, root),
    displayPreviousPath: file.previousPath ? normalizeDisplayPath(file.previousPath, root) : null
  }))

const createMutableChangeTreeFolder = <TFile extends TreeFile>(
  name: string,
  path: string
): MutableChangeTreeFolder<TFile> => ({
  name,
  path,
  folders: new Map(),
  files: []
})

const finalizeChangeTreeFolder = <TFile extends TreeFile>(
  folder: MutableChangeTreeFolder<TFile>
): ChangeTreeNode<TFile>[] => {
  const folders = Array.from(folder.folders.values())
    .sort((firstFolder, secondFolder) => firstFolder.name.localeCompare(secondFolder.name))
    .map<ChangeTreeFolderNode<TFile>>((childFolder) => ({
      type: 'folder',
      name: childFolder.name,
      path: childFolder.path,
      children: finalizeChangeTreeFolder(childFolder)
    }))

  const files = [...folder.files].sort((firstFile, secondFile) =>
    firstFile.name.localeCompare(secondFile.name)
  )

  return [...folders, ...files]
}

export const buildChangeTree = <TFile extends TreeFile>(
  files: TFile[]
): ChangeTreeNode<TFile>[] => {
  const root = createMutableChangeTreeFolder<TFile>('', '')

  for (const file of files) {
    const displayPath = getChangedFileDisplayPath(file)
    const pathPartIterator = displayPath.replace(/\\/g, '/').matchAll(/[^/]+/g)
    let pathPart = pathPartIterator.next()
    let nextPathPart = pathPartIterator.next()
    let folder = root
    let folderPath = ''

    while (!pathPart.done && !nextPathPart.done) {
      const folderName = pathPart.value[0]
      folderPath = folderPath ? `${folderPath}/${folderName}` : folderName
      let childFolder = folder.folders.get(folderName)

      if (!childFolder) {
        childFolder = createMutableChangeTreeFolder(folderName, folderPath)
        folder.folders.set(folderName, childFolder)
      }

      folder = childFolder
      pathPart = nextPathPart
      nextPathPart = pathPartIterator.next()
    }

    folder.files.push({
      type: 'file',
      name: pathPart.done ? displayPath : pathPart.value[0],
      file
    })
  }

  return finalizeChangeTreeFolder(root)
}

export const getTreeFolderPaths = <TFile extends TreeFile>(
  nodes: ChangeTreeNode<TFile>[]
): string[] =>
  nodes.flatMap((node) =>
    node.type === 'folder' ? [node.path, ...getTreeFolderPaths(node.children)] : []
  )

export const getCollapsedTreeFolders = (folderPaths: string[]): Record<string, boolean> =>
  Object.fromEntries(folderPaths.map((folderPath) => [folderPath, true]))

export const getGitChangedFiles = (result: AppGitChangesResult | null): ChangedFile[] =>
  result?.files
    .map((file) => ({
      path: file.path,
      previousPath: file.previousPath,
      kind: file.kind,
      status: file.status
    }))
    .sort((firstFile, secondFile) => firstFile.path.localeCompare(secondFile.path)) ?? []
