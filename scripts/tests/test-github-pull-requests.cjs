const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.resolve('tmp/github-prs-'))
    try {
      await require('esbuild').build({
        stdin: {
          resolveDir: process.cwd(),
          loader: 'tsx',
          contents: `
            import React, { useState } from 'react'
            import { createRoot } from 'react-dom/client'
            import { ChangesHeader } from './src/renderer/src/workspace/components/ChangesHeader'
            import { ChangesContent } from './src/renderer/src/workspace/components/ChangesContent'
            import { useGitHubPullRequests } from './src/renderer/src/workspace/useGitHubPullRequests'
            import { ChangesSidebar } from './src/renderer/src/workspace/components/ChangesSidebar'
            import './src/renderer/src/assets/styles/tokens.css'
            import './src/renderer/src/assets/styles/base.css'
            import './src/renderer/src/App.css'
            function Fixture() {
              const [gitPaneView, setGitPaneView] = useState('changes')
              const [view, setView] = useState('git')
              const [cwd, setCwd] = useState('/project')
              const [browserEnabled, setBrowserEnabled] = useState(true)
              window.selectProject = setCwd
              window.setBrowserEnabled = setBrowserEnabled
              const settings = {browser: {enabled: browserEnabled}, appearance: {zoomLevel: 1}}
              const gitHubPullRequests = useGitHubPullRequests({active: view === 'git' && gitPaneView === 'pull-requests', cwd})
              const header = <ChangesHeader gitHubPullRequests={gitHubPullRequests} gitPaneView={gitPaneView} setGitPaneView={setGitPaneView}
                changesPaneView={view} handleChangesPaneViewChange={setView} changesCwd={cwd}
                effectiveAppSettings={settings} renderWindowControls={() => null} renderSettingsButton={() => null}
                activeTreeFolderPaths={[]} branchNames={['main']} currentBranchName="main" />
              const content = <ChangesContent gitHubPullRequests={gitHubPullRequests} gitPaneView={gitPaneView} changesPaneView={view}
                changesCwd={cwd} changesProjectCwd={cwd} effectiveAppSettings={settings}
                visibleChangesLoadState="ready" changedFiles={[]} changesEmptyMessage="No changes"
                visibleFilesLoadState="ready" repositoryFileCount={0}
                browserOpened={view === 'browser'} handleOpenBrowserRequest={request => {
                  window.builtInLinks.push(request.url); setView('browser')
                }} />
              return <div className="chat" style={{display:'block', padding:20}}>
                <div style={{width:390,height:'calc(100vh - 40px)'}}>
                  <ChangesSidebar header={header} content={content} footer={null} />
                </div>
              </div>
            }
            createRoot(document.getElementById('root')).render(<Fixture />)
          `
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        outfile: path.join(directory, 'fixture.js'),
        plugins: [
          {
            name: 'unused-panels',
            setup(build) {
              build.onLoad(
                {
                  filter: /\/(BrowserPanel|TerminalPanel|BranchSwitcher|RecentReferencesList)\.tsx$/
                },
                ({ path: filename }) => ({
                  contents: `export const ${path.basename(filename, '.tsx')} = () => null`,
                  loader: 'js'
                })
              )
            }
          }
        ]
      })
      await fs.writeFile(
        path.join(directory, 'fixture.html'),
        `<!doctype html>
        <html data-color-scheme="dark"><head><link rel="stylesheet" href="fixture.css"></head><body>
        <div id="root"></div><script>
          window.requests=[];window.externalLinks=[];window.builtInLinks=[];
          window.appApi={
            getGitHubPullRequests: options => new Promise((resolve,reject) => window.requests.push({options,resolve,reject})),
            handleExternalLink: async options => {window.externalLinks.push(options); return {action:'open',always:false}}
          };
        </script><script src="fixture.js"></script></body></html>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 55000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0) throw new Error(result.stderr || 'GitHub PR UI check failed')
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow } = require('electron')
  app.commandLine.appendSwitch('force-prefers-reduced-motion')
  app.setPath('userData', path.join(process.argv[2], 'profile'))
  app.whenReady().then(async () => {
    const window = new BrowserWindow({
      show: false,
      width: 450,
      height: 720,
      webPreferences: { offscreen: true }
    })
    let exitCode = 0
    try {
      await window.loadFile(path.join(process.argv[2], 'fixture.html'))
      const run = (source) => window.webContents.executeJavaScript(source)
      const capture = async (name) => {
        await run(
          `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            .then(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))))`
        )
        await fs.writeFile(
          path.resolve('test-results/github-pull-requests', name),
          (await window.webContents.capturePage()).toPNG()
        )
      }
      const wait = (expression) =>
        run(`new Promise((resolve,reject)=>{
        const done=()=>{if(${expression}){observer.disconnect();clearTimeout(timer);resolve()}};
        const observer=new MutationObserver(done);observer.observe(document.body,{childList:true,subtree:true,attributes:true});
        const timer=setTimeout(()=>{observer.disconnect();reject(new Error('UI condition: '+${JSON.stringify(expression)}))},5000);done();
      })`)
      const click = (label) =>
        run(
          `Array.from(document.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === ${JSON.stringify(label)} || button.textContent === ${JSON.stringify(label)}).click()`
        )
      const page = (number, pageNumber = 1, pageCount = 3) => ({
        repository: 'example/sele',
        totalCount: pageCount === 1 ? 4 : 41,
        page: pageNumber,
        pageCount,
        pullRequests: [
          {
            number,
            title: 'Keep project navigation responsive when switching between large conversations',
            url: `https://github.com/example/sele/pull/${number}`,
            isDraft: false,
            state: 'open',
            author: 'kitkat'
          }
        ]
      })
      const reply = (index, value) =>
        run(`window.requests[${index}].resolve(${JSON.stringify(value)})`)
      const loaded = (number) =>
        wait(
          `document.querySelector('ul[aria-label="Pull requests"] .changes-sidebar__recent-label')?.textContent.startsWith('#${number} ')`
        )
      const request = async (index, pageNumber) => {
        await wait(`window.requests.length === ${index + 1}`)
        assert.equal(await run(`window.requests[${index}].options.page`), pageNumber)
      }
      const enterPage = async (value) => {
        await run(`(() => {
          const input=document.querySelector('[aria-label="Pull request page"]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, ${JSON.stringify(value)});
          input.dispatchEvent(new Event('input',{bubbles:true}));
        })()`)
        await run(
          `document.querySelector('[aria-label="Pull request page"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`
        )
      }
      const selectState = (label) =>
        run(
          `Array.from(document.querySelectorAll('[role="option"]')).find(option => option.textContent.trim() === ${JSON.stringify(label)}).click()`
        )

      await wait(`document.querySelector('[aria-label="Git view"]')`)
      assert.equal(await run('window.requests.length'), 0)
      await click('Pull requests')
      await request(0, 1)
      assert.deepEqual(await run('window.requests[0].options.states'), ['open', 'draft'])
      await reply(0, page(1))
      await loaded(1)
      assert.equal(
        await run(`document.querySelector('[aria-label="Pull request page"]').value`),
        '1'
      )
      await click('Next page')
      await request(1, 2)
      await reply(1, page(2, 2))
      await loaded(2)
      await enterPage('99')
      await request(2, 3)
      await reply(2, page(3, 3))
      await loaded(3)
      assert.equal(
        await run(`document.querySelector('[aria-label="Pull request page"]').value`),
        '3'
      )
      assert.equal(await run(`document.querySelector('[aria-label="Next page"]').disabled`), true)
      await click('Refresh pull requests')
      await request(3, 3)
      await reply(3, page(3, 3))
      await loaded(3)
      await enterPage('-4')
      await request(4, 1)
      await reply(4, page(1))
      await loaded(1)
      await click('Next page')
      await request(5, 2)
      await reply(5, page(2, 2))
      await loaded(2)
      await click('Previous page')
      await request(6, 1)
      await reply(6, page(1))
      await loaded(1)
      await click('Open pull request #1 in external browser')
      assert.deepEqual(await run('window.externalLinks'), [
        { url: page(1).pullRequests[0].url, action: 'open' }
      ])
      await click('Open pull request #1 in built-in browser')
      await wait(
        `document.querySelector('[aria-label="Browser"]').getAttribute('aria-pressed') === 'true'`
      )
      assert.deepEqual(await run('window.builtInLinks'), [page(1).pullRequests[0].url])
      await click('Git')
      await request(7, 1)
      await reply(7, page(1))
      await loaded(1)
      await click('Pull request states')
      await wait(`document.querySelector('[role="listbox"][aria-multiselectable="true"]')`)
      await selectState('Merged')
      await request(8, 1)
      assert.deepEqual(await run('window.requests[8].options.states'), ['open', 'draft', 'merged'])
      await reply(8, page(7))
      await loaded(7)
      await selectState('Closed')
      await request(9, 1)
      assert.deepEqual(await run('window.requests[9].options.states'), [
        'open',
        'draft',
        'merged',
        'closed'
      ])
      const allStates = page(42, 1, 1)
      allStates.pullRequests = ['open', 'merged', 'closed', 'draft'].map((state, index) => ({
        ...page(42 + index).pullRequests[0],
        state,
        isDraft: state === 'draft',
        title: [
          'Keep project navigation responsive',
          'Empty PR fixture',
          'Closed PR fixture',
          'Draft PR fixture'
        ][index]
      }))
      await reply(9, allStates)
      await loaded(42)
      assert.equal(
        await run(`document.querySelector('[aria-label="Pull request page"]') === null`),
        true
      )
      assert.equal(
        await run(`document.querySelector('[aria-label="Previous page"]') === null`),
        true
      )
      assert.equal(await run(`document.querySelector('[aria-label="Next page"]') === null`), true)
      await fs.mkdir(path.resolve('test-results/github-pull-requests'), { recursive: true })
      await capture('states-menu.png')
      await click('Pull request states')
      await run('window.setBrowserEnabled(false)')
      await wait(
        `document.querySelector('[aria-label="Open pull request #42 in built-in browser"]').disabled`
      )
      await run('window.setBrowserEnabled(true)')
      await wait(
        `!document.querySelector('[aria-label="Open pull request #42 in built-in browser"]').disabled`
      )
      const colors = await run(
        `Array.from(document.querySelectorAll('ul[aria-label="Pull requests"] .changes-sidebar__pull-request-icon')).map(icon => getComputedStyle(icon).color)`
      )
      assert.equal(new Set(colors).size, 4)
      const row = await run(
        `(() => { const rect=document.querySelector('ul[aria-label="Pull requests"] > li').getBoundingClientRect();return {x:rect.x+10,y:rect.y+rect.height/2} })()`
      )
      window.webContents.sendInputEvent({ type: 'mouseMove', ...row })
      await capture('panel.png')
      await run(`document.documentElement.dataset.colorScheme='light'`)
      await capture('panel-light.png')
      await click('Refresh pull requests')
      await request(10, 1)
      const multiple = page(42)
      multiple.pullRequests = Array.from({ length: 20 }, (_, index) => ({
        ...page(42 + index).pullRequests[0],
        state: ['open', 'merged', 'closed', 'draft'][index % 4]
      }))
      await reply(10, multiple)
      await loaded(42)
      await run(`document.querySelector('.chat > div').style.width='300px'`)
      await capture('panel-narrow.png')
      await click('Refresh pull requests')
      await request(11, 1)
      await run(`window.selectProject('/other')`)
      await request(12, 1)
      await reply(12, page(60, 1, 1))
      await loaded(60)
      await reply(11, page(99))
      assert.equal(
        await run(
          `document.querySelector('ul[aria-label="Pull requests"] .changes-sidebar__recent-label').textContent.startsWith('#60 ')`
        ),
        true
      )
      await click('Refresh pull requests')
      await request(13, 1)
      await run(`window.requests[13].reject(new Error('Run gh auth login'))`)
      await wait(`document.querySelector('[role="alert"]')?.textContent.includes('gh auth login')`)
      await click('Retry')
      await request(14, 1)
      await reply(14, {
        repository: 'example/sele',
        totalCount: 0,
        page: 1,
        pageCount: 1,
        pullRequests: []
      })
      await wait(`document.body.textContent.includes('No pull requests match the selected states')`)
      await click('Changes')
      await wait(`document.body.textContent.includes('No changes')`)
      console.log(
        'GitHub pull request UI checks passed: state filtering, page clamping, browser actions, and project isolation'
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
