export type HostDirectoryListing = {
  path: string
  parent: string
  entries: { name: string; path: string; directory: boolean }[]
  truncated: boolean
}
