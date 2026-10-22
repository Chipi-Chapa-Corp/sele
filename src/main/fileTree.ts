import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { AppFileTreeListing, AppFileTreeResult } from '../shared/app'

export type FileTreePaths = {
  root: string
  /** Relative to `root`, in no particular order. */
  paths: string[]
}

// Do not follow directory symlinks: they can escape the folder or form cycles.
// Git metadata is internal bookkeeping, but ignored and hidden project files belong here.
export const readLocalFileTreePaths = async (cwd: string): Promise<FileTreePaths> => {
  const root = resolve(cwd)
  const pending = ['']
  const paths: string[] = []
  while (pending.length > 0) {
    const directory = pending.pop()!
    const entries = await readdir(join(root, directory), { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === '.git') continue
      const path = directory ? `${directory}/${entry.name}` : entry.name
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile() || entry.isSymbolicLink()) paths.push(path)
    }
  }
  return { root, paths }
}

export const readLocalFileTree = async (cwd: string): Promise<AppFileTreeResult> =>
  createFileTreeResult(await readLocalFileTreePaths(cwd))

export const targetFileTreeScript = [
  'set -eu',
  'cd -- "$1"',
  'printf "%s\\0" "$PWD"',
  'find . -name .git -prune -o \\( -type f -o -type l \\) -print0'
].join('\n')

export const parseTargetFileTreePaths = (output: Buffer): FileTreePaths => {
  const [root, ...paths] = output.toString('utf8').split('\0')
  if (!root || output.at(-1) !== 0) throw new Error('Invalid file listing response')
  return { root, paths: paths.filter(Boolean).map((path) => path.replace(/^\.\//, '')) }
}

export const parseTargetFileTree = (output: Buffer): AppFileTreeResult =>
  createFileTreeResult(parseTargetFileTreePaths(output))

export const createFileTreeResult = ({ root, paths }: FileTreePaths): AppFileTreeResult => ({
  repositoryRoot: root,
  branchName: null,
  files: [...paths].sort((a, b) => a.localeCompare(b)).map((path) => ({ path }))
})

// File names cannot contain NUL. One string crosses IPC and the context bridge without
// creating an object per file; the renderer sorts and indexes it off its main thread.
export const createFileTreeListing = ({ root, paths }: FileTreePaths): AppFileTreeListing => ({
  repositoryRoot: root,
  branchName: null,
  fileCount: paths.length,
  paths: paths.join('\0')
})
