import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { getProcessFailureMessage } from './processFailure.ts'

const require = createRequire(import.meta.url)
const source = ts.transpileModule(
  readFileSync(new URL('./externalLink.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText

const harness = ({
  platform = 'linux',
  flatpak = false,
  bridge = null,
  failure = null,
  env = {}
} = {}) => {
  const nativeUrls = []
  const hostRequests = []
  const commands = []
  let probes = 0
  const mocks = {
    './processFailure': { getProcessFailureMessage },
    electron: { shell: { openExternal: async (url) => nativeUrls.push(url) } },
    './currentContainer': {
      getCurrentContainerHostBridge: async () => {
        probes++
        return bridge
      }
    },
    './hostProcess': {
      isRunningInFlatpak: () => flatpak,
      getHostCommand: async (file, args) => {
        hostRequests.push({ file, args })
        return {
          file: flatpak ? 'flatpak-spawn' : bridge.file,
          args: ['--host', file, ...args],
          env: { HOST_MARKER: '1' }
        }
      }
    },
    'node:child_process': {
      execFile: (file, args, options, callback) => {
        commands.push({ file, args, options })
        callback(failure, '', failure ? 'Host browser could not be launched' : '')
      }
    }
  }
  const context = {
    exports: {},
    require: (name) => mocks[name] ?? require(name),
    process: { platform, env }
  }
  vm.runInNewContext(source, context)
  return {
    open: context.exports.openExternalLink,
    nativeUrls,
    hostRequests,
    commands,
    probes: () => probes
  }
}

for (const platform of ['darwin', 'win32', 'linux']) {
  test(`opens links with the native desktop on ${platform} without a host bridge`, async () => {
    const app = harness({ platform })
    await app.open('https://example.com/')
    assert.deepEqual(app.nativeUrls, ['https://example.com/'])
    assert.equal(app.commands.length, 0)
    assert.equal(app.probes(), platform === 'linux' ? 1 : 0)
  })
}

for (const environment of [
  { name: 'Distrobox', bridge: { file: 'distrobox-host-exec', argsPrefix: [] } },
  { name: 'Flatpak', flatpak: true }
]) {
  test(`opens links on the host in ${environment.name} and preserves the URL argument`, async () => {
    const app = harness(environment)
    const url = 'https://example.com/?q=a%20b&literal=$(echo%20test)'
    await app.open(url)
    assert.equal(app.nativeUrls.length, 0)
    assert.equal(app.hostRequests[0].file, 'env')
    assert.deepEqual(Array.from(app.hostRequests[0].args), ['xdg-open', url])
    assert.equal(app.commands[0].args.at(-1), url)
    assert.equal(app.commands[0].options.env.HOST_MARKER, '1')
    assert.equal(app.commands[0].options.timeout, 15000)
    assert.equal(app.commands[0].options.shell, undefined)
  })
}

test('reports a failed host launch instead of claiming the link was opened', async () => {
  const failure = new Error('Command failed')
  const app = harness({ flatpak: true, failure })
  await assert.rejects(app.open('https://example.com/'), (error) => {
    assert.equal(error.message, 'Host browser could not be launched')
    assert.equal(error.cause, failure)
    return true
  })
  assert.equal(app.nativeUrls.length, 0)
})

test('system protocol links also use the host desktop in a container', async () => {
  const app = harness({ flatpak: true })
  await app.open('mailto:hello@example.com')
  assert.deepEqual(Array.from(app.hostRequests[0].args), ['xdg-open', 'mailto:hello@example.com'])
})

test('preserves the GUI session across a Distrobox host bridge without forwarding other variables', async () => {
  const app = harness({
    bridge: { file: 'distrobox-host-exec', argsPrefix: [] },
    env: {
      DISPLAY: ':0',
      WAYLAND_DISPLAY: 'wayland-0',
      XAUTHORITY: '/run/user/1000/Xauthority',
      XDG_CURRENT_DESKTOP: 'GNOME',
      XDG_SESSION_TYPE: 'wayland',
      XDG_CONFIG_HOME: '/container/config',
      ANTHROPIC_API_KEY: 'test-secret'
    }
  })
  await app.open('https://example.com/')
  assert.deepEqual(Array.from(app.hostRequests[0].args), [
    'DISPLAY=:0',
    'WAYLAND_DISPLAY=wayland-0',
    'XAUTHORITY=/run/user/1000/Xauthority',
    'XDG_CURRENT_DESKTOP=GNOME',
    'XDG_SESSION_TYPE=wayland',
    'xdg-open',
    'https://example.com/'
  ])
})

test('does not pass Flatpak-only Xauthority paths to the host', async () => {
  const app = harness({
    flatpak: true,
    env: { DISPLAY: ':0', XAUTHORITY: '/run/flatpak/Xauthority' }
  })
  await app.open('https://example.com/')
  assert.deepEqual(Array.from(app.hostRequests[0].args), [
    'DISPLAY=:0',
    'xdg-open',
    'https://example.com/'
  ])
})
