export type BrowserGifFrame = { width: number; height: number; bgra: Uint8Array; delayMs: number }

/** Fixed RGB332 palette keeps recording memory and encoding work bounded. */
export function encodeBrowserGif(frames: BrowserGifFrame[]): Buffer {
  if (!frames.length || frames.length > 20) throw new Error('GIF requires between 1 and 20 frames')
  const { width, height } = frames[0]
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 640 ||
    height > 480
  )
    throw new Error('GIF frame dimensions exceed the recording limit')
  const word = (value: number): Buffer => {
    const result = Buffer.alloc(2)
    result.writeUInt16LE(value)
    return result
  }
  const chunks = [Buffer.from('GIF89a'), word(width), word(height), Buffer.from([0xf7, 0, 0])]
  const palette = Buffer.alloc(256 * 3)
  for (let index = 0; index < 256; index++) {
    palette[index * 3] = Math.round((((index >> 5) & 7) * 255) / 7)
    palette[index * 3 + 1] = Math.round((((index >> 2) & 7) * 255) / 7)
    palette[index * 3 + 2] = Math.round(((index & 3) * 255) / 3)
  }
  chunks.push(
    palette,
    Buffer.from([0x21, 0xff, 11]),
    Buffer.from('NETSCAPE2.0'),
    Buffer.from([3, 1, 0, 0, 0])
  )
  for (const frame of frames) {
    if (
      frame.width !== width ||
      frame.height !== height ||
      frame.bgra.length !== width * height * 4
    )
      throw new Error('Recording viewport changed; start a new recording at a fixed viewport size')
    chunks.push(
      Buffer.from([0x21, 0xf9, 4, 0]),
      word(Math.max(1, Math.min(65535, Math.round(frame.delayMs / 10)))),
      Buffer.from([0, 0])
    )
    chunks.push(Buffer.from([0x2c, 0, 0, 0, 0]), word(width), word(height), Buffer.from([0, 8]))
    // Literal LZW codes, reset before dictionary growth changes the nine-bit code width.
    // This trades compression for predictable bounded work and a dependency-free encoder.
    const bytes: number[] = []
    let bits = 0
    let bitCount = 0
    const code = (value: number): void => {
      bits |= value << bitCount
      bitCount += 9
      while (bitCount >= 8) {
        bytes.push(bits & 255)
        bits >>>= 8
        bitCount -= 8
      }
    }
    for (let pixel = 0; pixel < width * height; pixel++) {
      if (pixel % 200 === 0) code(256)
      const offset = pixel * 4
      code(
        (frame.bgra[offset + 2] & 0xe0) |
          ((frame.bgra[offset + 1] >> 3) & 0x1c) |
          (frame.bgra[offset] >> 6)
      )
    }
    code(257)
    if (bitCount) bytes.push(bits & 255)
    const data = Buffer.from(bytes)
    for (let offset = 0; offset < data.length; offset += 255) {
      const block = data.subarray(offset, offset + 255)
      chunks.push(Buffer.from([block.length]), block)
    }
    chunks.push(Buffer.from([0]))
  }
  return Buffer.concat([...chunks, Buffer.from([0x3b])])
}
