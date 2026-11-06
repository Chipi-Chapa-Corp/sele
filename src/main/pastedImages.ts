import { mkdir, open, unlink, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppSelectedImage } from '../shared/app'

const extensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif'
}
type Upload = {
  owner: number
  handle: FileHandle
  total: number
  written: number
  writing: boolean
  image: AppSelectedImage
  timer: ReturnType<typeof setTimeout>
}

/** Small IPC chunks avoid copying a full image on either UI thread. */
export class PastedImageStore {
  private uploads = new Map<string, Upload>()
  private preparing = new Map<number, number>()
  private closedOwners = new Set<number>()
  private directory: string
  private idleMs: number
  constructor(directory: string, idleMs = 30_000) {
    this.directory = directory
    this.idleMs = idleMs
  }

  private async remove(upload: Upload): Promise<void> {
    if (this.uploads.get(upload.image.path) !== upload) return
    this.uploads.delete(upload.image.path)
    clearTimeout(upload.timer)
    await upload.handle.close().catch(() => {})
    await unlink(upload.image.path).catch(() => {})
  }

  async cancelOwner(owner: number): Promise<void> {
    this.closedOwners.add(owner)
    await Promise.all(
      [...this.uploads.values()]
        .filter((upload) => upload.owner === owner)
        .map((upload) => this.remove(upload))
    )
  }

  async write(value: unknown, owner: number): Promise<AppSelectedImage | null> {
    if (this.closedOwners.has(owner)) throw new Error('The image paste was canceled.')
    if (!value || typeof value !== 'object') throw new Error('Invalid pasted image.')
    const input = value as Record<string, unknown>
    if (typeof input.cancel === 'string') {
      const upload = this.uploads.get(input.cancel)
      if (upload?.owner === owner) await this.remove(upload)
      return null
    }
    const { data, totalBytes, offset } = input
    if (
      !(data instanceof ArrayBuffer) ||
      !data.byteLength ||
      data.byteLength > 512 * 1024 ||
      typeof totalBytes !== 'number' ||
      !Number.isInteger(totalBytes) ||
      totalBytes < 1 ||
      totalBytes > 32 * 1024 * 1024 ||
      typeof offset !== 'number' ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset + data.byteLength > totalBytes
    )
      throw new Error('Invalid pasted image chunk. Paste an image smaller than 32 MB.')
    let upload: Upload | undefined
    const first = input.path === undefined
    if (first) {
      const { mimeType, previewDataUrl } = input
      const extension =
        typeof mimeType === 'string' && Object.hasOwn(extensions, mimeType)
          ? extensions[mimeType]
          : undefined
      if (
        offset !== 0 ||
        !extension ||
        typeof previewDataUrl !== 'string' ||
        previewDataUrl.length > 128 * 1024 ||
        !/^data:image\/(?:webp|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(previewDataUrl)
      )
        throw new Error('Invalid pasted image preview or format.')
      const preparing = this.preparing.get(owner) ?? 0
      if (preparing + [...this.uploads.values()].filter((item) => item.owner === owner).length >= 2)
        throw new Error('Another image paste is still being prepared.')
      this.preparing.set(owner, preparing + 1)
      try {
        await mkdir(this.directory, { recursive: true })
        const path = join(this.directory, `pasted-image-${randomUUID()}.${extension}`)
        const handle = await open(path, 'wx')
        if (this.closedOwners.has(owner)) {
          await handle.close()
          await unlink(path)
          throw new Error('The image paste was canceled.')
        }
        const image: AppSelectedImage = {
          kind: 'image',
          name: `Pasted image.${extension}`,
          path,
          dataUrl: previewDataUrl,
          previewOnly: true
        }
        const timer = setTimeout(() => {
          if (upload) void this.remove(upload)
        }, this.idleMs)
        timer.unref()
        upload = { owner, handle, total: totalBytes, written: 0, writing: false, image, timer }
        this.uploads.set(path, upload)
      } finally {
        const remaining = (this.preparing.get(owner) ?? 1) - 1
        if (remaining > 0) this.preparing.set(owner, remaining)
        else this.preparing.delete(owner)
      }
    } else if (typeof input.path === 'string') {
      upload = this.uploads.get(input.path)
    }
    if (!upload || upload.owner !== owner)
      throw new Error('The image paste is no longer available.')
    if (upload.writing) throw new Error('An image chunk is already being written.')
    try {
      if (upload.total !== totalBytes || upload.written !== offset)
        throw new Error('Invalid image chunk order.')
      upload.writing = true
      upload.timer.refresh()
      await upload.handle.writeFile(Buffer.from(data))
      if (this.uploads.get(upload.image.path) !== upload)
        throw new Error('The image paste was canceled.')
      upload.written += data.byteLength
      const complete = upload.written === upload.total
      if (complete) {
        await upload.handle.close()
        this.uploads.delete(upload.image.path)
        clearTimeout(upload.timer)
      }
      return first || complete ? upload.image : null
    } catch (error) {
      await this.remove(upload)
      throw error
    } finally {
      upload.writing = false
    }
  }
}
