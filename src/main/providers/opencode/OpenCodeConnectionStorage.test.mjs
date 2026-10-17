import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'

const bundled = await build({
  entryPoints: ['src/main/providers/opencode/OpenCodeConnectionStorage.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  plugins: [
    {
      name: 'target-fixture',
      setup(builder) {
        builder.onResolve({ filter: /\/hostProcess$/ }, () => ({
          path: 'hostProcess',
          namespace: 'fixture'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents:
            'export const getHostCommand = (...args) => globalThis.harness.getHostCommand(...args)'
        }))
      }
    }
  ]
})
const require = createRequire(import.meta.url)

test('credential metadata reads use the selected target and never return secret values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-connection-storage-'))
  try {
    await mkdir(join(directory, 'opencode'))
    await writeFile(
      join(directory, 'opencode', 'auth.json'),
      JSON.stringify({
        openai: { type: 'api', key: 'private-key' },
        anthropic: { type: 'oauth', refresh: 'private-token' }
      })
    )
    const calls = []
    const module = { exports: {} }
    vm.runInNewContext(bundled.outputFiles[0].text, {
      module,
      exports: module.exports,
      require,
      process,
      harness: {
        getHostCommand: async (file, args, options) => {
          calls.push({ file, args, options })
          return { file, args, env: { ...process.env, XDG_DATA_HOME: directory } }
        }
      }
    })
    const target = { kind: 'container', tool: 'toolbox', name: 'fixture' }
    const metadata = await module.exports.readOpenCodeCredentialTypes(target)
    assert.equal(JSON.stringify(metadata), '{"openai":"api","anthropic":"oauth"}')
    assert.deepEqual(calls[0].options.container, target)
    assert.equal(calls[0].file, 'sh')
    await rm(join(directory, 'opencode', 'auth.json'))
    assert.equal(JSON.stringify(await module.exports.readOpenCodeCredentialTypes(target)), '{}')
    await writeFile(join(directory, 'opencode', 'auth.json'), 'private-malformed-content')
    await assert.rejects(
      module.exports.readOpenCodeCredentialTypes(target),
      (error) => error.message === 'Unable to read OpenCode credential metadata.'
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
