import { nativeImage } from 'electron'
import { writeFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { encodeBrowserGif, type BrowserGifFrame } from './BrowserGif'

export type BrowserArtifact = { path: string; mimeType: string; bytes: number }

/** Explicit artifact writes never silently replace an existing user file. */
export async function saveBrowserArtifact(
  path: string,
  data: Buffer,
  mimeType: string
): Promise<BrowserArtifact> {
  if (!isAbsolute(path) || path.includes('\0'))
    throw new Error('An absolute output path is required')
  if (data.length > 50_000_000) throw new Error('Browser artifact exceeds the 50 MB size limit')
  await writeFile(path, data, { flag: 'wx', mode: 0o600 })
  return { path, mimeType, bytes: data.length }
}

/** A bounded viewport recording. Captures stop on disposal; encoding needs no external executable. */
export class BrowserRecording {
  private frames: BrowserGifFrame[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: Promise<void> = Promise.resolve()
  private active = false
  private error: string | undefined
  private startedAt = 0

  constructor(private capture: () => Promise<{ data: string }>) {}

  status(): { active: boolean; frames: number; error?: string } {
    return {
      active: this.active,
      frames: this.frames.length,
      ...(this.error ? { error: this.error } : {})
    }
  }

  async start(): Promise<ReturnType<BrowserRecording['status']>> {
    if (this.active || this.frames.length)
      throw new Error('Stop or discard the existing recording first')
    this.active = true
    this.error = undefined
    this.startedAt = Date.now()
    await this.captureFrame()
    return this.status()
  }

  private async captureFrame(): Promise<void> {
    const pending = (async () => {
      try {
        const shot = await this.capture()
        if (!this.active) return
        const image = nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64'))
        if (image.isEmpty()) throw new Error('Unable to decode browser recording frame')
        const size = image.getSize()
        const scale = Math.min(1, 640 / size.width, 480 / size.height)
        const width = Math.max(1, Math.round(size.width * scale))
        const height = Math.max(1, Math.round(size.height * scale))
        const frame = image.resize({ width, height }).toBitmap()
        this.frames.push({ width, height, bgra: frame, delayMs: 250 })
        if (this.frames.length >= 20 || Date.now() - this.startedAt >= 5000) this.active = false
        else this.timer = setTimeout(() => void this.captureFrame(), 250)
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
        this.active = false
      }
    })()
    this.pending = pending
    await pending
  }

  async stop(path: string): Promise<BrowserArtifact> {
    this.active = false
    clearTimeout(this.timer)
    await this.pending
    if (!this.frames.length)
      throw new Error(this.error ?? 'No recording is available; start a recording first')
    const artifact = await saveBrowserArtifact(path, encodeBrowserGif(this.frames), 'image/gif')
    this.frames = []
    return artifact
  }

  close(): void {
    this.active = false
    clearTimeout(this.timer)
    this.frames = []
  }
}
