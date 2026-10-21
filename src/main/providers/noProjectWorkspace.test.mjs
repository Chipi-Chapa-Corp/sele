import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import vm from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'
import { isNoProjectCwd } from '../../shared/noProject.ts'

const bundled = await build({
  entryPoints: [new URL('./noProjectWorkspace.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  plugins: [
    {
      name: 'fixture-runtime',
      setup(build) {
        build.onResolve({ filter: /^\.\.\/(hostProcess|currentContainer)$/ }, ({ path }) => ({
          path,
          namespace: 'fixture'
        }))
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `
        export const isRunningInFlatpak = () => harness.flatpak;
        export const getCurrentContainerHostBridge = async () => harness.bridge;
        export const getHostCommand = async (file, args, options) => {
          harness.commands.push({file, args, container: options.container});
          return {file, args, cwd: harness.root, env: {...process.env, HOME: harness.root}};
        };
      `
        }))
      }
    }
  ]
})

const fixture = async (run) => {
  const root = await mkdtemp(join(tmpdir(), 'sele-general-chat-'))
  const harness = { root, commands: [], flatpak: false, bridge: null }
  const module = { exports: {} }
  vm.runInNewContext(bundled.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url),
    process,
    harness
  })
  try {
    await run(module.exports, harness)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('general chats get separate persistent empty workspaces and retain tool settings', () =>
  fixture(async ({ prepareChatWorkspace }, h) => {
    const options = {
      noProject: true,
      cwd: '/previous-project',
      additionalDirectories: ['/previous-reference'],
      model: 'fixture',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      skills: [{ name: 'desktop', path: '/user/skills/desktop' }]
    }
    const first = await prepareChatWorkspace(h.root, options)
    const second = await prepareChatWorkspace(h.root, options)
    assert.notEqual(first.cwd, second.cwd)
    assert.equal(isNoProjectCwd(first.cwd), true)
    assert.equal(dirname(dirname(first.cwd)), h.root)
    assert.deepEqual(await readdir(first.cwd), [])
    assert.equal((await stat(first.cwd)).isDirectory(), true)
    assert.equal(first.additionalDirectories, undefined)
    assert.equal(first.skills, options.skills)
    assert.equal(first.sandboxMode, options.sandboxMode)
    assert.equal(first.approvalPolicy, options.approvalPolicy)
    assert.equal(options.cwd, '/previous-project')
    assert.equal(h.commands.length, 0)
    assert.equal(await prepareChatWorkspace(h.root, undefined), undefined)
    const project = { ...options, noProject: false }
    assert.equal(await prepareChatWorkspace(h.root, project), project)
  }))

test('container, SSH, Flatpak and bridged chats create folders in the provider runtime', () =>
  fixture(async ({ createNoProjectWorkspace }, h) => {
    for (const container of [
      { kind: 'container', tool: 'podman', name: 'fixture' },
      { kind: 'container', tool: 'ssh', name: 'fixture' },
      null,
      null
    ]) {
      if (!container && !h.flatpak) h.flatpak = true
      else if (!container) {
        h.flatpak = false
        h.bridge = {}
      }
      const cwd = await createNoProjectWorkspace('/not-the-provider-machine', container)
      assert.equal(isNoProjectCwd(cwd), true)
      assert.ok(cwd.startsWith(join(h.root, '.local', 'share', 'sele')))
      assert.equal(h.commands.at(-1).container, container)
      assert.deepEqual(await readdir(cwd), [])
    }
    assert.equal(h.commands.length, 4)
  }))

test('reserved workspace detection accepts native paths and excludes regular projects', () => {
  const id = '00000000-0000-4000-8000-000000000000'
  for (const cwd of [`/data/sele-no-project/${id}`, `C:\\Data\\sele-no-project\\${id}`])
    assert.equal(isNoProjectCwd(cwd), true)
  for (const cwd of [null, undefined, '/tmp', '/projects/sele', '/data/sele-no-project/project'])
    assert.equal(isNoProjectCwd(cwd), false)
})

test('No Project metadata never inherits a repository from parent directories', async () => {
  const bundle = await build({
    entryPoints: [new URL('./cwdMetadata.ts', import.meta.url).pathname],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    plugins: [
      {
        name: 'reject-project-probes',
        setup(build) {
          build.onResolve({ filter: /^\.\.\/(database\/cwd|hostProcess)$/ }, ({ path }) => ({
            path,
            namespace: 'fixture'
          }))
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: `
          const unexpected = () => { throw new Error('General chats must not probe a project'); };
          export const getStoredCwdMetadata = unexpected;
          export const setStoredCwdMetadata = unexpected;
          export const getHostCommand = unexpected;
        `
          }))
        }
      }
    ]
  })
  const module = { exports: {} }
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url)
  })
  const metadata = await module.exports.getCwdMetadata(
    '/last-project/profile/sele-no-project/00000000-0000-4000-8000-000000000000'
  )
  assert.equal(metadata.projectCwd, null)
  assert.equal(metadata.branchName, null)
  assert.equal(metadata.kind, 'directory')
})
