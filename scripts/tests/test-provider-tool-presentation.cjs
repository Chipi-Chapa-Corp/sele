const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')

if (!process.versions.electron) {
  const { build } = require('esbuild')
  const { spawnSync } = require('node:child_process')
  ;(async () => {
    const directory = await fs.mkdtemp(
      path.join(require('node:os').tmpdir(), 'sele-provider-tools-')
    )
    try {
      // Project native records in Node, then render the resulting view models in Electron.
      const { outputFiles } = await build({
        stdin: {
          contents: `
            import { renderClaudeChatItems } from './src/main/providers/claude/ClaudeItemRenderers'
            import { renderOpenCodeChatItems } from './src/main/providers/opencode/OpenCodeItemRenderers'
            import { renderCopilotChatItems } from './src/main/providers/copilot/CopilotItemRenderers'
            export const fixtures = {}
            for (const provider of ['claude', 'opencode', 'copilot']) {
              for (const operation of ['fetch_file', 'create_issue', 'native-read']) {
                for (const finished of [false, true]) {
                  const input = { path: '/repo/file.ts', file_path: '/repo/file.ts', command: 'private-protocol-input' }
                  const options = { active: !finished, stopped: false }
                  let items
                  if (provider === 'claude') {
                    const source = [{ type: 'assistant', uuid: 'call', message: { content: [{ type: 'tool_use', id: 'call', name: operation === 'native-read' ? 'Read' : 'mcp__github__' + operation, input }] } }]
                    if (finished) source.push({ type: 'user', uuid: 'result', message: { content: [{ type: 'tool_result', tool_use_id: 'call', content: 'private-protocol-output' }] } })
                    items = renderClaudeChatItems(source, options)
                  } else if (provider === 'opencode') {
                    items = renderOpenCodeChatItems([{ info: { id: 'call', role: 'assistant', time: { created: 1000 } }, parts: [{ type: 'tool', id: 'call', callID: 'call', tool: operation === 'native-read' ? 'read' : 'github_' + operation, state: { status: finished ? 'completed' : 'running', input, output: 'private-protocol-output', metadata: {}, time: { start: 1000, end: 2000 } } }] }], options)
                  } else {
                    const source = [{ type: 'tool.execution_start', id: 'call', data: { toolCallId: 'call', toolName: operation === 'native-read' ? 'read_file' : operation, mcpServerName: operation === 'native-read' ? undefined : 'github', arguments: input } }]
                    if (finished) source.push({ type: 'tool.execution_complete', id: 'result', data: { toolCallId: 'call', success: true, result: { content: 'private-protocol-output' } } })
                    items = renderCopilotChatItems(source, options)
                  }
                  fixtures[[provider, operation, finished].join(':')] = items
                }
              }
            }
          `,
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'ts'
        },
        bundle: true,
        platform: 'node',
        format: 'esm',
        write: false
      })
      const { fixtures } = await import(
        `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
      )
      await build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { ChatDetailItem } from './src/renderer/src/components/ChatDetailItem'
            const fixtures = ${JSON.stringify(fixtures)}
            const root = createRoot(document.getElementById('root'))
            window.fixtureKeys = Object.keys(fixtures)
            window.renderFixture = key => flushSync(() => root.render(
              fixtures[key].map(item => <ChatDetailItem key={item.id} item={item} />)
            ))
          `,
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx'
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        outfile: path.join(directory, 'fixture.js'),
        loader: { '.woff2': 'dataurl', '.ttf': 'dataurl' },
        plugins: [
          {
            name: 'unused-workers',
            setup(builder) {
              builder.onResolve({ filter: /\?worker$/ }, (args) => ({
                path: args.path,
                namespace: 'worker'
              }))
              builder.onLoad({ filter: /.*/, namespace: 'worker' }, () => ({
                contents: 'export default class {}'
              }))
            }
          }
        ]
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<div id="root"></div><script src="fixture.js"></script>'
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = spawnSync(require('electron'), [__filename, directory, '--no-sandbox'], {
        env,
        encoding: 'utf8',
        timeout: 30000
      })
      process.stdout.write(result.stdout || '')
      if (result.status !== 0) throw new Error(result.stderr || String(result.error))
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow } = require('electron')
  app.setPath('userData', path.join(process.argv[2], 'profile'))
  app
    .whenReady()
    .then(async () => {
      const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
      await window.loadFile(path.join(process.argv[2], 'index.html'))
      const states = await window.webContents.executeJavaScript(`(async () => {
      const states = []
      for (const key of fixtureKeys) {
        renderFixture(key)
        await new Promise(resolve => setTimeout(resolve, 30))
        const progress = document.querySelector('details.chat-detail__working')
        if (!progress.open) { progress.querySelector('summary').click(); await new Promise(resolve => setTimeout(resolve, 30)) }
        states.push({ key, label: document.querySelector('.chat-detail__tool-read')?.textContent,
          disclosures: document.querySelectorAll('.chat-detail__tool-group').length,
          text: document.body.textContent })
      }
      return states
    })()`)
      for (const state of states) {
        const [, operation, completed] = state.key.split(':')
        const finished = completed === 'true'
        const expected =
          operation === 'create_issue'
            ? finished
              ? 'Created issue in GitHub'
              : 'Creating issue in GitHub'
            : (finished ? 'Read ' : 'Reading ') +
              (operation === 'native-read' ? 'file.ts' : 'file from GitHub')
        assert.equal(state.label, expected, JSON.stringify(state))
        assert.equal(state.disclosures, 0)
        assert.doesNotMatch(state.text, /private-protocol|mcp__|github_/)
      }
      assert.equal(states.length, 18)
      console.log('Claude, OpenCode and Copilot tool presentation passed in Electron.')
      app.quit()
    })
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
}
