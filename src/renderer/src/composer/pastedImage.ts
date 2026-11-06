import ImageWorker from './pastedImage.worker?worker'
import { appApi } from '../appApi'
import type { AppSelectedImage } from '../../../shared/app'

export const readPastedImage = async (file: File): Promise<AppSelectedImage | null> => {
  if (file.size > 32 * 1024 * 1024) throw new Error('Paste an image smaller than 32 MB.')
  const worker = new ImageWorker()
  let uploadPath: string | undefined
  try {
    const previewDataUrl = await new Promise<string>((resolve, reject) => {
      worker.onmessage = ({ data }: MessageEvent<{ preview?: string; error?: string }>) => {
        if (data.preview) resolve(data.preview)
        else reject(new Error(data.error ?? 'Unable to prepare the pasted image.'))
      }
      worker.onerror = () => reject(new Error('Unable to prepare the pasted image.'))
      worker.onmessageerror = () => reject(new Error('Unable to read the image preview.'))
      worker.postMessage(file)
    })
    worker.terminate()
    let image: AppSelectedImage | null = null
    for (let offset = 0; offset < file.size; offset += 512 * 1024) {
      const data = await file.slice(offset, offset + 512 * 1024).arrayBuffer()
      const result = await appApi.getClipboardImage({
        data,
        totalBytes: file.size,
        offset,
        ...(uploadPath ? { path: uploadPath } : { mimeType: file.type, previewDataUrl })
      })
      if (offset === 0) {
        if (!result) return null
        // An older running preload/main ignores the new request. Stop after one
        // native read, while still keeping its full image out of draft state.
        if (!result.previewOnly) return { ...result, dataUrl: previewDataUrl, previewOnly: true }
        uploadPath = result.path
        image = result
      } else if (offset + data.byteLength === file.size) {
        if (!result) throw new Error('Unable to finish saving the pasted image.')
        image = result
      }
      // Even fast filesystem replies must leave opportunities for input and paint.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    return image
  } catch (error) {
    if (uploadPath) await appApi.getClipboardImage({ cancel: uploadPath }).catch(() => {})
    throw error
  } finally {
    worker.terminate()
  }
}
