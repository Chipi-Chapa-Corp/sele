const assert = require('node:assert/strict')
const path = require('node:path')

// Exercise visible controls with native touch events; DOM-only presence is insufficient.
module.exports = async (ui, output) => {
  const { run, waitFor, tap, adb, delay, screenshot } = ui
  await require('./android-touch-layout.cjs')(ui, output)
  await ui.navigate('Open settings')
  await waitFor('Boolean(document.querySelector(".settings-dialog"))')
  assert.equal(
    await run('document.querySelector(".settings-dialog__nav").getAttribute("aria-orientation")'),
    'horizontal'
  )
  const tabs = await run(
    '[...document.querySelectorAll(".settings-dialog__nav [role=tab]")].map(tab=>tab.id)'
  )
  for (const id of tabs) {
    await tap(`#${id}`)
    await waitFor(
      `document.getElementById(${JSON.stringify(id)})?.getAttribute('aria-selected')==='true'`
    )
    await delay(150)
    assert.equal(
      await run(`(() => {
      const panel=document.querySelector('.settings-dialog__panel'); if(!panel) return false;
      const bounds=panel.getBoundingClientRect(); return bounds.width>0 && bounds.left>=-1 && bounds.right<=innerWidth+1;
    })()`),
      true,
      `${id} fits the phone viewport`
    )
    await screenshot(path.join(output, `${id}.png`))
  }
  adb(['shell', 'input', 'keyevent', '4'])
  await waitFor('!document.querySelector(".settings-dialog")')
  await ui.navigate('Workspace')
  await waitFor(`document.querySelector('main.chat')?.dataset.mobilePane==='workspace'`)
  for (const name of ['Recents', 'Git', 'Files', 'Terminal']) {
    const selector = `.changes-sidebar [aria-label="Sidebar view"] button[aria-label="${name}"]`
    if (!(await run(`Boolean(document.querySelector(${JSON.stringify(selector)}))`))) continue
    await tap(selector)
    await delay(200)
    assert.equal(
      await run(
        `(() => { const box=document.querySelector('.changes-sidebar').getBoundingClientRect();return box.width>0&&box.right<=innerWidth+1 })()`
      ),
      true,
      `${name} is accessible on the phone`
    )
    await screenshot(path.join(output, `workspace-${name.toLowerCase()}.png`))
  }
  await require('./android-mobile-refinements.cjs')(ui, output)
  await require('./android-touch-followup.cjs')(ui, output)
  console.log('ANDROID UI PASSED: settings, workspace, new chat, tools, selectors, preset sections and native Back')
}
