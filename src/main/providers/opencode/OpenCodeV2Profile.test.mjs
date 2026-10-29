import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const code = ts.transpile(
  readFileSync(new URL('./OpenCodeV2Profile.ts', import.meta.url), 'utf8'),
  {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
)
async function fixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'sele-opencode-profile-'))
  const managed = path.join(root, 'sele', 'opencode-v2')
  const exports = {}
  const env = { XDG_DATA_HOME: root }
  vm.runInNewContext(code, {
    exports,
    process: { env },
    Date,
    require(name) {
      if (name === 'node:fs/promises') return fs
      if (name === 'node:path') return path
      if (name === 'node:crypto') return { createHash }
      if (name === 'node:os') return { homedir: () => root }
      if (name.includes('containerTarget')) return { getContainerTargetKey: () => 'host' }
      if (name.includes('OpenCodeInstallations'))
        return { managedOpenCodeV2Directory: () => managed }
      throw Error('Existing v2 profiles must not invoke the legacy database importer')
    }
  })
  return { ...exports, root, managed, env }
}

test('switching to v2-only preserves an already migrated profile without reseeding its history', async () => {
  const f = await fixture()
  try {
    const profile = path.join(
      f.managed,
      'profiles',
      `${createHash('sha256').update('host').digest('hex').slice(0, 16)}.db`
    )
    await fs.mkdir(path.dirname(profile), { recursive: true })
    await fs.writeFile(profile, 'existing v2 conversations and credentials')
    await fs.mkdir(path.join(f.root, 'opencode'))
    await fs.writeFile(path.join(f.root, 'opencode', 'opencode.db'), 'different legacy history')
    assert.equal(await f.ensureOpenCodeV2Profile(), profile)
    assert.equal(await fs.readFile(profile, 'utf8'), 'existing v2 conversations and credentials')
    await assert.rejects(fs.access(path.join(f.managed, 'backups')), { code: 'ENOENT' })
  } finally {
    await fs.rm(f.root, { recursive: true, force: true })
  }
})

test('an explicit OpenCode database keeps its identity and does not create another profile', async () => {
  const f = await fixture()
  try {
    f.env.OPENCODE_DB = path.join(f.root, 'chosen.db')
    assert.equal(await f.ensureOpenCodeV2Profile(), f.env.OPENCODE_DB)
    await assert.rejects(fs.access(f.managed), { code: 'ENOENT' })
  } finally {
    await fs.rm(f.root, { recursive: true, force: true })
  }
})
