import { dirname, isAbsolute, resolve } from 'node:path'

export const resolveFileTargetPath = (
  cwd: string,
  path: string,
  cwdRepositoryRoot: string | null
): string => (isAbsolute(path) ? path : resolve(cwdRepositoryRoot ?? cwd, path))

export const getFileTargetGitCwd = (absolutePath: string): string => dirname(absolutePath)
