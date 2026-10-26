// Run through isolated-gui. Uses fixture data and a temporary Electron profile.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-row-test-'))
    try {
      await require('esbuild').build({
        stdin: {
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx',
          contents: `
            import React, {Activity} from 'react'
            import {createRoot} from 'react-dom/client'
            import {flushSync} from 'react-dom'
            import {renderRootChatTurn} from './src/renderer/src/workspace/chatTurnRendering'
            import {RollingValue} from './src/renderer/src/components/RollingValue'
            window.rowRenders=[]
            const root=createRoot(document.getElementById('root'))
            const items=[
              {type:'message',id:'user',role:'user',content:'Prompt',editTargetId:'user',createdAt:1700000000000},
              {type:'working',id:'work',status:'worked',items:[]},
              {type:'message',id:'answer',role:'assistant',content:'Answer',model:'old-model',createdAt:1700000000000}
            ]
            const turn={id:'user',items}
            const noop=()=>{}
            const inputs={
              itemIndexesById:new Map(items.map((item,i)=>[item.id,i])),visibleChatItems:items,
              followingWorkingStepsById:new Map(),workingStepIdsWithNextWorkingStep:new Set(),
              steeredWorkingStepDisclosureTargets:new Map(),subagentCompletions:{before:new Map(),after:new Map()},
              renderSubagentCompletion:noop,chatCommitMarkersByBeforeItemId:new Map(),
              chatCommitMarkersByAfterItemId:new Map(),trailingChatCommitMarkers:[],renderChatCommitMarker:noop,
              firstPendingChatItemId:null,scheduleChatAutoScroll:noop,continuedStoppedWorkingStepIds:new Set(),
              pinnedChatMessageIds:new Set(),stoppedTurnRetryMessages:new Map(),canRetryStoppedTurns:false,
              canEditOwnMessages:false,rateLimitResetDisabled:true,stoppedTurnActionDisabled:true,onEditMessage:noop,selectedModelId:'new-model',
              modelLabelsById:new Map([['old-model','Old label']]),resolvedModelIdsById:new Map()
            }
            window.renderRows=(changes={})=>{
              Object.assign(inputs,changes)
              flushSync(()=>root.render(<>
                {renderRootChatTurn(inputs,0,turn)}
                <Activity mode={inputs.fixtureHideCounter?'hidden':'visible'}>
                  <RollingValue value={inputs.fixtureRollingValue??'10'}/>
                </Activity>
              </>))
            }
          `
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        loader: { '.ttf': 'dataurl' },
        outfile: path.join(directory, 'fixture.js'),
        plugins: [
          {
            name: 'row-probe',
            setup(build) {
              build.onLoad({ filter: /[/\\]ChatDetailItem\.tsx$/ }, async ({ path: filename }) => {
                const source = await fs.readFile(filename, 'utf8')
                const needle = 'const messageRef = useRef<HTMLDivElement>(null)'
                assert.equal(source.split(needle).length, 2)
                return {
                  contents: source.replace(needle, 'window.rowRenders.push(item.id);' + needle),
                  loader: 'tsx'
                }
              })
              build.onResolve({ filter: /\?worker$/ }, (args) => ({
                path: args.path,
                namespace: 'worker'
              }))
              build.onLoad({ filter: /.*/, namespace: 'worker' }, () => ({
                contents: 'export default class {}'
              }))
            }
          }
        ]
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<div id="root"></div><script src="fixture.js"></script>'
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        {
          env,
          encoding: 'utf8',
          timeout: 30000
        }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0) throw new Error(result.stderr || String(result.error))
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow } = require('electron')
  app.setPath('userData', path.join(process.argv[2], 'profile'))
  app.whenReady().then(async () => {
    try {
      const win = new BrowserWindow({ show: false })
      await win.loadFile(path.join(process.argv[2], 'index.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      await run('renderRows();window.rowRenders=[]')
      await run(
        `renderRows({modelLabelsById:new Map([['old-model','Old label']]),resolvedModelIdsById:new Map()})`
      )
      assert.deepEqual(
        await run('window.rowRenders'),
        [],
        'identical IPC model catalogs do not rerender history'
      )
      await run(`renderRows({modelLabelsById:new Map([['old-model','Updated label']])})`)
      assert.deepEqual(
        await run('window.rowRenders'),
        ['answer'],
        'a changed message label still renders'
      )
      assert.ok((await run('document.body.textContent')).includes('Updated label'))
      await run('window.rowRenders=[];renderRows({selectedModelId:"old-model"})')
      assert.deepEqual(
        await run('window.rowRenders'),
        ['answer'],
        'the selected model can remove a label'
      )
      assert.ok(!(await run('document.body.textContent')).includes('Updated label'))
      await run(
        'window.rowRenders=[];renderRows({canEditOwnMessages:true,canRetryStoppedTurns:true,rateLimitResetDisabled:false,stoppedTurnActionDisabled:false})'
      )
      assert.deepEqual(
        await run('window.rowRenders'),
        ['user'],
        'permissions change only rows with corresponding actions'
      )
      assert.equal(
        await run(`Boolean(document.querySelector('[aria-label="Edit message"]'))`),
        true
      )
      await run(
        `window.tens=document.querySelector('[data-place="number:0:integer:1"]');renderRows({fixtureRollingValue:'11'})`
      )
      assert.equal(
        await run(`window.tens===document.querySelector('[data-place="number:0:integer:1"]')`),
        true
      )
      assert.equal(
        await run('window.tens.getAnimations({subtree:true}).length'),
        0,
        'unchanged digits stay still'
      )
      assert.equal(
        await run(
          `document.querySelector('[data-place="number:0:integer:0"]').getAnimations({subtree:true}).length`
        ),
        2,
        'changed digits roll in and out on the browser timeline'
      )
      await run('renderRows({fixtureHideCounter:true});renderRows({fixtureHideCounter:false})')
      assert.equal(
        await run(`document.querySelector('.rolling-value').getAnimations({subtree:true}).length`),
        0,
        'cached reveals cancel old animation work without replaying it'
      )
      await win.webContents.debugger.attach('1.3')
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
      })
      await run('new Promise(resolve=>setTimeout(resolve,30))')
      await run(`renderRows({fixtureRollingValue:'12'})`)
      assert.equal(
        await run(`document.querySelector('.rolling-value').textContent`),
        '12',
        'reduced motion shows the new value immediately'
      )
      console.log('Chat row invalidation checks passed.')
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
  })
}
