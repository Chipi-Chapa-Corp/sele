import type { AppLocalImage } from '../../shared/app'

export const createLocalImageUrl = (image: AppLocalImage): string =>
  URL.createObjectURL(new Blob([image.data], { type: image.mimeType }))
