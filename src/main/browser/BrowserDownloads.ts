import { app, type DownloadItem, type Session, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'

export type BrowserDownload = {
  id: string
  tabId: number
  url: string
  filename: string
  status: 'started' | 'in_progress' | 'complete' | 'failed' | 'canceled'
  receivedBytes: number
  totalBytes: number
}

/** One client's downloads; authorizations are single-use and never shared across tabs. */
export class BrowserDownloads {
  private readonly downloads = new Map<string, BrowserDownload>()
  private readonly allowed = new Map<number, { url?: string; expires: number }>()
  private readonly active = new Map<string, DownloadItem>()
  private readonly waiters = new Set<{
    tabId: number
    id?: string
    resolve: (download: BrowserDownload) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private directory: string | undefined
  private closed = false

  constructor(
    private readonly session: Session,
    private readonly owns: (guest: WebContents) => boolean,
    private readonly emit: (download: BrowserDownload) => void
  ) {
    session.on('will-download', this.onDownload)
  }

  async allow(tabId: number, url?: string, timeoutMs = 30000): Promise<void> {
    if (this.closed) throw new Error('Browser session closed')
    if (url !== undefined && !['http:', 'https:', 'blob:'].includes(new URL(url).protocol))
      throw new Error('Unsupported browser download URL')
    const directory = join(app.getPath('downloads'), 'Sele')
    await mkdir(directory, { recursive: true })
    if (this.closed) throw new Error('Browser session closed')
    this.directory = directory
    this.allowed.set(tabId, { url, expires: Date.now() + timeoutMs })
  }

  list(tabId: number): BrowserDownload[] {
    return [...this.downloads.values()]
      .filter((download) => download.tabId === tabId)
      .map((d) => ({ ...d }))
  }

  async wait(tabId: number, timeoutMs = 30000): Promise<BrowserDownload> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
      throw new Error('Download timeout must be between 1 and 120000 milliseconds')
    await this.allow(tabId, undefined, timeoutMs)
    return new Promise((resolve, reject) => {
      const waiter = {
        tabId,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter)
          this.allowed.delete(tabId)
          reject(new Error('Timed out waiting for download'))
        }, timeoutMs)
      }
      this.waiters.add(waiter)
    })
  }

  private publish(download: BrowserDownload): void {
    this.emit({ ...download })
    for (const waiter of this.waiters) {
      if (waiter.tabId !== download.tabId || (waiter.id && waiter.id !== download.id)) continue
      waiter.id ??= download.id
      if (download.status === 'started' || download.status === 'in_progress') continue
      clearTimeout(waiter.timer)
      this.waiters.delete(waiter)
      if (download.status === 'complete') waiter.resolve({ ...download })
      else waiter.reject(new Error(`Download ${download.status}`))
    }
  }

  private readonly onDownload = (
    _event: Electron.Event,
    item: DownloadItem,
    guest: WebContents
  ): void => {
    if (this.closed || !guest || !this.owns(guest)) return
    const grant = this.allowed.get(guest.id)
    const url = item.getURL()
    if (
      !grant ||
      grant.expires < Date.now() ||
      (grant.url !== undefined && grant.url !== url && grant.url !== item.getURLChain()[0])
    )
      return
    this.allowed.delete(guest.id)
    const id = randomUUID()
    const filename = join(
      this.directory!,
      `${id}-${basename(item.getFilename()).replace(/[\\/\p{Cc}]/gu, '_') || 'download'}`
    )
    item.setSavePath(filename)
    const download: BrowserDownload = {
      id,
      tabId: guest.id,
      url,
      filename,
      status: 'started',
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes()
    }
    this.downloads.set(id, download)
    this.active.set(id, item)
    // Bound metadata without deleting completed files from the user's downloads.
    if (this.downloads.size > 200) {
      const oldest = [...this.downloads.values()].find((d) => !this.active.has(d.id))
      if (oldest) this.downloads.delete(oldest.id)
    }
    this.publish(download)
    item.on('updated', () => {
      // Interrupted transfers may resume; only the done event is terminal.
      download.status = 'in_progress'
      download.receivedBytes = item.getReceivedBytes()
      download.totalBytes = item.getTotalBytes()
      this.publish(download)
    })
    item.once('done', (_event, state) => {
      this.active.delete(id)
      download.status =
        state === 'completed' ? 'complete' : state === 'cancelled' ? 'canceled' : 'failed'
      download.receivedBytes = item.getReceivedBytes()
      this.publish(download)
    })
  }

  revoke(tabId: number): void {
    this.allowed.delete(tabId)
    for (const [id, item] of this.active) if (this.downloads.get(id)?.tabId === tabId) item.cancel()
    for (const waiter of this.waiters) {
      if (waiter.tabId !== tabId) continue
      clearTimeout(waiter.timer)
      this.waiters.delete(waiter)
      waiter.reject(new Error('Browser tab detached'))
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.session.removeListener('will-download', this.onDownload)
    this.allowed.clear()
    for (const item of this.active.values()) item.cancel()
    this.active.clear()
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('Browser session closed'))
    }
    this.waiters.clear()
  }
}
