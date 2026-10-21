import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { build } from 'esbuild'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const result = await build({
  stdin: {
    contents:
      "export { ChatListItem } from './ChatListItem'; export { chatTerminalActivity } from '../chatTerminalActivity'",
    resolveDir: fileURLToPath(new URL('.', import.meta.url)),
    loader: 'tsx'
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  plugins: [
    {
      name: 'omit-menu-portals',
      setup(build) {
        build.onResolve({ filter: /^\.\/Dropdown$/ }, () => ({
          path: 'Dropdown',
          namespace: 'fixture'
        }))
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: 'export const Dropdown = () => null'
        }))
      }
    }
  ]
})
const module = { exports: {} }
vm.runInNewContext(result.outputFiles[0].text, {
  module,
  exports: module.exports,
  require: createRequire(import.meta.url),
  window: { providerApi: {} },
  setInterval,
  clearInterval
})
const { ChatListItem, chatTerminalActivity } = module.exports
const render = (outcome, extra = {}, props = {}) =>
  renderToStaticMarkup(
    createElement(ChatListItem, {
      chat: {
        id: 'chat',
        providerId: 'codex',
        title: 'Chat',
        cwd: '/repo',
        createdAt: 1000,
        updatedAt: 2000,
        seenUpdatedAt: 2000,
        status: null,
        lastTurnOutcome: outcome,
        ...extra
      },
      selected: false,
      onClick() {},
      onMarkDone() {},
      onRename() {},
      onResolveApproval() {},
      onTogglePinned() {},
      ...props
    })
  )

for (const providerId of ['codex', 'claude', 'copilot', 'opencode']) {
  test(`${providerId}: failed and stopped reminders stay visible when read, selected and done`, () => {
    for (const [outcome, indicator, label] of [
      ['failed', 'error', 'Error'],
      ['stopped', 'stopped', 'Stopped']
    ]) {
      for (const props of [{}, { selected: true }, { childOpen: true }]) {
        const markup = render(outcome, { providerId }, props)
        assert.match(markup, new RegExp(`chat-list-item__status--${indicator}`))
        assert.match(markup, new RegExp(`aria-label="${label}"`))
      }
      assert.match(
        render(outcome, { providerId, done: true }),
        new RegExp(`chat-list-item__status--${indicator}`)
      )
      assert.doesNotMatch(
        render(outcome, { providerId, seenUpdatedAt: 0 }),
        /status--finished-unseen/
      )
    }
  })
}

test('a successful latest turn clears the reminder even if the chat status still contains an error', () => {
  assert.doesNotMatch(render(null, { status: 'error' }), /chat-list-item__status--error/)
  assert.doesNotMatch(render(null), /chat-list-item__status--/)
  assert.match(render(null, { seenUpdatedAt: 0 }), /status--finished-unseen/)
})

test('working and approval indicators keep their existing priority', () => {
  assert.match(render('failed', { status: 'active' }), /aria-label="In progress"/)
  assert.doesNotMatch(render('failed', { status: 'active' }), /status--error/)
  assert.match(
    render('stopped', { status: 'waitingOnApproval' }),
    /aria-label="Waiting for approval"/
  )
})

test('stopped dots use the neutral gray theme color', () => {
  const css = readFileSync(new URL('./ChatListItem.css', import.meta.url), 'utf8')
  assert.match(css, /\.chat-list-item__status--stopped\s*\{\s*background: var\(--muted\)/)
})

test('a startup list with no saved read timestamp shows an unread dot', () => {
  assert.match(render(null, { seenUpdatedAt: null }), /status--finished-unseen/)
  assert.doesNotMatch(render(null, { seenUpdatedAt: 2000 }), /status--finished-unseen/)
  assert.match(render('failed', { seenUpdatedAt: null }), /status--error/)
  assert.match(render('stopped', { seenUpdatedAt: null }), /status--stopped/)
})

for (const providerId of ['codex', 'claude', 'copilot', 'opencode']) {
  test(`${providerId}: an idle terminal task replaces the dot, then completion marks even a read chat unread`, () => {
    const key = `${providerId}:chat`
    chatTerminalActivity.setIdle(key, true)
    chatTerminalActivity.report(key, 'panel', ['task'])
    assert.match(render(null, { providerId }), /aria-label="Terminal task running"/)
    assert.doesNotMatch(
      render(null, { providerId, status: 'active' }),
      /aria-label="Terminal task running"/
    )
    chatTerminalActivity.report(key, 'panel', [])
    assert.match(render(null, { providerId }), /status--finished-unseen/)
    chatTerminalActivity.markSeen(key)
    assert.doesNotMatch(render(null, { providerId }), /status--finished-unseen/)
  })
}
