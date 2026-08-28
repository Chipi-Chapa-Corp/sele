import type {
  AppFileTreeResult,
  AppGitChangeKind,
  AppGitChangesResult,
  AppGitPatchChange
} from '../../shared/app'
import type {
  ProviderChatItem,
  ProviderFileDiff,
  ProviderWorkingItem,
  ProviderWorkingStep
} from '../../shared/provider'

export type ChangeSource = 'chat' | 'lastTurn' | 'uncommitted'
export type PatchChangeSource = Extract<ChangeSource, 'chat' | 'lastTurn'>
export type GitChangeSource = Exclude<ChangeSource, 'chat' | 'lastTurn'>

export type ChangedFile = {
  path: string
  previousPath?: string | null
  displayPath?: string
  displayPreviousPath?: string | null
  kind: AppGitChangeKind
  status?: string
  diff?: string
  patches?: AppGitPatchChange[]
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
  childrenPrecomputed: boolean
}

export type ChangeTreeNode<TFile extends TreeFile = TreeFile> =
  ChangeTreeFolderNode<TFile> | ChangeTreeFileNode<TFile>

type MutableChangeTreeFolder<TFile extends TreeFile = TreeFile> = {
  name: string
  path: string
  folders: Map<string, MutableChangeTreeFolder<TFile>>
  files: ChangeTreeFileNode<TFile>[]
  childrenPrecomputed: boolean
}

export type PatchFilterScope = {
  containerKey: string
  cwd: string
  source: PatchChangeSource
  signature: string
}

const sortTreeFiles = <TFile extends TreeFile>(files: TFile[]): TFile[] =>
  [...files].sort((firstFile, secondFile) => firstFile.path.localeCompare(secondFile.path))

export const sortChangedFiles = (files: ChangedFile[]): ChangedFile[] => sortTreeFiles(files)

const getPathParts = (path: string): string[] => path.replace(/\\/g, '/').split('/').filter(Boolean)

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
  path: string,
  childrenPrecomputed = true
): MutableChangeTreeFolder<TFile> => ({
  name,
  path,
  folders: new Map(),
  files: [],
  childrenPrecomputed
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
      children: finalizeChangeTreeFolder(childFolder),
      childrenPrecomputed: childFolder.childrenPrecomputed
    }))

  const files = [...folder.files].sort((firstFile, secondFile) =>
    firstFile.name.localeCompare(secondFile.name)
  )

  return [...folders, ...files]
}

