import { appApi } from './appApi'

// Use the preview's decoded pixels: the native clipboard decoder supports fewer
// formats than Chromium, and rereading the file can copy a different version.
export const copyRenderedImage = async (image: HTMLImageElement): Promise<void> => {
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context || !canvas.width || !canvas.height) {
    throw new Error('Could not prepare the image for copying. Try reopening the preview.')
  }
  context.drawImage(image, 0, 0)
  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not convert the preview to a clipboard image.'))
    }, 'image/png')
  })
  await appApi.writeClipboardImage(await png.arrayBuffer())
}
