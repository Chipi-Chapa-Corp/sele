import assert from 'node:assert/strict'
import test from 'node:test'
import { uploadBrowserFiles } from './BrowserFileUploads.ts'

function fixture({ multiple = false, disabled = false } = {}) {
  const calls = []
  let listener
  const signal = new AbortController()
  const cdp = async (method, params) => {
    calls.push({ method, params })
    if (method === 'DOM.describeNode')
      return {
        node: {
          nodeName: 'INPUT',
          attributes: [
            'type',
            'file',
            ...(multiple ? ['multiple', ''] : []),
            ...(disabled ? ['disabled', ''] : [])
          ]
        }
      }
    return {}
  }
  const chooser = {
    signal: signal.signal,
    subscribe(fn) {
      listener = fn
      return () => {
        listener = null
      }
    },
    async open() {
      assert.equal(calls.at(-1).method, 'Page.setInterceptFileChooserDialog')
      assert.equal(calls.at(-1).params.enabled, true)
      listener({ backendNodeId: 42, mode: 'selectSingle' })
    }
  }
  return { calls, cdp, chooser, signal, hasListener: () => !!listener }
}

test('button-triggered detached file inputs upload without a native desktop dialog', async () => {
  const f = fixture()
  await uploadBrowserFiles(f.cdp, undefined, ['/tmp/logo.png'], f.chooser)
  assert.deepEqual(f.calls.find((x) => x.method === 'DOM.setFileInputFiles').params, {
    backendNodeId: 42,
    files: ['/tmp/logo.png']
  })
  assert.deepEqual(f.calls.at(-1), {
    method: 'Page.setInterceptFileChooserDialog',
    params: { enabled: false }
  })
  assert.equal(f.hasListener(), false)
})

test('file restrictions and cancellation never upload through a stale chooser', async () => {
  for (const options of [{ disabled: true }, {}]) {
    const f = fixture(options)
    await assert.rejects(
      uploadBrowserFiles(f.cdp, undefined, ['/tmp/a', '/tmp/b'], f.chooser),
      /disabled|multiple/
    )
    assert.ok(!f.calls.some((x) => x.method === 'DOM.setFileInputFiles'))
    assert.equal(f.calls.at(-1).params.enabled, false)
  }
  const f = fixture()
  f.chooser.open = async () => f.signal.abort()
  await assert.rejects(
    uploadBrowserFiles(f.cdp, undefined, ['/tmp/logo.png'], f.chooser),
    /closed|cancel/i
  )
  assert.equal(f.hasListener(), false)
  assert.ok(!f.calls.some((x) => x.method === 'DOM.setFileInputFiles'))
})

test('ordinary file inputs retain direct upload without intercepting a chooser', async () => {
  const f = fixture({ multiple: true })
  await uploadBrowserFiles(f.cdp, { nodeId: 7 }, ['/tmp/a', '/tmp/b'])
  assert.equal(f.calls.filter((x) => x.method === 'Page.setInterceptFileChooserDialog').length, 0)
  assert.deepEqual(f.calls.at(-1).params, { nodeId: 7, files: ['/tmp/a', '/tmp/b'] })
})
