const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(
      path.join(require('node:os').tmpdir(), 'sele-project-delete-')
    )
    const project = path.resolve(__dirname, '../..')
    try {
      await require('esbuild').build({
        stdin: {
          resolveDir: project,
          contents: `
            import assert from 'node:assert/strict'
            import {getDatabase,disposeDatabase} from './src/main/database/sqlite'
            import {addProject,deleteProject,getProjects,getDeletedProjectCwds,setProjectOrder} from './src/main/database/projects'
            import {setChatPinned,getChatMetadata} from './src/main/database/chat'
            async function run() {
              await addProject({cwd:'/saved',name:'Saved project',additionalCwds:['/extra']})
              await addProject({cwd:'/other',name:'Other'})
              await setChatPinned('retained-chat',true)
              await deleteProject('/saved')
              await deleteProject('/saved')
              await deleteProject('/history')
              assert.deepEqual((await getProjects()).map(p=>p.cwd),['/other'])
              assert.deepEqual((await getDeletedProjectCwds()).sort(),['/history','/saved'])
              assert.equal((await getChatMetadata('retained-chat')).pinned,true)
              await disposeDatabase()
              assert.deepEqual((await getDeletedProjectCwds()).sort(),['/history','/saved'])
              await setProjectOrder(['/history','/saved','/other'])
              assert.deepEqual((await getProjects()).map(p=>p.cwd),['/other'])
              await addProject({cwd:'/saved',name:'Restored project'})
              assert.deepEqual(await getDeletedProjectCwds(),['/history'])
              assert.equal((await getProjects()).find(p=>p.cwd==='/saved').name,'Restored project')
              await assert.rejects(deleteProject('  '),/Invalid project cwd/)
              await disposeDatabase()
              console.log('Project deletion store checks passed: persistence, history exclusions, retained chats, reorder and restore.')
            }
            run().catch(error=>{console.error(error);process.exitCode=1})
          `
        },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: path.join(directory, 'store.cjs'),
        plugins: [
          require('./helpers/node-workers.cjs')(directory),
          {
            name: 'isolated-store',
            setup(build) {
              build.onResolve({ filter: /^better-sqlite3$/ }, () => ({
                path: require.resolve('better-sqlite3'),
                external: true
              }))
              build.onResolve({ filter: /^electron$/ }, () => ({
                path: 'electron',
                namespace: 'stub'
              }))
              build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
                contents:
                  'export const app = { getPath() { throw new Error("Real profile access is forbidden") } }'
              }))
            }
          }
        ]
      })
      const store = spawnSync(require('electron'), [path.join(directory, 'store.cjs')], {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          SELE_DATABASE_PATH: path.join(directory, 'test.sqlite')
        },
        encoding: 'utf8',
        timeout: 20000
      })
      process.stdout.write(store.stdout || '')
      assert.equal(store.status, 0, store.stderr || String(store.error))

      const controller = await fs.readFile(
        path.join(project, 'src/renderer/src/useWorkspaceController.tsx'),
        'utf8'
      )
      const selection = controller.slice(
        controller.indexOf('  const handleDeleteProject ='),
        controller.indexOf('  const handleDeleteSshEnvironment =')
      )
      assert.ok(selection.includes('const projectOptions ='))
      await require('esbuild').build({
        stdin: {
          resolveDir: project,
          loader: 'tsx',
          contents: `
            import React,{useState,useRef,useCallback,useMemo} from 'react'
            import {createRoot} from 'react-dom/client'
            import {FolderKanban,MessageSquare,Trash2} from 'lucide-react'
            import {Dropdown} from './src/renderer/src/components/Dropdown'
            import {getProjectDisplayName,renderProjectGlyph} from './src/renderer/src/projectPresentation'
            import {getFolderName,getFolderDescription,getChatCwdGroupKey,getErrorMessage} from './src/renderer/src/workspace/chatControllerUtils'
            import {isNoProjectCwd} from './src/shared/noProject'
            import {newSessionNoProjectValue,newSessionProjectPlaceholderValue} from './src/renderer/src/workspace/controllerTypes'
            import './src/renderer/src/assets/main.css'
            window.calls=[];window.confirmations=[];window.approve=false;window.fail=false
            window.confirm=message=>{window.confirmations.push(message);return window.approve}
            const appApi={deleteProject:async cwd=>{window.calls.push(cwd);if(window.fail)throw Error('Fixture failure')}}
            function Fixture(){
              const [projects,setProjects]=useState([{cwd:'/saved',name:'Saved project',icon:null},{cwd:'/other',name:'Other',icon:null}])
              const [deletedProjectCwds,setDeletedProjectCwds]=useState(new Set(['/hidden']))
              const [deletingProject,setDeletingProject]=useState(false)
              const deletingProjectRef=useRef(false)
              const [newSessionProjectSelection,setNewSessionProjectSelection]=useState('/saved')
              const newSessionNoProject=newSessionProjectSelection===newSessionNoProjectValue
              const newSessionCwd=newSessionNoProject?null:newSessionProjectSelection
              const [sendError,setSendError]=useState(null)
              const chatProjectCreatedAtKey=JSON.stringify([['/saved',3],['/history',2],['/hidden',1]])
              const projectIconsByGroup={}
              ${selection}
              window.fixture={values:projectOptions.map(o=>o.value),current:newSessionProjectSelection,sendError}
              window.reorder=()=>setProjects(p=>[...p,{cwd:'/saved',name:'Saved again',icon:null}])
              window.restore=()=>{window.reorder();setDeletedProjectCwds(p=>new Set([...p].filter(cwd=>cwd!=='/saved')))}
              return <main style={{padding:32,width:480}}><Dropdown aria-label="Project" value={newSessionProjectValue}
                options={projectOptions} onChange={setNewSessionProjectSelection} searchable/>
                {sendError&&<p role="alert">{sendError}</p>}</main>
            }
            createRoot(document.getElementById('root')).render(<Fixture/>);
          `
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        loader: { '.ttf': 'dataurl' },
        outfile: path.join(directory, 'fixture.js')
      })
      await fs.writeFile(
        path.join(directory, 'fixture.html'),
        '<!doctype html><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>'
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const ui = spawnSync(require('electron'), [__filename, directory, '--no-sandbox'], {
        env,
        encoding: 'utf8',
        timeout: 30000
      })
      process.stdout.write(ui.stdout || '')
      assert.equal(ui.status, 0, ui.stderr || String(ui.error))
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
    const window = new BrowserWindow({
      show: false,
      width: 700,
      height: 500,
      webPreferences: { offscreen: true }
    })
    let exitCode = 0
    const run = (source) => window.webContents.executeJavaScript(source)
    const waitFor = async (source) => {
      const deadline = Date.now() + 5000
      while (!(await run(source))) {
        assert.ok(Date.now() < deadline, `Timed out: ${source}`)
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    const open = async () => {
      await run('document.querySelector("button[aria-label=Project]").click()')
      await waitFor(
        '!!document.querySelector("button[aria-label=\\"Remove project Saved project\\"]")'
      )
    }
    const assertOpen = async () => {
      assert.equal(
        await run('document.querySelector("button[aria-label=Project]").getAttribute("aria-expanded")'),
        'true'
      )
      assert.equal(await run('!!document.querySelector("[role=listbox]")'), true)
    }
    try {
      await window.loadFile(path.join(process.argv[2], 'fixture.html'))
      await waitFor('!!window.fixture')
      assert.equal(await run('window.fixture.values.includes("/hidden")'), false)
      await open()
      assert.equal(
        await run(
          '!!document.querySelector("button[aria-label=\\"Remove project Saved project\\"] svg.lucide-trash-2")'
        ),
        true
      )
      await run(
        'document.querySelector("button[aria-label=\\"Remove project Saved project\\"]").click()'
      )
      assert.deepEqual(await run('window.calls'), [])
      assert.equal(await run('window.fixture.current'), '/saved')
      assert.match(
        await run('window.confirmations[0]'),
        /Saved project.*files and chats will be kept/
      )
      await assertOpen()
      await run(
        'window.approve=true;window.fail=true;document.querySelector("button[aria-label=\\"Remove project Saved project\\"]").click()'
      )
      await waitFor('window.fixture.sendError === "Fixture failure"')
      assert.equal(await run('window.fixture.values.includes("/saved")'), true)
      assert.equal(await run('window.fixture.current'), '/saved')
      await assertOpen()
      await run(`
        const input = document.querySelector('input[type=search]')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '/')
        input.dispatchEvent(new Event('input', {bubbles: true}))
      `)
      await waitFor('document.querySelectorAll("[role=option]").length === 3')
      await run(
        'window.fail=false;document.querySelector("button[aria-label=\\"Remove project Saved project\\"]").focus();document.querySelector("button[aria-label=\\"Remove project Saved project\\"]").click()'
      )
      await waitFor('!window.fixture.values.includes("/saved")')
      assert.equal(await run('window.fixture.sendError'), null)
      assert.notEqual(await run('window.fixture.current'), '/saved')
      assert.equal(await run('window.fixture.values.includes("/history")'), true)
      await assertOpen()
      assert.equal(await run('document.querySelector("input[type=search]").value'), '/')
      assert.equal(await run('document.activeElement === document.querySelector("input[type=search]")'), true)
      await waitFor('!!document.querySelector("button[aria-label=\\"Remove project history\\"]")')
      await run('document.querySelector("button[aria-label=\\"Remove project history\\"]").click()')
      await waitFor('!window.fixture.values.includes("/history")')
      await assertOpen()
      await run('window.reorder()')
      assert.equal(await run('window.fixture.values.includes("/saved")'), false)
      await run('window.restore()')
      await waitFor('window.fixture.values.includes("/saved")')
      await run('Array.from(document.querySelectorAll("[role=option]")).find(option=>option.textContent.includes("Saved again")).click()')
      await waitFor('document.querySelector("button[aria-label=Project]").getAttribute("aria-expanded") === "false"')
      assert.equal(await run('window.fixture.current'), '/saved')
      console.log(
        'Project selector UI checks passed: confirmation, cancel, failure, removal keeps menu and search open, restore, and selection closes menu.'
      )
    } catch (error) {
      console.error(error)
      exitCode = 1
    } finally {
      window.destroy()
      app.exit(exitCode)
    }
  })
}
