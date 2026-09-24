import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const bundled = await build({
  entryPoints: [new URL('./ClaudeAccountStorage.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  plugins: [
    {
      name: 'isolate-account-storage',
      setup(build) {
        build.onResolve({ filter: /^\.\.\/\.\.\/(hostProcess|currentContainer)$/ }, (args) => ({
          path: args.path,
          namespace: 'test'
        }))
        build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({
          contents: path.endsWith('hostProcess')
            ? `export const isRunningInFlatpak = () => false;
         export const getHostCommand = async (file,args,options) => {
           globalThis.commands.push({file,args,options});
           return {file,args,env:options.env};
         };`
            : 'export const getCurrentContainerHostBridge = async () => null;'
        }))
      }
    }
  ]
})

const setup = (root, platform) => {
  const commands = []
  const security = []
  const module = { exports: {} }
  const context = {
    module,
    exports: module.exports,
    commands,
    Buffer,
    process: {
      ...process,
      platform,
      env: { ...process.env, CLAUDE_CONFIG_DIR: root, USER: 'fixture-user' }
    },
    require: (name) =>
      name === 'node:child_process'
        ? {
            ...require(name),
            execFile(file, args, options, callback) {
              if (file === '/usr/bin/security') {
                security.push(args)
                callback(Object.assign(new Error('not found'), { code: 44 }))
                return {}
              }
              return require(name).execFile(file, args, options, callback)
            }
          }
        : require(name)
  }
  vm.runInNewContext(bundled.outputFiles[0].text, context)
  return { create: module.exports.createClaudeAccountStorage, commands, security }
}

for (const platform of ['linux', 'darwin', 'win32']) {
  test(`${platform}: native storage changes only account files, and scopes Keychain deletion`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'sele-native-accounts-'))
    try {
      await mkdir(join(root, 'projects'))
      await writeFile(join(root, 'projects', 'chat.jsonl'), 'shared history')
      await writeFile(join(root, '.credentials.json'), 'default credentials')
      const h = setup(root, platform)
      const storage = await h.create()
      assert.equal(await storage.read(), null)
      const id = '11111111-1111-4111-8111-111111111111'
      await storage.createCredentials(id)
      const directory = storage.credentialDirectory(id)
      await writeFile(join(directory, '.credentials.json'), 'managed credentials')
      assert.equal(await storage.readCredentials('default'), 'default credentials')
      assert.equal(await storage.readCredentials(id), 'managed credentials')
      await storage.write('{"activeId":"default","accounts":[]}')
      assert.equal(await storage.read(), '{"activeId":"default","accounts":[]}')
      const shared = { CLAUDE_CONFIG_DIR: root }
      const originalUsage = await storage.usageEnvironment('default', shared)
      const managedUsage = await storage.usageEnvironment(id, {
        ...shared,
        CLAUDE_SECURESTORAGE_CONFIG_DIR: directory
      })
      assert.equal(originalUsage.CLAUDE_SECURESTORAGE_CONFIG_DIR, root)
      assert.equal(managedUsage.CLAUDE_SECURESTORAGE_CONFIG_DIR, directory)
      assert.notEqual(originalUsage.CLAUDE_CONFIG_DIR, managedUsage.CLAUDE_CONFIG_DIR)
      await writeFile(join(originalUsage.CLAUDE_CONFIG_DIR, '.claude.json'), 'default usage cache')
      await writeFile(join(managedUsage.CLAUDE_CONFIG_DIR, '.claude.json'), 'managed usage cache')
      assert.equal(
        await readFile(join(originalUsage.CLAUDE_CONFIG_DIR, '.claude.json'), 'utf8'),
        'default usage cache'
      )
      // Empty is significant on macOS: the unsuffixed Keychain service is the default.
      assert.equal(
        (await storage.usageEnvironment('default', {})).CLAUDE_SECURESTORAGE_CONFIG_DIR,
        ''
      )
      assert.equal(
        (
          await storage.usageEnvironment('default', {
            ...shared,
            CLAUDE_SECURESTORAGE_CONFIG_DIR: ''
          })
        ).CLAUDE_SECURESTORAGE_CONFIG_DIR,
        ''
      )
      await storage.removeCredentials(id)
      await assert.rejects(stat(directory), { code: 'ENOENT' })
      await assert.rejects(stat(managedUsage.CLAUDE_CONFIG_DIR), { code: 'ENOENT' })
      assert.equal(
        await readFile(join(originalUsage.CLAUDE_CONFIG_DIR, '.claude.json'), 'utf8'),
        'default usage cache'
      )
      assert.equal(await readFile(join(root, '.credentials.json'), 'utf8'), 'default credentials')
      assert.equal(await readFile(join(root, 'projects', 'chat.jsonl'), 'utf8'), 'shared history')
      assert.equal(h.commands.length, 0)
      if (platform === 'darwin') {
        const suffix = createHash('sha256')
          .update(directory.normalize('NFC'))
          .digest('hex')
          .slice(0, 8)
        assert.deepEqual(
          Array.from(h.security.find((args) => args[0] === 'delete-generic-password')),
          [
            'delete-generic-password',
            '-s',
            `Claude Code-credentials-${suffix}`,
            '-a',
            'fixture-user'
          ]
        )
      } else assert.equal(h.security.length, 0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}

test('remote POSIX storage preserves paths and names containing shell metacharacters', {
  skip: process.platform === 'win32'
}, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'sele-remote-accounts-'))
  const root = join(temporary, "config ' $(false) space")
  try {
    const h = setup(root, 'linux')
    const storage = await h.create({ kind: 'container', tool: 'ssh', name: 'fixture' })
    const id = '11111111-1111-4111-8111-111111111111'
    await storage.createCredentials(id)
    await writeFile(join(root, '.credentials.json'), 'remote default credentials')
    await writeFile(
      join(storage.credentialDirectory(id), '.credentials.json'),
      'remote managed credentials'
    )
    assert.equal(await storage.readCredentials('default'), 'remote default credentials')
    assert.equal(await storage.readCredentials(id), 'remote managed credentials')
    const value = JSON.stringify({
      activeId: id,
      accounts: [{ id, name: "My ' account $(false)\n" }]
    })
    await storage.write(value)
    assert.equal(await storage.read(), value)
    assert.equal(storage.credentialDirectory(id), join(root, 'sele', 'accounts', id))
    const originalUsage = await storage.usageEnvironment('default', {})
    const managedUsage = await storage.usageEnvironment(id, {
      CLAUDE_SECURESTORAGE_CONFIG_DIR: storage.credentialDirectory(id)
    })
    assert.equal(originalUsage.CLAUDE_SECURESTORAGE_CONFIG_DIR, root)
    assert.equal(managedUsage.CLAUDE_SECURESTORAGE_CONFIG_DIR, storage.credentialDirectory(id))
    assert.notEqual(originalUsage.CLAUDE_CONFIG_DIR, managedUsage.CLAUDE_CONFIG_DIR)
    assert.ok((await stat(managedUsage.CLAUDE_CONFIG_DIR)).isDirectory())
    await storage.removeCredentials(id)
    await assert.rejects(stat(storage.credentialDirectory(id)), { code: 'ENOENT' })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
