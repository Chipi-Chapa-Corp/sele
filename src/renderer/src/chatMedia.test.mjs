import assert from 'node:assert/strict'
import test from 'node:test'
import { chatMediaId, getChatItemMedia, getMarkdownMedia } from './chatMedia.ts'

test('indexes media occurrences in order, excluding links, code and raw HTML', () => {
  const content = [
    '[File](./linked.png) [Web](https://example.com/image.png)',
    '`![Inline code](./inline.png)`',
    '<img src="./raw.png">',
    '```md\n![Fenced](./code.png)\n```',
    '![One](./same.png) ![Two](./same.png)',
    '[![Linked preview](https://example.com/preview.png)](https://example.com)',
    '[![Video poster](./poster.png)](./clip.webm)',
    '![Reference][picture]\n\n[picture]: ./reference.png'
  ].join('\n\n')
  const options = { cwd: '/work', relativeTo: 'cwd' }
  const sources = getMarkdownMedia(content, 'response', options)
  assert.deepEqual(
    sources.map(({ path, url }) => path ?? url),
    [
      './same.png',
      './same.png',
      'https://example.com/preview.png',
      './clip.webm',
      './reference.png'
    ]
  )
  assert.equal(sources[3].mediaType, 'video')
  assert.equal(new Set(sources.map((source) => source.id)).size, 5)
  assert.equal(sources[4].id, chatMediaId('response', 'markdown', 4))
  assert.equal(sources[0].localImageOptions, options)
  assert.equal(sources[2].localImageOptions, undefined)
})

test('finds video links regardless of extension case or link form, and ignores media-free text', () => {
  const paths = (content) =>
    getMarkdownMedia(content, 'response').map(({ path, url, mediaType }) => [
      path ?? url,
      mediaType
    ])
  assert.deepEqual(paths('[Clip](./clip.MOV) and [Angle](<./angle clip.mp4>)'), [
    ['./clip.MOV', 'video'],
    ['./angle clip.mp4', 'video']
  ])
  assert.deepEqual(paths('[Encoded](./clip%2Ewebm) [Escaped](./take\\.mp4)'), [
    ['./clip.webm', 'video'],
    ['./take.mp4', 'video']
  ])
  assert.deepEqual(
    paths('Remove the [movie notes](./notes.md), see [docs](https://example.com) and `x.mp4`.'),
    []
  )
})

test('includes all attachments before response content and keeps data-only images', () => {
  const sources = getChatItemMedia({
    type: 'message',
    id: 'user',
    role: 'user',
    content: '![Inline](./inline.png)',
    attachments: [
      { kind: 'image', name: 'First', path: './same.png' },
      { kind: 'file', name: 'File', path: './file.png' },
      { kind: 'image', name: 'Second', path: './same.png' },
      { kind: 'image', name: 'Clipboard', dataUrl: 'data:image/png;base64,abc' }
    ]
  })
  assert.deepEqual(
    sources.map((source) => source.name),
    ['First', 'Second', 'Clipboard', 'Inline']
  )
  assert.equal(sources[2].url, 'data:image/png;base64,abc')
  assert.equal(sources[1].id, chatMediaId('user', 'attachment', 1))
})

test('collects collapsed tool images and working messages in segment order', () => {
  const early = { type: 'message', id: 'reasoning', content: '![Reasoning](./reasoning.png)' }
  const tool = {
    type: 'tool',
    id: 'tool',
    images: [{ path: './generated.png' }, { path: './generated.png' }]
  }
  const sources = getChatItemMedia({
    type: 'working',
    id: 'step',
    status: 'worked',
    items: [early, tool],
    itemSegments: [
      { kind: 'tail', startIndex: 100, items: [{ type: 'toolGroup', id: 'group', tools: [tool] }] },
      { kind: 'history', startIndex: 0, items: [early] }
    ]
  })
  assert.deepEqual(
    sources.map((source) => source.path),
    ['./reasoning.png', './generated.png', './generated.png']
  )
  assert.equal(sources[2].id, chatMediaId('tool', 'image', 1))
})
