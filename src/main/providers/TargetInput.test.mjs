import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const require = createRequire(import.meta.url)

test('target startup cannot consume text or binary import input before the destination is ready', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-import-stdin-'))
  try {
    const launcher = join(directory, 'launcher.cjs')
    // Like a container entrypoint, this launcher consumes any input that arrives during setup.
    await writeFile(
      launcher,
      `const {spawn}=require('node:child_process');let child,ended=false;process.stdin.on('data',data=>{if(child)child.stdin.write(data)});process.stdin.on('end',()=>{ended=true;child?.stdin.end()});setTimeout(()=>{child=spawn(process.argv[2],process.argv.slice(3));child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);child.on('exit',code=>process.exit(code??1));if(ended)child.stdin.end()},50)`
    )
    const bundled = await build({
      entryPoints: [new URL('./TargetInput.ts', import.meta.url).pathname],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      write: false,
      plugins: [
        {
          name: 'isolate-launcher',
          setup(build) {
            build.onResolve({ filter: /hostProcess$/ }, () => ({
              path: 'hostProcess',
              namespace: 'fixture'
            }))
            build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              contents: `export const getHostCommand=async(file,args)=>({file:process.execPath,args:[${JSON.stringify(launcher)},file,...args]})`
            }))
          }
        }
      ]
    })
    const module = { exports: {} }
    vm.runInNewContext(bundled.outputFiles[0].text, {
      module,
      exports: module.exports,
      require,
      process
    })
    for (const payload of [
      '你好 🦊\n'.repeat(100000),
      Buffer.from(Array.from({ length: 400000 }, (_, i) => i % 256))
    ]) {
      const file = join(directory, 'payload')
      await module.exports.runTargetInput(null, 'cat > "$1"; printf done', [file], payload)
      assert.deepEqual(await readFile(file), Buffer.from(payload))
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
