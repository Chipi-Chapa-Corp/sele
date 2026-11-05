const assert = require('node:assert/strict')
const path = require('node:path')
module.exports = async (ui, { dirs, artifacts }) => {
  const { run, waitFor, tap, adb, delay, screenshot } = ui
  console.log('MOBILE UI: host folder picker and Android save dialog')
  await run(
    `window.__hostPicked='pending'; void appApi.selectFolder({defaultPath:${JSON.stringify(dirs.work)}}).then(value=>window.__hostPicked=value);true`
  )
  await waitFor('Boolean(document.querySelector(".host-path-dialog[open]"))')
  await tap('.host-path-dialog button[aria-label="Parent folder"]')
  await waitFor(
    `document.querySelector('.host-path-dialog input[aria-label="Folder path"]')?.value===${JSON.stringify(path.dirname(dirs.work))}`
  )
  await run(
    `document.querySelector('.host-path-dialog__entries button span').parentElement.scrollIntoView()`
  )
  const folder = await run(
    `(()=>{const button=[...document.querySelectorAll('.host-path-dialog__entries button')].find(button=>button.textContent==='workspace');button.dataset.testFolder='true';return true})()`
  )
  assert.equal(folder, true)
  await tap('.host-path-dialog button[data-test-folder="true"]')
  await waitFor(
    `document.querySelector('.host-path-dialog input[aria-label="Folder path"]')?.value===${JSON.stringify(dirs.work)}`
  )
  await screenshot(path.join(artifacts, 'host-folder-picker.png'))
  await tap('.host-path-dialog footer button:last-child')
  await waitFor(`window.__hostPicked===${JSON.stringify(dirs.work)}`)
  const name = `sele-diagnostics-${new Date().toISOString().slice(0, 10)}.log`
  adb(['shell', 'rm', '-f', `/sdcard/Download/${name}`, `/sdcard/Download/${name}.txt`])
  await run(
    'window.__savedLog="pending";void appApi.exportDiagnosticLog().then(value=>window.__savedLog=value??"canceled").catch(error=>window.__savedLog=String(error));true'
  )
  const deadline = Date.now() + 20000
  let button
  while (Date.now() < deadline) {
    adb(['shell', 'uiautomator', 'dump', '/sdcard/sele-ui.xml'])
    const xml = adb(['shell', 'cat', '/sdcard/sele-ui.xml'])
    const nodes = xml.match(/<node\b[^>]*>/g) ?? []
    button = nodes.find((node) => /text="SAVE"/i.test(node) && /clickable="true"/.test(node))
    if (button) break
    await delay(250)
  }
  assert.ok(button, 'Android document picker exposes Save')
  await screenshot(path.join(artifacts, 'android-save-dialog.png'))
  const bounds = button
    .match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
    .slice(1)
    .map(Number)
  adb([
    'shell',
    'input',
    'tap',
    String(Math.round((bounds[0] + bounds[2]) / 2)),
    String(Math.round((bounds[1] + bounds[3]) / 2))
  ])
  await waitFor('window.__savedLog!=="pending"')
  assert.match(await run('window.__savedLog'), /^content:\/\//)
  const savedName = adb(['shell', 'ls', '/sdcard/Download'])
    .split('\n')
    .find((file) => file === name || file === name + '.txt')
  assert.ok(savedName, 'Android saved the requested diagnostic document')
  assert.ok(
    adb(['shell', 'cat', `/sdcard/Download/${savedName}`]).length > 0,
    'native saved diagnostics contain host log data'
  )
  console.log(
    'MOBILE FILES PASSED: browse and choose host folder, export host log through native Android Save'
  )
}
