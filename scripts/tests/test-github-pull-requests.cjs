const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.resolve('tmp/github-prs-'))
    try {
      await require('esbuild').build({
        entryPoints: [path.resolve('src/renderer/src/chatMarkdown.worker.ts')],
        outfile: path.join(directory, 'markdown-worker.js'),
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        alias: {
          'decode-named-character-reference': path.resolve(
            'node_modules/decode-named-character-reference/index.js'
          )
        }
      })
      await require('esbuild').build({
        stdin: {
          resolveDir: process.cwd(),
          loader: 'tsx',
          contents: `
            import React, { useState } from 'react'
            import { mockGitHubPullRequests } from './scripts/tests/fixtures/githubPullRequests'
            if (${JSON.stringify(process.env.SELE_TEST_PR_MOCKS === '1')}) {
              window.appApi.getGitHubPullRequests = async options => mockGitHubPullRequests(options, 100)
            }
            import { createRoot } from 'react-dom/client'
            import { GitHubPullRequestDetail } from './src/renderer/src/components/GitHubPullRequestDetail'
            import { ChatDetailItem } from './src/renderer/src/components/ChatDetailItem'
            import { ChangesHeader } from './src/renderer/src/workspace/components/ChangesHeader'
            import { ChangesContent } from './src/renderer/src/workspace/components/ChangesContent'
            import { useGitHubPullRequests } from './src/renderer/src/workspace/useGitHubPullRequests'
            import { ChangesSidebar } from './src/renderer/src/workspace/components/ChangesSidebar'
            import './src/renderer/src/assets/styles/tokens.css'
            import './src/renderer/src/assets/styles/base.css'
            import './src/renderer/src/App.css'
            function Fixture() {
              const [review, setReview] = useState(null)
              const [reviewDraft, setReviewDraft] = useState({body:'',comments:[],commitId:null})
              window.showReview = setReview
              window.reviewDraft = reviewDraft
              const [comparison, setComparison] = useState(null)
              window.showComparison = setComparison
              const [gitPaneView, setGitPaneView] = useState('changes')
              const [view, setView] = useState('git')
              const [cwd, setCwd] = useState('/project')
              const [browserEnabled, setBrowserEnabled] = useState(true)
              window.selectProject = setCwd
              window.setBrowserEnabled = setBrowserEnabled
              const settings = {browser: {enabled: browserEnabled}, appearance: {zoomLevel: 1}}
              const gitHubPullRequests = useGitHubPullRequests({active: view === 'git' && gitPaneView === 'pull-requests', cwd})
              const cached = Array.from({length:gitHubPullRequests.totalCount},(_,index)=>({index,pr:gitHubPullRequests.getPullRequest(index)})).filter(item=>item.pr)
              window.prMaxCachedCount = Math.max(window.prMaxCachedCount ?? 0,cached.length)
              window.prSnapshot = { count:cached.length,total:gitHubPullRequests.totalCount,
                loading:gitHubPullRequests.loading,loadingMore:gitHubPullRequests.loadingRows,error:gitHubPullRequests.error,
                numbers:cached.map(item=>item.pr.number),indices:cached.map(item=>item.index) }
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
              if (review) return <div className="chat" style={{display:'block',padding:20}}><div style={{position:'relative',width:650,height:'calc(100vh - 40px)'}}>
                <GitHubPullRequestDetail key={review.number} state={{selected:review,result:review,loading:false,error:null,cwd:'/project',reviewDraft,setReviewDraft,refresh:()=>{window.reviewRefreshes=(window.reviewRefreshes??0)+1}}} browserEnabled={true} onOpenBrowser={()=>{}} onOpenExternal={async()=>{}} />
              </div></div>
              if (comparison) return <div className="chat chat--has-selection" style={{display:'block',padding:20}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:24,height:800}}>
                  <div data-comparison="pr" style={{position:'relative',minWidth:0}}>
                    <GitHubPullRequestDetail state={{selected:comparison,result:comparison,loading:false,error:null}} browserEnabled={true} onOpenBrowser={()=>{}} onOpenExternal={async()=>{}} />
                  </div>
                  <div className="chat-panel chat-panel--selected" data-comparison="agent">
                    <div className="chat-detail__messages-shell"><div className="chat-detail__messages"><div className="chat-detail__messages-layout">
                      <div className="chat-detail__messages-header" /><div className="chat-detail__messages-inner">
                        <ChatDetailItem item={{type:'message',id:'reference-incoming',role:'assistant',content:comparison.body,createdAt:Date.parse(comparison.createdAt)}} />
                        <ChatDetailItem item={{type:'message',id:'reference-outgoing',role:'user',content:'LGTM',createdAt:Date.parse(comparison.activity.find(item=>item.kind==='comment').createdAt)}} />
                      </div><div className="chat-detail__messages-footer" />
                    </div></div></div>
                  </div>
                </div>
              </div>
              return <div className="chat" style={{display:'block', padding:20}}>
                <div style={{width:390,height:'calc(100vh - 40px)'}}>
                  <ChangesSidebar header={header} content={content} footer={null} />
                </div>
              </div>
            }
            createRoot(document.getElementById('root')).render(<Fixture />)
          `
        },
        define: {
          'import.meta.env.VITE_SELE_ANDROID': JSON.stringify('false'),
          'import.meta.env.DEV': 'false'
        },
        loader: { '.ttf': 'dataurl' },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        outfile: path.join(directory, 'fixture.js'),
        plugins: [
          {
            name: 'unused-panels',
            setup(build) {
              build.onResolve({ filter: /\?worker$/ }, (args) => ({
                path: args.path,
                namespace: 'fixture-worker'
              }))
              build.onLoad({ filter: /.*/, namespace: 'fixture-worker' }, ({ path: worker }) => ({
                contents: worker.includes('chatMarkdown.worker')
                  ? `export default class extends Worker {constructor(){super('./markdown-worker.js')}}`
                  : 'export default class {}',
                loader: 'js'
              }))
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
      const reviewData = process.env.SELE_TEST_PR_DATA
        ? JSON.parse(await fs.readFile(process.env.SELE_TEST_PR_DATA, 'utf8'))
        : null
      await fs.writeFile(path.join(directory, 'review-data.json'), JSON.stringify(reviewData))
      await fs.writeFile(
        path.join(directory, 'fixture.html'),
        `<!doctype html>
        <html data-color-scheme="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body>
        <div id="root"></div><script>
          window.requests=[];window.detailRequests=[];window.externalLinks=[];window.builtInLinks=[];
          window.preferencesApi={getItem:key=>({ok:true,value:localStorage.getItem(key)}),setItem:(key,value)=>{localStorage.setItem(key,value);return {ok:true,value:null}},removeItem:key=>{localStorage.removeItem(key);return {ok:true,value:null}}};
          window.prFileRequests=[];window.reviewSubmissions=[];
          window.prChanges={commitId:'a'.repeat(40),files:[]};
          window.appApi={
            getGitHubPullRequestChanges: async options => {window.prFileRequests.push(options);return window.prChanges},
            submitGitHubPullRequestReview: async options => {window.reviewSubmissions.push(options);if(window.failReview)throw new Error('Review submission failed')},
            readTextFile: async () => {throw new Error('PR review must not read the checkout')},
            getFileTree: async () => {throw new Error('PR review must not read the checkout tree')},
            getGitHubPullRequests: options => new Promise((resolve,reject) => {
              const request={options,settled:false,resolve(value){request.settled=true;resolve(value)},reject(error){request.settled=true;reject(error)}};
              window.requests.push(request)
            }),
            getGitHubPullRequest: options => new Promise((resolve,reject) => {
              window.detailRequests.push({options,resolve,reject})
            }),
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
      show: true,
      width: 450,
      height: 720,
      useContentSize: true,
      webPreferences: { backgroundThrottling: false }
    })
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error') console.error('Renderer:', event.message)
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
      const page = (start, pageNumber = 1, pageCount = 50, count = 20) => ({
        repository: 'example/sele',
        totalCount: pageCount === 1 ? count : pageCount * 20,
        page: pageNumber,
        pageCount,
        pullRequests: Array.from({ length: count }, (_, index) => ({
          number: start + index,
          title: `Fixture ${start + index}: keep project navigation responsive`,
          url: `https://github.com/example/sele/pull/${start + index}`,
          isDraft: false,
          state: 'open',
          author: 'kitkat'
        }))
      })
      const reply = (index, value) =>
        run(`window.requests[${index}].resolve(${JSON.stringify(value)})`)
      const ready = (count) =>
        wait(
          `window.prSnapshot.count === ${count} && !window.prSnapshot.loading && !window.prSnapshot.loadingMore`
        )
      const contains = (number) =>
        wait(
          `Array.from(document.querySelectorAll('ul[aria-label="Pull requests"] .changes-sidebar__recent-label')).some(row=>row.textContent.startsWith('#${number} '))`
        )
      const scrollEdge = (bottom) =>
        run(`new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Virtual list did not finish measuring')),5000);
        const scroll=()=>{const scroller=document.querySelector('[data-virtuoso-scroller]');const row=scroller?.querySelector('[data-index]');
          if(row && row.getBoundingClientRect().height>0 && scroller.scrollHeight >= window.prSnapshot.total*row.getBoundingClientRect().height-5){
            scroller.scrollTop=${bottom ? 'scroller.scrollHeight' : '0'};scroller.dispatchEvent(new Event('scroll'));clearTimeout(timer);resolve();
          }else requestAnimationFrame(scroll);
        };requestAnimationFrame(scroll);
      })`)
      const search = (value) =>
        run(`(()=>{const input=document.querySelector('[aria-label="Search pull requests"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
      const selectState = (label) =>
        run(
          `Array.from(document.querySelectorAll('[role="option"]')).find(option=>option.textContent.trim()===${JSON.stringify(label)}).click()`
        )
      const request = async (expectedPage, after = 0) => {
        await wait(
          `window.requests.some((request,index)=>index>=${after} && !request.settled && request.options.page===${expectedPage})`
        )
        return run(
          `window.requests.findIndex((request,index)=>index>=${after} && !request.settled && request.options.page===${expectedPage})`
        )
      }

      await wait(`document.querySelector('[aria-label="Git view"]')`)
      assert.equal(await run('window.requests.length'), 0)
      await click('Pull requests')
      assert.equal(
        await run(`document.querySelector('[aria-label="Pull request page"]')===null`),
        true
      )

      if (process.env.SELE_TEST_PR_MOCKS === '1') {
        await ready(50)
        await contains(10100)
        assert.equal(await run('window.prSnapshot.total'), 50)
        await click('Pull request states')
        await wait(`document.querySelector('[role="listbox"]')`)
        await selectState('Merged')
        await wait('window.prSnapshot.total===75 && !window.prSnapshot.loadingMore')
        await selectState('Closed')
        await wait('window.prSnapshot.total===100 && !window.prSnapshot.loadingMore')
        await click('Pull request states')
        await contains(10100)
        assert.equal(await run('window.prSnapshot.count'), 60)
        await scrollEdge(true)
        await contains(10001)
        await ready(60)
        assert.ok(!(await run('window.prSnapshot.numbers')).includes(10100))
        await scrollEdge(false)
        await contains(10100)
        await ready(60)
        assert.ok(!(await run('window.prSnapshot.numbers')).includes(10001))
        assert.ok(await run('window.prMaxCachedCount<=60'))
        assert.ok(
          await run(`document.querySelectorAll('ul[aria-label="Pull requests"] > li').length<40`)
        )
        assert.equal(await run('window.requests.length'), 0)
        await fs.mkdir(path.resolve('test-results/github-pull-requests'), { recursive: true })
        await capture('mock-window.png')
        await search('#10001')
        await ready(1)
        await contains(10001)
        await search('no-such-pull-request')
        await wait(`document.body.textContent.includes('No pull requests match your search')`)
        await search('navigation conversations')
        await ready(20)
        await wait(
          `document.querySelectorAll('ul[aria-label="Pull requests"] .changes-sidebar__recent-label').length>0 && Array.from(document.querySelectorAll('ul[aria-label="Pull requests"] .changes-sidebar__recent-label')).every(row=>['navigation','conversations'].every(word=>row.textContent.toLowerCase().includes(word)))`
        )
        await capture('mock-window-search.png')
        console.log(
          'GitHub bounded mock window passed: full scrollbar, bidirectional scrolling, <=60 cached PRs, and search across evicted data'
        )
        return
      }
      const first = await request(1)
      await reply(first, page(1))
      await reply(await request(2), page(21, 2))
      await reply(await request(3), page(41, 3))
      await ready(60)
      await contains(1)
      const firstRequestCount = await run('window.requests.length')
      await scrollEdge(true)
      const bottom = await request(50, firstRequestCount)
      await run(`window.requests[${bottom}].reject(new Error('Temporary page failure'))`)
      await reply(await request(49, firstRequestCount), page(961, 49))
      await reply(await request(48, firstRequestCount), page(941, 48))
      await wait(
        `document.querySelector('[role="alert"]')?.textContent.includes('Temporary page failure')`
      )
      assert.equal(await run('window.prSnapshot.count'), 40)
      await click('Retry')
      await reply(await request(50, firstRequestCount), page(981, 50))
      await ready(60)
      await contains(1000)
      assert.ok(!(await run('window.prSnapshot.numbers')).includes(1))
      const pagesBeforeReturn = await run('window.requests.map(request=>request.options.page)')
      assert.ok(
        pagesBeforeReturn.every((number) => [1, 2, 3, 48, 49, 50].includes(number)),
        'jump must not fetch intervening pages'
      )
      // Open details at the end of the virtual list, then return without losing its window.
      const originalScroll = await run(
        `document.querySelector('[data-virtuoso-scroller]').scrollTop`
      )
      await click('View pull request #1000: Fixture 1000: keep project navigation responsive')
      await wait('window.detailRequests.length===1')
      assert.deepEqual(await run('window.detailRequests[0].options'), {
        cwd: '/project',
        container: undefined,
        repository: 'example/sele',
        number: 1000
      })
      await wait(
        `document.querySelector('[aria-label="Pull request #1000 details"][aria-busy="true"]')`
      )
      const detail = {
        ...page(1000, 1, 1, 1).pullRequests[0],
        repository: 'example/sele',
        viewerLogin: 'KITKAT',
        body: 'A **native description** with [a relative link](../../issues/2). <script>window.prUnsafe=true</script>',
        baseRefName: 'main',
        headRefName: 'feature/details',
        createdAt: '2026-11-01T12:00:00Z',
        updatedAt: '2026-11-02T12:00:00Z',
        mergedAt: null,
        closedAt: null,
        additions: 12,
        deletions: 3,
        changedFiles: 2,
        reviewDecision: 'APPROVED',
        statusAuthor: 'kitkat',
        statusAt: new Date(Date.now() - 15000).toISOString(),
        activity: [
          {
            id: 'comment:1',
            author: 'reviewer',
            body: 'Useful **feedback**',
            createdAt: '2026-11-02T10:00:00Z',
            kind: 'comment',
            state: null
          },
          {
            id: 'comment:2',
            author: 'kitkat',
            body: 'Thanks, updated the **implementation**.',
            createdAt: '2026-11-02T11:00:00Z',
            kind: 'comment',
            state: null
          },
          {
            id: 'review:3',
            author: 'reviewer',
            body: '',
            createdAt: '2026-11-02T12:00:00Z',
            kind: 'review',
            state: 'APPROVED'
          },
          {
            id: 'comment:4',
            author: null,
            body: 'A deleted author is still incoming.',
            createdAt: '2026-11-02T13:00:00Z',
            kind: 'comment',
            state: null
          }
        ]
      }
      await run(`window.detailRequests[0].resolve(${JSON.stringify(detail)})`)
      await wait(
        `document.querySelector('[data-chat-message-id="github:example/sele:1000:description"] strong')?.textContent==='native description'`
      )
      assert.ok(
        await run(
          `document.querySelector('[aria-label="Pull request conversation"]').textContent.includes('Useful feedback')`
        )
      )
      assert.equal(await run('!!window.prUnsafe'), false)
      const conversation = '[aria-label="Pull request conversation"]'
      assert.equal(
        await run(
          `document.querySelector('${conversation} [data-chat-message-id="github:example/sele:1000:description"]').classList.contains('chat-detail__message-block--user')`
        ),
        true
      )
      assert.equal(
        await run(
          `document.querySelector('${conversation} [data-chat-message-id="github:example/sele:1000:comment:2"]').classList.contains('chat-detail__message-block--user')`
        ),
        true
      )
      for (const id of ['comment:1', 'comment:4'])
        assert.equal(
          await run(
            `document.querySelector('${conversation} [data-chat-message-id="github:example/sele:1000:${id}"]').classList.contains('chat-detail__message-block--assistant')`
          ),
          true
        )
      assert.equal(
        await run(
          `document.querySelector('${conversation} [data-pr-event="APPROVED"]').textContent.trim()`
        ),
        'Approved by reviewer'
      )
      assert.equal(
        await run(
          `document.querySelectorAll('${conversation} [aria-label="Copy message"]').length`
        ),
        4
      )
      assert.equal(await run(`document.querySelectorAll('${conversation} time').length`), 4)

      assert.equal(
        await run(
          `Array.from(document.querySelectorAll('${conversation} .chat-detail__pending-message-label')).some(label=>/Description|Commented/.test(label.textContent))`
        ),
        false
      )
      assert.equal(
        await run(
          `document.querySelectorAll('${conversation} .chat-detail__message--bubble').length`
        ),
        4
      )
      assert.ok(
        await run(
          `document.querySelector('[aria-label="Pull request status"]').textContent.includes('Opened by kitkat · Just now')`
        )
      )
      assert.equal(
        await run(
          `document.querySelector('[aria-label="Pull request detail controls"]').closest('header')?.classList.contains('changes-sidebar__pull-request-heading')`
        ),
        true
      )
      assert.equal(
        await run(
          `document.querySelector('[aria-label="Pull request changes"]').scrollWidth <= document.querySelector('[aria-label="Pull request changes"]').clientWidth`
        ),
        true
      )
      await fs.mkdir(path.resolve('test-results/github-pull-requests'), { recursive: true })
      await capture('native-details.png')
      await click('Refresh pull request')
      await wait('window.detailRequests.length===2')
      await run(`window.detailRequests[1].reject(new Error('Temporary detail failure'))`)
      await wait(
        `document.querySelector('[aria-label="Pull request details error"]').textContent.includes('Temporary detail failure')`
      )
      await click('Retry')
      await wait('window.detailRequests.length===3')
      await click('Back to pull requests')
      await wait(`!document.querySelector('[aria-label="Pull request #1000 details"]')`)
      await contains(1000)
      await run(
        `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
      )
      assert.equal(
        await run(`document.querySelector('[data-virtuoso-scroller]').scrollTop`),
        originalScroll
      )
      await click('View pull request #999: Fixture 999: keep project navigation responsive')
      await wait('window.detailRequests.length===4')
      await run(
        `window.detailRequests[2].resolve(${JSON.stringify({ ...detail, title: 'Stale detail' })})`
      )
      assert.equal(
        await run(
          `document.querySelector('[aria-label="Pull request #999 details"] h3').textContent.includes('Stale detail')`
        ),
        false
      )
      const externalBody =
        '[Relative repository link](../../issues/2)\n\n![No local file](file:///tmp/pr-private-image.png)\n\nvisualize{"path":"/tmp/pr-private.html"}\n\n' +
        'An ordinary paragraph with **formatting**.\n\n'.repeat(120)
      await run(
        `window.detailRequests[3].resolve(${JSON.stringify({ ...detail, number: 999, title: 'Current detail', body: externalBody })})`
      )
      await wait(
        `document.querySelector('[aria-label="Pull request #999 details"] h3').textContent.includes('Current detail')`
      )
      await wait(
        `document.querySelector('[aria-label="Pull request #999 details"] .chat-detail__message-markdown a')?.getAttribute('href')==='https://github.com/example/issues/2'`
      )
      assert.equal(
        await run(
          `document.querySelectorAll('[aria-label="Pull request #999 details"] [data-local-image-path], [aria-label="Pull request #999 details"] [data-visualization]').length`
        ),
        0
      )
      await click('Refresh pull request')
      await wait('window.detailRequests.length===5')
      await run(`window.detailRequests[4].resolve(${JSON.stringify({ ...detail, number: 999 })})`)
      await wait(`document.querySelector('[aria-label="Pull request conversation"]')`)
      assert.equal(
        await run(`document.querySelector('[aria-label="Pull request details error"]')===null`),
        true
      )
      await click('Back to pull requests')
      await click('Open pull request #1000 in external browser')
      assert.equal(
        (await run('window.externalLinks'))[0].url,
        'https://github.com/example/sele/pull/1000'
      )
      const afterBottom = await run('window.requests.length')
      await scrollEdge(false)
      await reply(await request(1, afterBottom), page(1))
      await reply(await request(2, afterBottom), page(21, 2))
      await reply(await request(3, afterBottom), page(41, 3))
      await ready(60)
      await contains(1)
      assert.ok(!(await run('window.prSnapshot.numbers')).includes(1000))
      assert.ok(await run('window.prMaxCachedCount<=60'))
      const beforeBrowser = await run('window.requests.length')
      await click('Open pull request #1 in built-in browser')
      await wait(
        `document.querySelector('[aria-label="Browser"]').getAttribute('aria-pressed')==='true'`
      )
      await click('Git')
      await contains(1)
      assert.equal(
        await run('window.requests.length'),
        beforeBrowser,
        'cached window should survive browser navigation'
      )
      await search('older query')
      const oldSearch = await request(1, beforeBrowser)
      await search('newer query')
      const newSearch = await request(1, oldSearch + 1)
      await reply(newSearch, page(999, 1, 1, 1))
      await ready(1)
      await contains(999)
      await reply(oldSearch, page(666, 1, 1, 1))
      assert.deepEqual(await run('window.prSnapshot.numbers'), [999])
      const beforeFilter = await run('window.requests.length')
      await click('Pull request states')
      await wait(`document.querySelector('[role="listbox"]')`)
      await selectState('Merged')
      await reply(await request(1, beforeFilter), page(7, 1, 1, 1))
      await ready(1)
      const beforeAll = await run('window.requests.length')
      await selectState('Closed')
      const allStates = page(42, 1, 1, 4)
      allStates.pullRequests.forEach((pr, index) => {
        pr.state = ['open', 'merged', 'closed', 'draft'][index]
        pr.isDraft = pr.state === 'draft'
      })
      await reply(await request(1, beforeAll), allStates)
      await ready(4)
      await contains(42)
      await click('Pull request states')
      const colors = await run(
        `Array.from(document.querySelectorAll('ul[aria-label="Pull requests"] .changes-sidebar__pull-request-icon')).map(icon=>getComputedStyle(icon).color)`
      )
      assert.equal(new Set(colors).size, 4)
      await click('View pull request #42: Fixture 42: keep project navigation responsive')
      await wait('window.detailRequests.length===6')
      await run(`window.selectProject('/temporary-project')`)
      await wait(`!document.querySelector('[aria-label="Back to pull requests"]')`)
      await run(
        `window.detailRequests[5].resolve(${JSON.stringify({ ...detail, number: 42, title: 'Wrong project detail' })})`
      )
      assert.equal(await run(`document.body.textContent.includes('Wrong project detail')`), false)
      const beforeReturnProject = await run('window.requests.length')
      await run(`window.selectProject('/project')`)
      await reply(await request(1, beforeReturnProject), allStates)
      await ready(4)
      const beforeRefresh = await run('window.requests.length')
      await click('Refresh pull requests')
      const oldProject = await request(1, beforeRefresh)
      await run(`window.selectProject('/other')`)
      const newProject = await request(1, oldProject + 1)
      await reply(newProject, page(901, 1, 1, 1))
      await ready(1)
      await contains(901)
      await reply(oldProject, page(999, 1, 1, 1))
      assert.deepEqual(await run('window.prSnapshot.numbers'), [901])
      const beforeError = await run('window.requests.length')
      await click('Refresh pull requests')
      const failed = await request(1, beforeError)
      await run(`window.requests[${failed}].reject(new Error('Run gh auth login'))`)
      await wait(`document.querySelector('[role="alert"]')?.textContent.includes('gh auth login')`)
      await click('Retry')
      await reply(await request(1, failed + 1), {
        repository: 'example/sele',
        totalCount: 0,
        page: 1,
        pageCount: 1,
        pullRequests: []
      })
      await wait(`document.body.textContent.includes('No pull requests match your search')`)
      await click('Changes')
      await wait(`document.body.textContent.includes('No changes')`)
      // Compare the exact PR from the user's screenshot with the agent chat at desktop width.
      const comparison = {
        ...detail,
        number: 6,
        repository: 'Chipi-Chapa-Corp/sele',
        viewerLogin: 'ExposedCat',
        author: 'chelokot',
        title: 'fix: stabilize SSH container sources',
        state: 'merged',
        headRefName: 'fix/ssh-non-posix-login-shell',
        changedFiles: 9,
        additions: 122,
        deletions: 48,
        reviewDecision: '',
        createdAt: '2026-08-17T21:44:30Z',
        updatedAt: '2026-08-18T08:45:48Z',
        statusAuthor: 'ExposedCat',
        statusAt: '2026-08-18T08:45:48Z',
        mergedAt: '2026-08-18T08:45:48Z',
        closedAt: '2026-08-18T08:45:48Z',
        body: 'Fix SSH container discovery with non-POSIX login shells and prevent background container checks from exhausting SSH sessions.\n\nCloses #5',
        activity: [
          {
            id: 'comment:real',
            author: 'ExposedCat',
            body: 'LGTM',
            createdAt: '2026-08-18T08:45:41Z',
            kind: 'comment',
            state: null
          },
          {
            id: 'event:commit',
            kind: 'event',
            state: 'committed',
            body: 'fix: stabilize SSH container sources',
            author: 'chelokot',
            commitSha: '7533709ab36e41ea2d6fab22fafc0e39a09823ed',
            createdAt: '2026-08-17T21:43:55Z'
          },
          {
            id: 'event:merged',
            kind: 'event',
            state: 'merged',
            body: '',
            author: 'ExposedCat',
            createdAt: '2026-08-18T08:45:48Z'
          }
        ]
      }
      comparison.activity.sort(
        (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)
      )
      window.setContentSize(1200, 900)
      await run(`window.showComparison(${JSON.stringify(comparison)})`)
      await wait(
        `document.querySelector('[data-comparison="pr"] .chat-detail__message--user')?.textContent.trim()==='LGTM'`
      )
      const appearance = await run(`['pr','agent'].map(pane=>{
        const root=document.querySelector('[data-comparison="'+pane+'"]');
        const inner=root.querySelector('.chat-detail__messages-inner');
        const bubble=root.querySelector('.chat-detail__message--user');
        const incoming=root.querySelector('.chat-detail__message--assistant');
        const style=getComputedStyle(bubble), layout=getComputedStyle(inner), panel=getComputedStyle(root.querySelector('.chat-panel') ?? root);
        const box=bubble.getBoundingClientRect(), available=inner.getBoundingClientRect();
        return {panelBackground:panel.backgroundColor,panelBorder:panel.border,panelRadius:panel.borderRadius,background:style.backgroundColor,borderRadius:style.borderRadius,fontFamily:style.fontFamily,fontSize:style.fontSize,lineHeight:style.lineHeight,bubblePadding:style.padding,maxWidth:style.maxWidth,contentPadding:layout.padding,gap:layout.gap,
          rightInset:Math.round(available.right-box.right),incomingLeftInset:Math.round(incoming.getBoundingClientRect().left-available.left)}
      })`)
      assert.deepEqual(
        appearance[0],
        appearance[1],
        'PR and agent chat must share the same rendered layout and bubble styling'
      )
      assert.ok(
        await run(
          `Array.from(document.querySelectorAll('[data-comparison="pr"] .chat-detail__context-compaction')).some(event=>event.textContent.includes('Merged by ExposedCat'))`
        )
      )
      assert.ok(
        await run(
          `Array.from(document.querySelectorAll('[data-comparison="pr"] .chat-detail__context-compaction')).some(event=>event.textContent.includes('Commit 7533709'))`
        )
      )
      assert.equal(
        await run(
          `(()=>{const root=document.querySelector('[data-comparison="pr"]');const pane=root.querySelector('.chat-panel');const content=root.querySelector('.chat-detail__messages-layout');return pane.clientHeight<=content.getBoundingClientRect().height+2})()`
        ),
        true,
        'short discussions must fit their contents'
      )
      await capture('pr-agent-comparison.png')
      await run(
        `window.showComparison(${JSON.stringify({ ...comparison, activity: Array.from({ length: 50 }, (_, index) => ({ id: 'long:' + index, kind: 'comment', state: null, author: index % 2 ? 'ExposedCat' : 'reviewer-' + index, body: 'A message with enough content to test scrolling. '.repeat(8), createdAt: '2026-08-18T08:45:41Z' })) })})`
      )
      await wait(
        `document.querySelectorAll('[data-comparison="pr"] [data-chat-message-id]').length===51`
      )
      assert.equal(
        await run(
          `(()=>{const root=document.querySelector('[data-comparison="pr"]');const pane=root.querySelector('.chat-panel');const scroller=root.querySelector('.chat-detail__messages');return pane.getBoundingClientRect().bottom<=root.getBoundingClientRect().bottom+1 && scroller.scrollHeight>scroller.clientHeight})()`
        ),
        true,
        'long discussions must scroll inside the available height'
      )

      await run(`document.documentElement.dataset.colorScheme='light'`)
      assert.equal(
        await run(
          `(()=>{const root=document.querySelector('[data-comparison="pr"]');return getComputedStyle(root.querySelector('.chat-detail__message--assistant')).color===getComputedStyle(root.querySelector('.chat-detail__message--user')).color})()`
        ),
        true
      )
      const live = JSON.parse(
        await fs.readFile(path.join(process.argv[2], 'review-data.json'), 'utf8')
      )
      const reviewDetail = live?.detail ?? comparison
      const reviewChanges = live?.changes ?? {
        commitId: 'a'.repeat(40),
        files: [
          {
            path: 'src/main/hostProcess.ts',
            previousPath: null,
            kind: 'edit',
            diff: '--- a/src/main/hostProcess.ts\n+++ b/src/main/hostProcess.ts\n@@ -1,2 +1,2 @@\n-old\n+new\n context\n'
          },
          {
            path: 'src/main/container.ts',
            previousPath: null,
            kind: 'edit',
            diff: '--- a/src/main/container.ts\n+++ b/src/main/container.ts\n@@ -1 +1 @@\n-before\n+after\n'
          }
        ]
      }
      await run(
        `document.documentElement.dataset.colorScheme='dark';window.prChanges=${JSON.stringify(reviewChanges)};window.showReview(${JSON.stringify(reviewDetail)})`
      )
      window.setContentSize(1000, 900)
      await wait(
        `document.querySelectorAll('[aria-label="Pull request changed files"] .changes-sidebar__tree-row--file').length===${reviewChanges.files.length}`
      )
      assert.equal(await run(`window.prFileRequests.at(-1).number`), reviewDetail.number)
      assert.equal(
        await run(`(() => {
        const files = document.querySelector('[aria-label="Pull request files"]');
        const discussion = document.querySelector('[aria-label="Pull request conversation"]').closest('.chat-panel');
        const composer = files.querySelector('[aria-label="Pull request review"]');
        const tree = files.querySelector('.changes-sidebar__pull-request-file-tree');
        const paneBox = discussion.getBoundingClientRect();
        const aligned = [composer, composer.querySelector('textarea'), tree].every(element => {
          const box = element.getBoundingClientRect();
          return Math.abs(box.left - paneBox.left) <= 1 && Math.abs(box.right - paneBox.right) <= 1;
        });
        return aligned && composer.getBoundingClientRect().bottom <= tree.getBoundingClientRect().top &&
          getComputedStyle(files).borderTopWidth === '0px' &&
          files.parentElement === discussion.parentElement &&
          !files.closest('.chat-panel') &&
          files.getBoundingClientRect().top >= discussion.getBoundingClientRect().bottom &&
          discussion.clientHeight > 0 && files.clientHeight > 0;
      })()`),
        true,
        'PR discussion, comment composer, and file tree must align at full pane width, in order, without a divider'
      )
      await run(
        `document.querySelector('[aria-label="Pull request conversation"]').scrollTop = 100`
      )
      assert.equal(
        await run(`document.querySelector('[aria-label="Pull request files"]').scrollTop`),
        0,
        'scrolling the discussion must not scroll the files pane'
      )
      await capture('pr-6-separate-panes.png')
      const textFiles = reviewChanges.files.filter((file) => file.diff.includes('@@ '))
      assert.ok(textFiles.length >= 2)
      const addComment = async (file, index, side = 'new') => {
        await click('Open ' + file.path)
        await wait(`document.querySelector('[role="dialog"] .diff-code')`)
        const expected = await run(`(() => {
          const cells=[...document.querySelectorAll('[role="dialog"] .diff-code[data-change-key]')];
          const cell=cells.find(cell=>cell.dataset.changeKey.startsWith(${JSON.stringify(side === 'old' ? 'D' : 'I')})) ?? cells[0];
          const range=document.createRange();range.selectNodeContents(cell);
          const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
          cell.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
          return cell.dataset.changeKey;
        })()`)
        await wait(`!document.querySelector('[aria-label="Comment on selection"]').disabled`)
        await click('Comment on selection')
        await wait(`document.querySelector('.unified-diff__review-form input')`)
        await run(`document.querySelector('.unified-diff__review-form input').focus()`)
        await window.webContents.insertText('Review comment ' + index)
        await click('Add comment')
        await wait(`window.reviewDraft.comments.length===${index}`)
        await capture(`pr-6-review-popup-${index}.png`)
        assert.equal(
          (await run('window.reviewDraft.comments.at(-1)')).side,
          expected.startsWith('D') ? 'old' : 'new'
        )
      }
      await addComment(textFiles[0], 1, 'old')
      await click('Close file editor')
      await addComment(textFiles[1], 2)
      await wait(
        `Array.from(document.querySelectorAll('[role="dialog"] button')).some(button=>button.textContent.includes('Continue') && button.textContent.includes('2'))`
      )
      await run(
        `Array.from(document.querySelectorAll('[role="dialog"] button')).find(button=>button.textContent.includes('Continue')).click()`
      )
      await wait(`!document.querySelector('[aria-label="Close file editor"]')`)
      await window.webContents.insertText('PR #6 review summary')
      await wait(
        `document.querySelector('[aria-label="Review summary"]').value==='PR #6 review summary'`
      )
      await capture('pr-6-review-draft.png')
      await run('window.failReview=true')
      await click('Post review')
      await wait(
        `document.querySelector('[aria-label="Pull request files"]').textContent.includes('Review submission failed')`
      )
      assert.equal(await run('window.reviewDraft.comments.length'), 2)
      assert.equal(await run('window.reviewDraft.body'), 'PR #6 review summary')
      await run('window.failReview=false')
      await click('Post review')
      await wait(
        `document.querySelector('[aria-label="Pull request files"]').textContent.includes('Review posted.')`
      )
      const submitted = await run('window.reviewSubmissions.at(-1)')
      assert.equal(submitted.number, reviewDetail.number)
      assert.equal(submitted.repository, reviewDetail.repository)
      assert.equal(submitted.commitId, reviewChanges.commitId)
      assert.equal(submitted.body, 'PR #6 review summary')
      assert.equal(submitted.comments.length, 2)
      assert.deepEqual(
        submitted.comments.map((comment) => comment.path),
        textFiles.slice(0, 2).map((file) => file.path)
      )
      assert.equal(await run('window.reviewDraft.comments.length'), 0)
      assert.equal(await run('window.reviewDraft.body'), '')
      await capture('pr-6-review-posted.png')
      console.log(
        'PR ' +
          reviewDetail.number +
          ' review passed: real diff tree, shared popup, cross-file comments, summary, failure recovery, and submission payload'
      )
      console.log(
        'GitHub bounded window UI passed: direct jumps, cache eviction/refetch, retry, stale responses, and browser actions'
      )
    } catch (error) {
      console.error(error)
      console.error(
        await window.webContents.executeJavaScript(
          `JSON.stringify({body:document.body.innerText.slice(0,1000),snapshot:window.prSnapshot,scroller:(()=>{const el=document.querySelector('[data-virtuoso-scroller]');return el?{top:el.scrollTop,height:el.clientHeight,total:el.scrollHeight,rowHeight:el.querySelector('[data-index]')?.getBoundingClientRect().height,row:el.querySelector('[data-index]')?.outerHTML.slice(0,220)}:null})(),rows:document.querySelectorAll('ul[aria-label="Pull requests"] > li').length,requests:window.requests?.map(r=>r.options)})`
        )
      )
      await fs.mkdir(path.resolve('test-results/github-pull-requests'), { recursive: true })
      await fs.writeFile(
        path.resolve('test-results/github-pull-requests/failure.png'),
        (await window.webContents.capturePage()).toPNG()
      )
      exitCode = 1
    } finally {
      window.destroy()
      app.exit(exitCode)
    }
  })
}
