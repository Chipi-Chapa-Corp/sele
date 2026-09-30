import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppLocalImage, AppSelectedAttachment } from '../shared/app'

const maxImageBytes = 32 * 1024 * 1024
const imageExtensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg'
}

/** Convert transcript attachments into editable, sendable attachments without dropping any. */
export const prepareMessageAttachments = async (
  value: unknown,
  imageDirectory: string,
  readImage: (path: string) => Promise<AppLocalImage>
): Promise<AppSelectedAttachment[]> => {
  if (!Array.isArray(value) || value.length > 10) throw new Error('Invalid message attachments.')
  return Promise.all(
    value
      .filter((attachment) => attachment?.kind !== 'review')
      .map(async (attachment): Promise<AppSelectedAttachment> => {
        if (
          !attachment ||
          typeof attachment.name !== 'string' ||
          !['image', 'file'].includes(attachment.kind)
        ) {
          throw new Error('Invalid message attachment.')
        }
        const path = typeof attachment.path === 'string' && attachment.path ? attachment.path : null
        if (attachment.kind === 'file') {
          if (!path) throw new Error(`The file ${attachment.name} has no usable path.`)
          return { kind: 'file', name: attachment.name, path }
        }
        if (path) {
          const image = await readImage(path)
          return {
            kind: 'image',
            name: attachment.name,
            path,
            dataUrl: `data:${image.mimeType};base64,${Buffer.from(image.data).toString('base64')}`
          }
        }
        const match =
          typeof attachment.dataUrl === 'string'
            ? /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(attachment.dataUrl)
            : null
        const extension = match && imageExtensions[match[1]]
        if (!match || !extension || match[2].length > Math.ceil(maxImageBytes / 3) * 4) {
          throw new Error(`The image ${attachment.name} cannot be loaded for editing.`)
        }
        const data = Buffer.from(match[2], 'base64')
        if (data.length === 0 || data.length > maxImageBytes)
          throw new Error('Choose an image smaller than 32 MB.')
        await mkdir(imageDirectory, { recursive: true })
        const imagePath = join(imageDirectory, `edited-image-${randomUUID()}.${extension}`)
        await writeFile(imagePath, data)
        return {
          kind: 'image',
          name: attachment.name,
          path: imagePath,
          dataUrl: attachment.dataUrl
        }
      })
  )
}
