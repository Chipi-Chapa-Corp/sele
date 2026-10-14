import { clipboard, nativeImage } from 'electron'

export const writeClipboardImage = (value: unknown): void => {
  if (!(value instanceof ArrayBuffer) || value.byteLength === 0) {
    throw new Error('No image data was received from the preview. Try copying again.')
  }
  const image = nativeImage.createFromBuffer(Buffer.from(value))
  if (image.isEmpty()) {
    throw new Error('The clipboard image could not be decoded. Try reopening the preview.')
  }
  clipboard.writeImage(image)
}
