const videoMimeTypes: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
  ogg: 'video/ogg'
}

export const getVideoMimeType = (path: string): string | null => {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? ''
  return Object.hasOwn(videoMimeTypes, extension) ? videoMimeTypes[extension] : null
}
