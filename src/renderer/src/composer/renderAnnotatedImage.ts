import ImageWorker from './pastedImage.worker?worker'
import type { ImageAnnotation } from './imageAnnotations'

/** Decode, composite and encode full-resolution images away from the UI thread. */
export async function renderAnnotatedImage(
  image: HTMLImageElement,
  annotations: readonly ImageAnnotation[]
): Promise<Blob> {
  const worker = new ImageWorker()
  let bitmap: ImageBitmap | undefined
  let active = true
  try {
    return await new Promise<Blob>((resolve, reject) => {
      worker.onmessage = async ({
        data
      }: MessageEvent<{ image?: Blob; error?: string; needsBitmap?: boolean }>) => {
        if (data.needsBitmap) {
          try {
            bitmap = await createImageBitmap(image)
            if (active) worker.postMessage({ source: bitmap, annotations }, [bitmap])
            else bitmap.close()
          } catch (error) {
            reject(error)
          }
          return
        }
        if (data.image) resolve(data.image)
        else reject(new Error(data.error ?? 'Unable to encode the edited image.'))
      }
      worker.onerror = () => reject(new Error('Unable to save the edited image.'))
      worker.onmessageerror = () => reject(new Error('Unable to read the edited image.'))
      worker.postMessage({ source: image.currentSrc || image.src, annotations })
    })
  } finally {
    active = false
    worker.terminate()
    bitmap?.close()
  }
}
