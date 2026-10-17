import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeBrowserGif } from './BrowserGif.ts'

test('GIF encoder writes animated indexed frames and validates bounded recording dimensions', () => {
  const frame = { width: 20, height: 20, bgra: new Uint8Array(20 * 20 * 4).fill(255), delayMs: 250 }
  const gif = encodeBrowserGif([frame, frame])
  assert.equal(gif.subarray(0, 6).toString(), 'GIF89a')
  assert.equal(gif.readUInt16LE(6), 20)
  assert.equal(gif.readUInt16LE(8), 20)
  assert.equal(gif.at(-1), 0x3b)
  assert.ok(gif.includes(Buffer.from('NETSCAPE2.0')))
  assert.throws(() => encodeBrowserGif([]), /between 1 and 20/)
  assert.throws(() => encodeBrowserGif(Array(21).fill(frame)), /between 1 and 20/)
  assert.throws(() => encodeBrowserGif([{ ...frame, width: 1000 }]), /dimensions/)
  assert.throws(() => encodeBrowserGif([frame, { ...frame, width: 10 }]), /viewport changed/)
})
