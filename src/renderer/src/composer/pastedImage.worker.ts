import { annotationGeometry, type ImageAnnotation } from './imageAnnotations'

// Full-resolution decoding, drawing, encoding and thumbnail scaling stay off the UI thread.
self.onmessage = async (
  event: MessageEvent<Blob | { source: string | ImageBitmap; annotations: ImageAnnotation[] }>
): Promise<void> => {
  let bitmap: ImageBitmap | undefined
  try {
    const request = event.data
    let source: string | Blob | ImageBitmap = request instanceof Blob ? request : request.source
    if (typeof source === 'string') {
      const response = await fetch(source)
      if (!response.ok) throw new Error('Unable to read the image for saving.')
      source = await response.blob()
      // Chromium's worker decoder does not support SVG. Ask for a transferable
      // snapshot of the browser's decoded SVG, then composite it here as usual.
      if (source.type === 'image/svg+xml') {
        self.postMessage({ needsBitmap: true })
        return
      }
    }
    bitmap = source instanceof ImageBitmap ? source : await createImageBitmap(source)
    if (!(request instanceof Blob)) {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      try {
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Unable to prepare the edited image.')
        context.drawImage(bitmap, 0, 0)
        for (const annotation of request.annotations) {
          const { shaft, head, label } = annotationGeometry(annotation, canvas)
          context.fillStyle = '#ff0000'
          context.strokeStyle = '#ff0000'
          context.lineWidth = annotation.width
          context.lineCap = 'round'
          context.lineJoin = 'round'
          if (annotation.tool !== 'number') {
            context.stroke(new Path2D(shaft))
            if (head) context.fill(new Path2D(head))
          }
          if (annotation.number !== undefined) {
            const text = String(annotation.number)
            context.font = `${annotation.fontWeight} ${annotation.fontSize}px sans-serif`
            context.textAlign = 'center'
            context.textBaseline = 'middle'
            context.strokeStyle = 'white'
            context.lineWidth = annotation.fontSize / 10
            context.strokeText(text, label.x, label.y)
            context.fillText(text, label.x, label.y)
          }
        }
        const image = await canvas.convertToBlob({ type: 'image/png' })
        self.postMessage({ image })
      } finally {
        canvas.width = 0
        canvas.height = 0
      }
      return
    }
    const scale = Math.min(1, 192 / Math.max(bitmap.width, bitmap.height))
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale))
    )
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Unable to prepare the image preview.')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const preview = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 })
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('Unable to encode the image preview.'))
      reader.readAsDataURL(preview)
    })
    self.postMessage({ preview: dataUrl })
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'Unable to decode the pasted image.'
    })
  } finally {
    bitmap?.close()
  }
}
