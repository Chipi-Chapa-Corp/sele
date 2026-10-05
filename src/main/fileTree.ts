import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { AppFileTreeResult } from '../shared/app'

// Do not follow directory symlinks: they can escape the folder or form cycles.
// Git metadata is internal bookkeeping, but ignored and hidden project files belong here.
export const readLocalFileTree = async (cwd: string): Promise<AppFileTreeResult> => {
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
  return createFileTreeResult(root, paths)
}

export const targetFileTreeScript = [
  'set -eu',
  'cd -- "$1"',
  'printf "%s\\0" "$PWD"',
  'find . -name .git -prune -o \\( -type f -o -type l \\) -print0'
].join('\n')

export const parseTargetFileTree = (output: Buffer): AppFileTreeResult => {
  const [root, ...paths] = output.toString('utf8').split('\0')
  if (!root || output.at(-1) !== 0) throw new Error('Invalid file listing response')
  return createFileTreeResult(
    root,
    paths.filter(Boolean).map((path) => path.replace(/^\.\//, ''))
  )
}

const createFileTreeResult = (root: string, paths: string[]): AppFileTreeResult => ({
  repositoryRoot: root,
  branchName: null,
  files: paths.sort((a, b) => a.localeCompare(b)).map((path) => ({ path }))
})
