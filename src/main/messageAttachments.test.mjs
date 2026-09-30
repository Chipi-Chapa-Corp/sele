import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { prepareMessageAttachments } from './messageAttachments.ts'

const imageBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
  'base64'
)
const dataUrl = `data:image/png;base64,${imageBytes.toString('base64')}`

test('prepares every screenshot and file with its original sendable path', async () => {
  const attachments = [
    { kind: 'image', name: 'one.png', path: '/one.png' },
    { kind: 'image', name: 'two.png', path: '/two.png' },
    { kind: 'file', name: 'notes.txt', path: '/notes.txt' }
  ]
  const paths = []
  const result = await prepareMessageAttachments(attachments, '/unused', async (path) => {
    paths.push(path)
    return { data: imageBytes, mimeType: 'image/png' }
  })
  assert.deepEqual(result, [
    { ...attachments[0], dataUrl },
    { ...attachments[1], dataUrl },
    attachments[2]
  ])
  assert.deepEqual(paths, ['/one.png', '/two.png'])
})

test('inline history screenshots become local attachments and remain byte-identical', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-edit-images-'))
  try {
    const [image] = await prepareMessageAttachments(
      [{ kind: 'image', name: 'screenshot.png', dataUrl }],
      directory,
      () => assert.fail('no local path')
    )
    assert.equal(image.dataUrl, dataUrl)
    assert.deepEqual(await readFile(image.path), imageBytes)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('unavailable screenshots fail preparation instead of disappearing from the edit', async () => {
  await assert.rejects(
    prepareMessageAttachments(
      [{ kind: 'image', name: 'missing.png', path: '/missing.png' }],
      '/unused',
      async () => {
        throw new Error('Image unavailable')
      }
    ),
    /Image unavailable/
  )
  await assert.rejects(
    prepareMessageAttachments([{ kind: 'image', name: 'missing.png' }], '/unused', async () => {}),
    /cannot be loaded/
  )
})

test('rejects malformed and oversized inline screenshots before writing them', async () => {
  for (const dataUrl of [
    'https://example.com/image.png',
    'data:text/html;base64,YQ==',
    'data:image/png;base64,',
    `data:image/png;base64,${'A'.repeat(45 * 1024 * 1024)}`
  ]) {
    await assert.rejects(
      prepareMessageAttachments(
        [{ kind: 'image', name: 'bad', dataUrl }],
        '/unused',
        async () => {}
      )
    )
  }
})
