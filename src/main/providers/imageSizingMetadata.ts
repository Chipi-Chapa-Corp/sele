// Providers can persist image sizing hints as synthetic user messages after tool output.
// Match only standalone hints so ordinary discussion of this text stays visible.
export const isImageSizingMetadata = (content: string): boolean =>
  /^(?:\s*\[Image: original \d+x\d+, displayed at \d+x\d+\. Multiply coordinates by \d+(?:\.\d+)? to map to original image\.\]\s*)+$/.test(
    content
  )
