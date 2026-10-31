import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { getVideoMimeType } from '../shared/video.ts'

// Exercise the IPC media loaders without booting Electron or opening the user's profile.
const source = ts.createSourceFile(
  'registerAppIpc.ts',
  readFileSync(new URL('./registerAppIpc.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const names = new Set([
  'imageMimeTypes',
  'pngSignature',
  'maxLocalImageBytes',
  'maxLocalVideoBytes',
  'remoteFileMetadataBufferBytes',
  'getImageMimeType',
  'getLocalImageMimeType',
  'getImageFile',
  'resolveLocalMediaPath',
  'getLocalMedia',
  'getTargetLocalMedia',
  'getRemoteRepositoryFilePath'
])
const declarations = source.statements
  .filter(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((declaration) =>
        names.has(declaration.name.getText(source))
      )
  )
  .map((statement) => statement.getText(source))
  .join('\n')
const loaderSource = ts.transpileModule(`${declarations}\nexports.load = getLocalMedia`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText
const exec = promisify(execFile)

const harness = (throughTarget) => {
  let probes = 0
  const context = {
    exports: {},
    Buffer,
    process,
    extname,
    isAbsolute,
    relative,
    resolve,
    readFile,
    stat,
    getVideoMimeType,
    gitCommandContext: { getStore: () => ({ container: { kind: 'host' } }) },
    shouldReadFilesThroughTarget: async () => throughTarget,
    runGit: async (cwd, args, required = false) => {
      probes++
      try {
        return (await exec('git', args, { cwd })).stdout.trimEnd()
      } catch (error) {
        if (required) throw error
        return null
      }
    },
    // Execute the remote read script against a disposable local fixture.
    runTargetFileCommand: async (_container, cwd, args, options) =>
      (await exec('sh', args, { cwd, encoding: 'buffer', ...options })).stdout
  }
  vm.runInNewContext(loaderSource, context)
  return { load: context.exports.load, probes: () => probes }
}

for (const throughTarget of [false, true]) {
  test(`media preview works in ordinary folders (${throughTarget ? 'target' : 'local'})`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'sele-media-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    await mkdir(join(root, 'output'))
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5nQAAAAASUVORK5CYII=',
      'base64'
    )
    const video = await readFile(
      new URL('../../scripts/tests/fixtures/preview-video.webm', import.meta.url)
    )
    await writeFile(join(root, 'output', 'Preview.png'), png)
    await writeFile(join(root, 'output', 'Preview.webm'), video)
    const app = harness(throughTarget)
    for (const [kind, name, bytes, mimeType] of [
      ['image', 'Preview.png', png, 'image/png'],
      ['video', 'Preview.webm', video, 'video/webm']
    ]) {
      const result = await app.load(root, `output/${name}`, undefined, kind)
      assert.equal(result.mimeType, mimeType)
      assert.deepEqual(Buffer.from(result.data), bytes)
    }
    const probes = app.probes()
    await app.load(root, 'output/Preview.png', 'cwd')
    await app.load(null, join(root, 'output', 'Preview.png'))
    assert.equal(app.probes(), probes, 'cwd-relative and absolute files skip Git')
    await assert.rejects(app.load(root, 'output/missing.png'), /ENOENT|regular media file/)

    await exec('git', ['init', '-q', root])
    const nested = join(root, 'output')
    const result = await app.load(nested, 'output/Preview.png')
    assert.deepEqual(
      Buffer.from(result.data),
      png,
      'repository-relative paths still use the Git root'
    )
    const cwdResult = await app.load(nested, 'Preview.png', 'cwd')
    assert.deepEqual(Buffer.from(cwdResult.data), png)
  })
}