export const buildChangeTree = <TFile extends TreeFile>(
  files: TFile[],
  shouldPrecomputeFolderChildren?: (folderPath: string) => boolean
): ChangeTreeNode<TFile>[] => {
  const root = createMutableChangeTreeFolder<TFile>('', '')

  for (const file of files) {
    const displayPath = getChangedFileDisplayPath(file)
    const pathPartIterator = displayPath.replace(/\\/g, '/').matchAll(/[^/]+/g)
    let pathPart = pathPartIterator.next()
    let nextPathPart = pathPartIterator.next()
    let folder = root
    let folderPath = ''
    let fileParentPrecomputed = true

    while (!pathPart.done && !nextPathPart.done && fileParentPrecomputed) {
      const folderName = pathPart.value[0]
      folderPath = folderPath ? `${folderPath}/${folderName}` : folderName
      let childFolder = folder.folders.get(folderName)

      if (!childFolder) {
        childFolder = createMutableChangeTreeFolder(
          folderName,
          folderPath,
          shouldPrecomputeFolderChildren?.(folderPath) ?? true
        )
        folder.folders.set(folderName, childFolder)
      }

      folder = childFolder
      fileParentPrecomputed = childFolder.childrenPrecomputed
      pathPart = nextPathPart
      nextPathPart = pathPartIterator.next()
    }

    if (!fileParentPrecomputed) continue

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

const fileTreePrecomputedLevels = 2

export const buildProgressiveFileTree = <TFile extends TreeFile>(
  files: TFile[],
  lastOpenedFolderPath: string | null
): ChangeTreeNode<TFile>[] => {
  const lastOpenedFolderDepth = lastOpenedFolderPath ? getPathParts(lastOpenedFolderPath).length : 0

  return buildChangeTree(files, (folderPath) => {
    const folderDepth = getPathParts(folderPath).length
    if (folderDepth < fileTreePrecomputedLevels) return true
    if (!lastOpenedFolderPath) return false

    if (folderPath === lastOpenedFolderPath || lastOpenedFolderPath.startsWith(`${folderPath}/`)) {
      return true
    }

    return (
      folderPath.startsWith(`${lastOpenedFolderPath}/`) &&
      folderDepth - lastOpenedFolderDepth < fileTreePrecomputedLevels
    )
  })
}

export const getDefaultFileTreeCollapsedFolders = (
  files: RepositoryFile[]
): Record<string, boolean> => {
  const folderPaths = getTreeFolderPaths(buildProgressiveFileTree(files, null))

  if (!folderPaths.includes('src')) return {}

  return Object.fromEntries(
    folderPaths.filter((folderPath) => folderPath !== 'src').map((folderPath) => [folderPath, true])
  )
}

const getWorkingItemDiffs = (item: ProviderWorkingItem): ProviderFileDiff[] => {
  if (item.type === 'tool') return item.diffs
  if (item.type === 'toolGroup') return item.tools.flatMap((tool) => tool.diffs)

  return []
}

const mergePatchChangeKind = (
  currentKind: AppGitPatchChange['kind'],
  nextKind: AppGitPatchChange['kind']
): AppGitPatchChange['kind'] => {
  if (currentKind === 'create' && nextKind !== 'delete') return 'create'
  return nextKind
}

const getPatchChangedFiles = (workingSteps: ProviderWorkingStep[]): ChangedFile[] => {
  const filesByPath = new Map<string, ChangedFile>()

  for (const workingStep of workingSteps) {
    for (const workingItem of workingStep.items) {
      for (const diff of getWorkingItemDiffs(workingItem)) {
        const patch = {
          path: diff.path,
          kind: diff.kind,
          diff: diff.diff
        } satisfies AppGitPatchChange
        const existingFile = filesByPath.get(diff.path)
        const existingKind = existingFile?.patches?.at(-1)?.kind

        filesByPath.set(diff.path, {
          path: diff.path,
          kind: existingKind ? mergePatchChangeKind(existingKind, patch.kind) : patch.kind,
          diff: diff.diff,
          patches: [...(existingFile?.patches ?? []), patch]
        })
      }
    }
  }

  return sortChangedFiles(Array.from(filesByPath.values()))
}

const getChatWorkingSteps = (
  items: readonly ProviderChatItem[] | null | undefined
): ProviderWorkingStep[] =>
  items?.filter((item): item is ProviderWorkingStep => item.type === 'working') ?? []

export const getLastTurnChangedFiles = (
  items: readonly ProviderChatItem[] | null | undefined
): ChangedFile[] => {
  const lastWorkingStep = getChatWorkingSteps(items).at(-1)
  return lastWorkingStep ? getPatchChangedFiles([lastWorkingStep]) : []
}

export const getChatChangedFiles = (
  items: readonly ProviderChatItem[] | null | undefined
): ChangedFile[] => getPatchChangedFiles(getChatWorkingSteps(items))

export const getGitChangedFiles = (result: AppGitChangesResult | null): ChangedFile[] =>
  sortChangedFiles(
    result?.files.map((file) => ({
      path: file.path,
      previousPath: file.previousPath,
      kind: file.kind,
      status: file.status
    })) ?? []
  )

export const getRepositoryFiles = (result: AppFileTreeResult | null): RepositoryFile[] =>
  sortTreeFiles(
    result?.files.map((file) => ({
      path: file.path,
      previousPath: file.previousPath,
      kind: file.kind,
      status: file.status
    })) ?? []
  )

export const getCommitPatches = (files: ChangedFile[]): AppGitPatchChange[] =>
  files.flatMap((file) => file.patches ?? [])

export const isPatchChangeSource = (source: ChangeSource): source is PatchChangeSource =>
  source === 'chat' || source === 'lastTurn'

const getPatchChangeKey = (patch: AppGitPatchChange): string =>
  [patch.path, patch.kind, patch.diff].join('\0')

const addStringToHash = (hash: number, value: string): number => {
  let nextHash = hash
  for (let index = 0; index < value.length; index += 1) {
    nextHash ^= value.charCodeAt(index)
    nextHash = Math.imul(nextHash, 16_777_619)
  }

  return nextHash
}

export const getPatchFilterSignature = (patches: AppGitPatchChange[]): string => {
  let hash = 2_166_136_261
  let totalLength = 0

  for (const patch of patches) {
    hash = addStringToHash(hash, patch.path)
    hash = addStringToHash(hash, '\0')
    hash = addStringToHash(hash, patch.kind)
    hash = addStringToHash(hash, '\0')
    hash = addStringToHash(hash, patch.diff)
    hash = addStringToHash(hash, '\0\0')
    totalLength += patch.path.length + patch.kind.length + patch.diff.length
  }

  return `${patches.length}:${totalLength}:${(hash >>> 0).toString(36)}`
}

export const isPatchFilterScope = (
  scope: PatchFilterScope | null,
  containerKey: string,
  cwd: string | null,
  source: ChangeSource,
  signature: string
): boolean =>
  Boolean(
    scope &&
    cwd &&
    isPatchChangeSource(source) &&
    scope.containerKey === containerKey &&
    scope.cwd === cwd &&
    scope.source === source &&
    scope.signature === signature
  )

const getPatchFileKind = (patches: AppGitPatchChange[]): AppGitPatchChange['kind'] =>
  patches.reduce<AppGitPatchChange['kind']>(
    (kind, patch, index) => (index === 0 ? patch.kind : mergePatchChangeKind(kind, patch.kind)),
    patches[0]?.kind ?? 'edit'
  )

export const filterChangedFilesByPatches = (
  files: ChangedFile[],
  patches: AppGitPatchChange[]
): ChangedFile[] => {
  const remainingPatchCounts = new Map<string, number>()

  for (const patch of patches) {
    const key = getPatchChangeKey(patch)
    remainingPatchCounts.set(key, (remainingPatchCounts.get(key) ?? 0) + 1)
  }

  return files.flatMap((file): ChangedFile[] => {
    const filePatches = file.patches ?? []
    const keptPatches = filePatches.filter((patch) => {
      const key = getPatchChangeKey(patch)
      const remainingCount = remainingPatchCounts.get(key) ?? 0
      if (remainingCount <= 0) return false

      remainingPatchCounts.set(key, remainingCount - 1)
      return true
    })

    if (keptPatches.length === 0) return []

    return [
      {
        ...file,
        kind: getPatchFileKind(keptPatches),
        diff: keptPatches.at(-1)?.diff ?? file.diff,
        patches: keptPatches
      }
    ]
  })
}
