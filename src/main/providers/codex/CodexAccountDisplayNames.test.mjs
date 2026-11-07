import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, access, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'

for (const platform of ['linux', 'darwin', 'win32']) {
  test(`${platform}: Codex account lifecycle and display names stay in the selected environment without switching accounts`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'sele-codex-display-'))
    const accountId = '00000000-0000-4000-8000-000000000001'
    const token = (name) =>
      JSON.stringify({
        tokens: {
          id_token: `header.${Buffer.from(JSON.stringify({ name })).toString('base64url')}.sig`
        }
      })
    try {
      const managed = join(root, 'sele', 'accounts', accountId)
      const remote = join(root, 'remote')
      await Promise.all([mkdir(managed, { recursive: true }), mkdir(remote)])
      await Promise.all([
        writeFile(join(root, 'auth.json'), token('Personal Name')),
        writeFile(join(managed, 'auth.json'), token('Work Name')),
        writeFile(join(managed, 'name'), 'Custom label'),
        writeFile(join(root, 'sele', 'active-account'), accountId),
        writeFile(join(remote, 'auth.json'), token('Remote Name'))
      ])
      const bundled = await build({
        entryPoints: [new URL('./CodexAccounts.ts', import.meta.url).pathname],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        write: false,
        plugins: [
          createRequire(import.meta.url)('../../../../scripts/tests/helpers/node-workers.cjs')(
            root
          ),
          {
            name: 'fixture-runtime',
            setup(build) {
              build.onResolve({ filter: /\/hostProcess$/ }, (args) => ({
                path: args.path,
                namespace: 'fixture'
              }))
              build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
                contents:
                  'export const getHostCommand = async (file, args, options) => args[1]?.includes("expected_version=$1") ? ({file:process.execPath,args:["-e",""],env:process.env}) : ({ file, args, env: { ...process.env, CODEX_HOME: options.container ? fixture.remote : fixture.root } })'
              }))
            }
          }
        ]
      })
      const loadApi = () => {
        const module = { exports: {} }
        vm.runInNewContext(bundled.outputFiles[0].text, {
          module,
          exports: module.exports,
          require: createRequire(import.meta.url),
          process: { ...process, platform, env: { ...process.env, CODEX_HOME: root } },
          Buffer,
          fixture: { root, remote }
        })
        return module.exports
      }
      const api = loadApi()
      const local = await api.getCodexAccountsWithDisplayNames()
      assert.equal(
        local.accounts.find((account) => account.id === 'default').displayName,
        'Personal Name'
      )
      assert.equal(
        local.accounts.find((account) => account.id === accountId).displayName,
        'Work Name'
      )
      assert.equal(local.accounts.find((account) => account.active).id, accountId)
      assert.equal('name' in local.accounts[1], false)
      assert.equal(await readFile(join(managed, 'ready'), 'utf8'), '')
      await assert.rejects(access(join(managed, 'name')))
      assert.equal(await readFile(join(managed, 'auth.json'), 'utf8'), token('Work Name'))

      const container = {
        kind: 'container',
        name: 'fixture',
        tool: 'fixture'
      }
      const other = await api.getCodexAccountsWithDisplayNames(container)
      assert.equal(other.accounts[0].displayName, 'Remote Name')
      assert.equal(other.accounts.length, 1)
      const created = await api.createCodexAccount()
      const createdHome = join(root, 'sele/accounts', created.accountId)
      assert.match(await readFile(join(createdHome, 'pending'), 'utf8'), /^[0-9a-f-]{36}\n$/)
      await assert.rejects(access(join(createdHome, 'name')))
      await assert.rejects(access(join(createdHome, 'pending-name')))
      // Background account/credit refreshes must not roll back a live browser login.
      for (let index = 0; index < 3; index++) {
        const refresh = await api.getCodexAccountsWithDisplayNames()
        assert.equal(
          refresh.accounts.some((account) => account.id === created.accountId),
          false
        )
        await access(join(createdHome, 'pending'))
      }
      await writeFile(join(createdHome, 'auth.json'), token('Added Name'))
      await api.finalizeCodexAccount(created.accountId)
      const added = await api.getCodexAccountsWithDisplayNames()
      assert.equal(
        added.accounts.find((account) => account.id === created.accountId).displayName,
        'Added Name'
      )
      assert.equal(added.accounts.find((account) => account.active).id, created.accountId)
      const canceled = await api.createCodexAccount()
      await api.getCodexAccountsWithDisplayNames()
      await api.cancelCodexAccountCreation(canceled.accountId)
      await assert.rejects(access(join(root, 'sele/accounts', canceled.accountId)))
      assert.equal(
        (await api.getCodexAccounts()).accounts.find((account) => account.active).id,
        created.accountId
      )
      const interrupted = await api.createCodexAccount()
      const restarted = loadApi()
      assert.equal(
        (await restarted.getCodexAccounts()).accounts.find((account) => account.active).id,
        created.accountId
      )
      await assert.rejects(access(join(root, 'sele/accounts', interrupted.accountId)))

      const remoteCreation = await restarted.createCodexAccount(container)
      const remoteHome = join(remote, 'sele/accounts', remoteCreation.accountId)
      await restarted.getCodexAccountsWithDisplayNames(container)
      await access(join(remoteHome, 'pending'))
      await writeFile(join(remoteHome, 'auth.json'), token('Added Remote Name'))
      await restarted.finalizeCodexAccount(remoteCreation.accountId, container)
      const remoteAdded = await restarted.getCodexAccountsWithDisplayNames(container)
      assert.equal(
        remoteAdded.accounts.find((account) => account.active).displayName,
        'Added Remote Name'
      )
      assert.equal(
        (await restarted.getCodexAccounts()).accounts.find((account) => account.active).id,
        created.accountId
      )

      // Empty legacy markers still represent interrupted sign-ins and are recovered.
      const legacy = await restarted.createCodexAccount(container)
      await writeFile(join(remote, 'sele/accounts', legacy.accountId, 'pending'), '')
      await restarted.getCodexAccounts(container)
      await assert.rejects(access(join(remote, 'sele/accounts', legacy.accountId)))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}
