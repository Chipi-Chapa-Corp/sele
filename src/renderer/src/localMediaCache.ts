import type { AppLocalImage, AppLocalImageOptions } from '../../shared/app'

export type LocalMediaKind = 'image' | 'video'
export type LocalMediaLease = {
  readonly url: string | null
  ready: Promise<string>
  release: () => void
}

// Include the SSH runtime: the same host name can resolve differently from a container.
export const getLocalMediaKey = (options: AppLocalImageOptions, kind: LocalMediaKind): string => {
  const target = options.container
  const runtime = target?.kind === 'container' && target.tool === 'ssh' ? target.runtime : null
  return JSON.stringify([
    kind,
    target?.kind === 'container' ? [target.tool, target.name] : 'host',
    runtime?.kind === 'container' ? [runtime.tool, runtime.name] : 'host',
    options.cwd ?? null,
    options.relativeTo ?? 'repository',
    options.path
  ])
}

type Entry = {
  url: string | null
  ready: Promise<string>
  users: number
  bytes: number
  timer?: ReturnType<typeof setTimeout>
}

// Active views own leases. Unmounted thumbnails keep a small, short-lived LRU of
// Blob URLs so paging/remounting and opening the gallery reuse the same resource.
export function createLocalMediaCache(
  load: (options: AppLocalImageOptions, kind: LocalMediaKind) => Promise<AppLocalImage>,
  {
    maxIdleBytes = 32 * 1024 * 1024,
    maxIdleEntries = 24,
    idleTtlMs = 30_000,
    createUrl = (media: AppLocalImage) =>
      URL.createObjectURL(new Blob([media.data], { type: media.mimeType })),
    revokeUrl = (url: string) => URL.revokeObjectURL(url)
  } = {}
): { acquire: (options: AppLocalImageOptions, kind?: LocalMediaKind) => LocalMediaLease } {
  const entries = new Map<string, Entry>()
  const idle = new Map<string, Entry>()
  const remove = (key: string, entry: Entry): void => {
    if (entries.get(key) === entry) entries.delete(key)
    if (idle.get(key) === entry) idle.delete(key)
    clearTimeout(entry.timer)
    if (entry.url) revokeUrl(entry.url)
  }
  const trim = (): void => {
    let bytes = [...idle.values()].reduce((total, entry) => total + entry.bytes, 0)
    for (const [key, entry] of idle) {
      if (idle.size <= maxIdleEntries && bytes <= maxIdleBytes) break
      bytes -= entry.bytes
      remove(key, entry)
    }
  }
  return {
    acquire(options, kind = 'image') {
      const key = getLocalMediaKey(options, kind)
      let entry = entries.get(key)
      if (!entry) {
        const created: Entry = { url: null, ready: null!, users: 0, bytes: 0 }
        entries.set(key, created)
        created.ready = load(options, kind).then(
          (media) => {
            const url = createUrl(media)
            created.url = url
            created.bytes = media.data.byteLength
            // An unused pending read may have been evicted before it finished.
            if (entries.get(key) !== created) revokeUrl(url)
            else trim()
            return url
          },
          (error) => {
            remove(key, created)
            throw error
          }
        )
        entry = created
      }
      clearTimeout(entry.timer)
      idle.delete(key)
      entry.users++
      const retained = entry
      let released = false
      return {
        get url() {
          return retained.url
        },
        ready: retained.ready,
        release() {
          if (released) return
          released = true
          retained.users--
          if (retained.users || entries.get(key) !== retained) return
          idle.set(key, retained)
          retained.timer = setTimeout(() => remove(key, retained), idleTtlMs)
          trim()
        }
      }
    }
  }
}
