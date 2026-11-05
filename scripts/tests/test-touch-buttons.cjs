const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')
const { build } = require('esbuild')
let window
let directory
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
;(async () => {
  directory = await fs.mkdtemp(path.resolve('tmp/touch-buttons-'))
  app.setPath('userData', path.join(directory, 'profile'))
  app.commandLine.appendSwitch('disable-gpu')
  await build({
    stdin: {
      contents: `
    import {installTouchEditingActivation} from './src/renderer/src/touchInput'; installTouchEditingActivation({visible:()=>true,restore:()=>window.restores=(window.restores||0)+1}); import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Button} from './src/renderer/src/components/Button';
    window.counts={primary:0,cover:0,native:0,regular:0};
    function Test(){const [moved,setMoved]=useState(false);const [editing,setEditing]=useState(false);return <>
      <button id="cover" style={{position:'absolute',left:30,top:30,width:160,height:50}} onClick={()=>window.counts.cover++}>Covered control</button>
      <Button id="moving" label="Move on touch" style={{position:'absolute',left:30,top:moved?150:30,width:160,height:50}} callback={()=>{window.counts.primary++;setMoved(true)}}/>
      <button id="native" style={{position:'absolute',left:220,top:30,width:150,height:50}} onClick={()=>window.counts.native++}>Native control</button>
      <Button id="regular" label="Regular" style={{position:'absolute',left:30,top:250,width:160,height:50}} callback={()=>window.counts.regular++}/>
      {editing?<input id="editing" autoFocus style={{position:'absolute',left:220,top:350,width:150,height:50}}/>:<Button id="rename" label="Rename" style={{position:'absolute',left:30,top:350,width:160,height:50}} callback={()=>setEditing(true)}/>}
    </>};createRoot(document.getElementById('root')).render(<Test/>);
  `,
      loader: 'tsx',
      resolveDir: process.cwd()
    },
    bundle: true,
    platform: 'browser',
    jsx: 'automatic',
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
    format: 'iife',
    outfile: path.join(directory, 'fixture.js'),
    plugins: [
      {
        name: 'no-css',
        setup(b) {
          b.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'empty' }))
        }
      }
    ]
  })
  await fs.writeFile(
    path.join(directory, 'index.html'),
    '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="./fixture.js"></script>'
  )
  await app.whenReady()
  window = new BrowserWindow({
    width: 440,
    height: 600,
    show: true,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false }
  })
  window.webContents.on('console-message', (details) => console.log('FIXTURE:', details.message))
  await window.loadFile(path.join(directory, 'index.html'))
  const run = (source) => window.webContents.executeJavaScript(source)
  for (let i = 0; i < 100 && !(await run('Boolean(document.getElementById("regular"))')); i++)
    await delay(25)
  window.webContents.debugger.attach('1.3')
  const command = (method, params) => window.webContents.debugger.sendCommand(method, params)
  const point = (selector) =>
    run(
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`
    )
  const touch = async (selector, drag = false) => {
    const p = await point(selector)
    await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] })
    await delay(40)
    if (drag)
      await command('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: p.x + 30, y: p.y }]
      })
    await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await delay(400)
  }
  // Android can report detail=0 for a touch-generated compatibility click.
  // Keep keyboard detail=0 distinct by using the actual pointer type.
  await run(`window.addEventListener('click', event => {
    if (event.pointerType === 'touch') Object.defineProperty(event, 'detail', {value:0})
  }, true)`)
  await touch('#moving')
  assert.deepEqual(
    await run('window.counts'),
    { primary: 1, cover: 0, native: 0, regular: 0 },
    'moving touch target acts once and never activates the newly uncovered control'
  )
  await touch('#native')
  assert.equal(
    await run('window.counts.native'),
    1,
    'a new native control gesture is not swallowed by the guard'
  )
  await touch('#regular')
  assert.equal(
    await run('window.counts.regular'),
    1,
    'touch activation is not repeated by its compatibility click'
  )
  await touch('#regular', true)
  assert.equal(
    await run('window.counts.regular'),
    1,
    'dragging across a button does not activate it'
  )
  const p = await point('#regular')
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...p,
    button: 'left',
    clickCount: 1
  })
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...p,
    button: 'left',
    clickCount: 1
  })
  assert.equal(await run('window.counts.regular'), 2, 'desktop mouse activation still works')
  await run('document.getElementById("regular").focus()')
  await command('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    text: '\r'
  })
  await command('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13
  })
  await delay(100)
  assert.equal(await run('window.counts.regular'), 3, 'desktop keyboard activation still works')
  await touch('#rename')
  assert.equal(await run('document.activeElement?.id'), 'editing', 'compatibility mouse-down cannot blur an input focused by a touch action')
  await run(`(()=>{const f=document.createElement('form');f.id='form';f.style.cssText='position:absolute;left:30px;top:430px';f.innerHTML='<button id="submit" type="submit">Submit</button>';window.submits=0;f.onsubmit=e=>{e.preventDefault();window.submits++};document.body.append(f);window.restores=0})()`)
  await touch('#submit', true)
  assert.equal(await run('window.submits'), 0, 'dragging with an editor focused does not submit')
  await run(`(()=>{const e=document.getElementById('editing');e.value='draft';e.setSelectionRange(3,3);document.addEventListener('pointerdown',ev=>{if(ev.target.id==='submit')e.setSelectionRange(0,0)},true)})()`)
  await touch('#submit')
  assert.equal(await run('window.submits'), 1, 'native form submits exactly once while editing')
  assert.equal(await run('document.activeElement?.id'), 'editing', 'native form tap preserves editing focus')
  assert.equal(await run('document.getElementById("editing").selectionStart'), 3, 'transient Android caret reset does not replace the editing selection')
  assert.equal(await run('window.restores'), 1, 'retained keyboard is restored only after a completed editing action')
  console.log(
    'TOUCH BUTTONS PASSED: moving target, duplicate suppression, subsequent native gesture, drag cancellation, desktop mouse and keyboard'
  )
})()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    window?.destroy()
    if (directory)
      await fs
        .rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
        .catch((error) => console.warn('Fixture cleanup:', error.message))
    app.exit(process.exitCode || 0)
  })
