export type FileDisplayParts = {
  directoryName: string
  fileName: string
}

export const getFileDisplayParts = (path: string): FileDisplayParts => {
  const normalizedPath = path.replace(/\\/g, '/')
  const separatorIndex = normalizedPath.lastIndexOf('/')

  if (separatorIndex < 0) {
    return { directoryName: '.', fileName: normalizedPath }
  }

  return {
    directoryName: separatorIndex === 0 ? '/' : normalizedPath.slice(0, separatorIndex),
    fileName: normalizedPath.slice(separatorIndex + 1) || normalizedPath
  }
}
