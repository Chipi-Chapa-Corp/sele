// A chat's read-only diff must not initialize the desktop editor runtime.
const assert = require('node:assert/strict')
const path = require('node:path')

;(async () => {
  const result = await require('esbuild').build({
    stdin: {
      contents: "export { UnifiedDiff } from './src/renderer/src/components/UnifiedDiff'",
      resolveDir: path.resolve(__dirname, '../..'),
      loader: 'tsx'
    },
    bundle: true,
    write: false,
    metafile: true,
    platform: 'browser',
    format: 'esm',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.css': 'empty', '.woff2': 'dataurl', '.ttf': 'dataurl' }
  })
  const inputs = Object.keys(result.metafile.inputs)
  assert.equal(
    inputs.some((file) => /monaco-editor|monacoEnvironment|EditableUnifiedDiff/.test(file)),
    false,
    'read-only viewing must not import Monaco or the editable diff'
  )
  assert.ok(
    inputs.some((file) => file.endsWith('/diffReview.tsx')),
    'keep shared review controls'
  )
  console.log(
    `Read-only diff dependency check passed (${Math.round(result.outputFiles[0].contents.length / 1024)} KiB; no Monaco).`
  )
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
