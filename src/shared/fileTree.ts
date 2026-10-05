// File listings are relative to the selected folder, which may be inside a repository.
// Open absolute paths so file readers cannot reinterpret them relative to a Git root.
export const getFileTreeAbsolutePath = (root: string, path: string): string =>
  `${root.replace(/[\\/]+$/, '')}/${path}`
