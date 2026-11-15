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
        entryPoints: [path.resolve('node_modules/monaco-editor/esm/vs/editor/editor.worker.js')],
        outfile: path.join(directory, 'editor-worker.js'),
        bundle: true,
        platform: 'browser'
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
            import { EditableUnifiedDiff } from './src/renderer/src/components/EditableUnifiedDiff'
            import * as monaco from 'monaco-editor'
            window.monaco=monaco
            import { ChatDetailItem } from './src/renderer/src/components/ChatDetailItem'
            import { MessageSelectionQuoteButton } from './src/renderer/src/components/MessageSelectionQuoteButton'
            import { ChangesHeader } from './src/renderer/src/workspace/components/ChangesHeader'
            import { ChangesContent } from './src/renderer/src/workspace/components/ChangesContent'
            import { useGitHubPullRequests } from './src/renderer/src/workspace/useGitHubPullRequests'
            import { ChangesSidebar } from './src/renderer/src/workspace/components/ChangesSidebar'
            import './src/renderer/src/assets/styles/tokens.css'
            import './src/renderer/src/assets/styles/base.css'
            import './src/renderer/src/App.css'
            function Fixture() {
              const [editable,setEditable]=useState(false)
              window.showEditable=()=>setEditable(true)
              const [review, setReview] = useState(null)
              const [unrelatedRevision,setUnrelatedRevision] = useState(0)
              window.bumpUnrelatedWorkspace = () => setUnrelatedRevision(value => value + 1)
              window.unrelatedRevision = unrelatedRevision
              window.prFixtureRenders = (window.prFixtureRenders ?? 0) + 1
              const [reviewCommit,setReviewCommit] = useState(null)
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
              const settings = {git: {enablePullRequests: true}, browser: {enabled: browserEnabled}, appearance: {zoomLevel: 1}}
              const gitHubPullRequests = useGitHubPullRequests({active: view === 'git' && gitPaneView === 'pull-requests', cwd})
              window.prState = gitHubPullRequests
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
              if (editable) return <div style={{height:600,width:900,padding:20}}>
                <EditableUnifiedDiff ariaLabel="Review focus regression" baselineContents="before\\nsecond\\n" contents="after\\nsecond\\n" fileDiff={{path:'selection.txt',displayPath:'selection.txt',kind:'edit',diff:'--- a/selection.txt\\n+++ b/selection.txt\\n@@ -1,2 +1,2 @@\\n-before\\n+after\\n second\\n'}}
                  onChange={()=>{}} onSave={()=>{}} onToggleWordWrap={()=>{}} wordWrap={false}
                  onCommentSelectionChange={open=>{window.editorCommentAction=open}} onAddComment={(comment,location)=>{window.selectedComment={comment,location}}}/>
              </div>
              if (review) return <div className="chat" style={{display:'block',padding:20}}><div style={{position:'relative',width:650,height:'calc(100vh - 40px)'}}>
                <GitHubPullRequestDetail key={review.number} state={{selected:review,result:review,loading:false,error:null,cwd:'/project',reviewDraft,setReviewDraft,reviewCommit,openCommit:setReviewCommit,closeCommit:()=>setReviewCommit(null),refresh:()=>{window.reviewRefreshes=(window.reviewRefreshes??0)+1},refreshDiscussion:()=>{window.reviewRefreshes=(window.reviewRefreshes??0)+1}}} browserEnabled={true} onOpenBrowser={()=>{}} onOpenExternal={async()=>{}} />
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
            createRoot(document.getElementById('root')).render(<>
              <MessageSelectionQuoteButton containerRef={{current:document.getElementById('root')}} onQuote={()=>{}} />
              <Fixture />
            </>)
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
                  : worker.includes('editor.worker')
                    ? `export default class extends Worker {constructor(){super('./editor-worker.js')}}`
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
          window.prFileRequests=[];window.reviewSubmissions=[];window.prActions=[];window.commitRequests=[];
          window.management={headSha:'a'.repeat(40),mergeMethods:['merge','squash','rebase'],defaultMergeMethod:'squash',canMerge:true,canClose:true,checks:'success',checkCount:1};
          window.commitChanges={commitId:'b'.repeat(40),files:[]};
          window.prChanges={commitId:'a'.repeat(40),files:[]};
          window.appApi={
            getGitHubPullRequestManagement: async options=>{window.managementReads=(window.managementReads??0)+1;return {...window.management}},
            getGitHubPullRequestCommitChanges: async options=>{window.commitRequests.push(options);return window.commitChanges},
            performGitHubPullRequestAction:async options=>{window.prActions.push(options);if(window.failAction===options.action)throw new Error(options.action+' action failed')},
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
      await fs.mkdir(path.resolve('test-results/github-pull-requests'), { recursive: true })
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
          `(()=>{const button=Array.from(document.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === ${JSON.stringify(label)} || button.textContent === ${JSON.stringify(label)});if(!button)throw new Error('Missing button: '+${JSON.stringify(label)});button.click()})()`
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
      await run(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
      await run('window.previousPrState = window.prState; window.bumpUnrelatedWorkspace()')
      await wait('window.unrelatedRevision === 1')
      assert.equal(
        await run('window.prState === window.previousPrState'),
        true,
        'unrelated workspace updates must preserve the hidden PR state and callbacks'
      )
      await run(
        'window.rendersBeforeScope=window.prFixtureRenders;window.selectProject("/inactive-project")'
      )
      await wait('window.prState.detail.cwd === "/inactive-project"')
      await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      assert.equal(
        await run('window.prFixtureRenders-window.rendersBeforeScope'),
        1,
        'changing an inactive PR scope must not reset caches and render the workspace again'
      )
      await run('window.selectProject("/project")')
      await wait('window.prState.detail.cwd === "/project"')
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
      assert.equal(
        await run(`document.querySelector('[aria-label="Pull request status"]')===null`),
        true,
        'open PRs must not show an Opened by row'
      )
      assert.ok(
        await run(`(()=>{
        const back=document.querySelector('[aria-label="Back to pull requests"]').getBoundingClientRect();
        const refs=document.querySelector('[aria-label="Pull request changes"]').getBoundingClientRect();
        return Math.abs(back.left-refs.left)<=2;
      })()`),
        'the complete back button must align with the left edge of the details'
      )
      const backButtonPoint = await run(`(()=>{
        const rect=document.querySelector('[aria-label="Back to pull requests"]').getBoundingClientRect();
        return {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)};
      })()`)
      window.webContents.sendInputEvent({ type: 'mouseMove', ...backButtonPoint })
      await capture('pr-back-button-hover.png')
      assert.ok(
        await run(`['assistant','user'].every(role=>{
        const row=document.querySelector('${conversation} .chat-detail__message-block--'+role);
        const label=row.querySelector('.chat-detail__pending-message-label');
        const range=document.createRange();range.selectNodeContents(label);const text=range.getBoundingClientRect();
        const bubble=row.querySelector('.chat-detail__message').getBoundingClientRect();
        return role==='assistant'?text.left-bubble.left>=12:bubble.right-text.right>=12;
      })`),
        'sender names must be inset to match their bubble rounding'
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
      await ready(4)
      await contains(42)
      assert.equal(
        await run('window.requests.length'),
        beforeReturnProject,
        'returning to a fresh project/filter cache must not refetch its pages'
      )
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
      // Post with the real detail hook, retaining the existing discussion, form and file tree.
      const beforePostingProject = await run('window.requests.length')
      await run(`window.selectProject('/posting-project')`)
      await click('Pull requests')
      await reply(await request(1, beforePostingProject), page(707, 1, 1, 1))
      await ready(1)
      await contains(707)
      const postingDetailIndex = await run('window.detailRequests.length')
      await click('View pull request #707: Fixture 707: keep project navigation responsive')
      await wait(`window.detailRequests.length===${postingDetailIndex + 1}`)
      const postingDetail = {
        ...detail,
        number: 707,
        title: 'Keep the current PR mounted',
        activity: Array.from({ length: 20 }, (_, index) => ({
          id: 'existing:' + index,
          kind: 'comment',
          state: null,
          author: 'reviewer',
          body: 'Existing discussion message ' + index,
          createdAt: detail.createdAt
        }))
      }
      await run(
        `window.detailRequests[${postingDetailIndex}].resolve(${JSON.stringify(postingDetail)})`
      )
      await wait(
        `document.querySelector('[aria-label="Pull request #707 details"] [aria-label="Comment"]')`
      )
      await run(
        `window.postNodes={discussion:document.querySelector('[aria-label="Pull request conversation"]'),form:document.querySelector('[aria-label="Pull request comment"]'),tree:document.querySelector('[aria-label="Pull request changed files"]')};window.postNodes.discussion.scrollTop=50;window.postScroll=window.postNodes.discussion.scrollTop;window.postFileReads=window.prFileRequests.length`
      )
      await run(`document.querySelector('[aria-label="Comment"]').focus()`)
      await window.webContents.insertText('Append this comment without remounting')
      await click('Comment')
      await wait(`window.detailRequests.length===${postingDetailIndex + 2}`)
      assert.equal(
        await run(
          `window.postNodes.discussion===document.querySelector('[aria-label="Pull request conversation"]') && window.postNodes.form===document.querySelector('[aria-label="Pull request comment"]') && window.postNodes.tree===document.querySelector('[aria-label="Pull request changed files"]')`
        ),
        true
      )
      assert.equal(await run('window.prFileRequests.length===window.postFileReads'), true)
      const appended = {
        ...postingDetail,
        activity: [
          ...postingDetail.activity,
          {
            id: 'appended',
            kind: 'comment',
            state: null,
            author: 'kitkat',
            body: 'Append this comment without remounting',
            createdAt: new Date().toISOString()
          }
        ]
      }
      await run(
        `window.detailRequests[${postingDetailIndex + 1}].resolve(${JSON.stringify(appended)})`
      )
      await wait(
        `document.querySelector('[data-chat-message-id="github:example/sele:707:appended"]')`
      )
      assert.equal(
        await run(
          `window.postNodes.discussion===document.querySelector('[aria-label="Pull request conversation"]') && window.postNodes.form===document.querySelector('[aria-label="Pull request comment"]') && window.postNodes.tree===document.querySelector('[aria-label="Pull request changed files"]')`
        ),
        true
      )
      assert.equal(
        await run('window.postNodes.discussion.scrollTop'),
        await run('window.postScroll')
      )
      assert.equal(await run('window.prFileRequests.length===window.postFileReads'), true)
      // Returning after a write revalidates in place, retaining cached rows and the virtualizer.
      const afterPostRequests = await run('window.requests.length')
      await run(`window.cachedList=document.querySelector('[data-virtuoso-scroller]')`)
      await click('Back to pull requests')
      const afterPostReload = await request(1, afterPostRequests)
      assert.equal(
        await run(`window.cachedList===document.querySelector('[data-virtuoso-scroller]')`),
        true
      )
      await contains(707)
      await reply(afterPostReload, page(707, 1, 1, 1))
      await ready(1)
      // Test merging with the default open/draft filters, including a slow list response.
      await click('Pull request states')
      await wait(`document.querySelector('[role="listbox"]')`)
      const beforeOpenFilters = await run('window.requests.length')
      await selectState('Merged')
      await request(1, beforeOpenFilters)
      const beforeOpenOnly = await run('window.requests.length')
      await selectState('Closed')
      await reply(await request(1, beforeOpenOnly), page(707, 1, 1, 1))
      await ready(1)
      await click('Pull request states')
      await contains(707)
      await run(`window.cachedList=document.querySelector('[data-virtuoso-scroller]')`)
      const mergeDetailIndex = await run('window.detailRequests.length')
      await click('View pull request #707: Fixture 707: keep project navigation responsive')
      await wait(`window.detailRequests.length===${mergeDetailIndex + 1}`)
      await run(`window.detailRequests[${mergeDetailIndex}].resolve(${JSON.stringify(appended)})`)
      await wait(
        `!Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Squash and merge')?.disabled`
      )
      const beforeMergeBack = await run('window.requests.length')
      await click('Squash and merge')
      await wait(`window.detailRequests.length===${mergeDetailIndex + 2}`)
      assert.equal(
        await run('window.requests.length'),
        beforeMergeBack,
        'list fetching pauses while viewing details'
      )
      await click('Back to pull requests')
      const mergedReload = await request(1, beforeMergeBack)
      assert.equal(
        await run(`document.querySelector('[data-virtuoso-scroller]')===window.cachedList`),
        true
      )
      await contains(707)
      await reply(mergedReload, {
        repository: 'example/sele',
        pullRequests: [],
        totalCount: 0,
        page: 1,
        pageCount: 1
      })
      await wait(`document.body.textContent.includes('No pull requests match your search')`)
      assert.equal(
        await run(`document.querySelector('[aria-label^="View pull request #707:"]')===null`),
        true
      )
      await run(
        `window.detailRequests[${mergeDetailIndex + 1}].resolve(${JSON.stringify({ ...appended, state: 'merged' })})`
      )
      assert.equal(
        await run(`document.querySelector('[aria-label="Back to pull requests"]')===null`),
        true
      )
      // Switching filters retrieves the merged state; a refresh failure keeps those cached rows.
      await click('Pull request states')
      await wait(`document.querySelector('[role="listbox"]')`)
      const beforeMergedFilter = await run('window.requests.length')
      await selectState('Merged')
      const mergedPage = page(707, 1, 1, 1)
      mergedPage.pullRequests[0].state = 'merged'
      await reply(await request(1, beforeMergedFilter), mergedPage)
      await ready(1)
      await click('Pull request states')
      await contains(707)
      assert.ok(
        await run(
          `document.querySelector('[aria-label^="View pull request #707:"]').title.endsWith('Merged')`
        )
      )
      const beforeCachedFilter = await run('window.requests.length')
      await click('Pull request states')
      await wait(`document.querySelector('[role="listbox"]')`)
      await selectState('Closed')
      const cachedFilterReload = await request(1, beforeCachedFilter)
      assert.equal(
        await run('window.prSnapshot.loading'),
        false,
        'an invalidated filter cache remains visible while revalidating'
      )
      await reply(cachedFilterReload, mergedPage)
      await ready(1)
      await click('Pull request states')
      await contains(707)
      assert.ok(
        await run(
          `document.querySelector('[aria-label^="View pull request #707:"]').title.endsWith('Merged')`
        )
      )
      const beforeCachedFailure = await run('window.requests.length')
      await run(`window.mergedList=document.querySelector('[data-virtuoso-scroller]')`)
      await click('Refresh pull requests')
      const cachedFailure = await request(1, beforeCachedFailure)
      await contains(707)
      await run(`window.requests[${cachedFailure}].reject(new Error('Offline refresh'))`)
      await wait(
        `document.querySelector('[role="alert"]')?.textContent.includes('Offline refresh')`
      )
      assert.equal(
        await run(`document.querySelector('[data-virtuoso-scroller]')===window.mergedList`),
        true
      )
      await contains(707)
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
          `Array.from(document.querySelectorAll('[data-comparison="pr"] .chat-detail__context-compaction')).some(event=>event.querySelector('button')?.getAttribute('aria-label')?.includes('Review commit 7533709'))`
        )
      )
      assert.equal(
        await run(
          `(()=>{const root=document.querySelector('[data-comparison="pr"]');const pane=root.querySelector('.chat-panel');const content=root.querySelector('.chat-detail__messages-layout');return pane.clientHeight<=content.getBoundingClientRect().height+2})()`
        ),
        true,
        'short discussions must fit their contents'
      )
      assert.ok(
        await run(
          `document.querySelector('[data-comparison="pr"] [aria-label="Pull request status"]')===null`
        )
      )
      await capture('pr-agent-comparison.png')
      await run(
        `window.showComparison(${JSON.stringify({ ...comparison, state: 'closed', mergedAt: null })})`
      )
      await wait(
        `!document.querySelector('[data-comparison="pr"] [aria-label="Pull request status"]')`
      )

      const reviewDiscussion = {
        ...comparison,
        activity: [
          {
            id: 'review:1',
            kind: 'review',
            state: 'CHANGES_REQUESTED',
            author: 'reviewer',
            body: 'Please adjust this case',
            createdAt: comparison.createdAt
          },
          {
            id: 'inline:1',
            kind: 'comment',
            state: null,
            author: 'reviewer',
            body: 'Handle the missing session',
            createdAt: comparison.createdAt,
            reviewComment: {
              path: 'src/main/container.ts',
              line: 14,
              startLine: 12,
              side: 'new',
              outdated: false,
              url: comparison.url + '#discussion_r1'
            }
          },
          {
            id: 'review:2',
            kind: 'review',
            state: 'COMMENTED',
            author: 'ExposedCat',
            body: '',
            createdAt: comparison.createdAt
          },
          {
            id: 'inline:2',
            kind: 'comment',
            state: null,
            author: 'ExposedCat',
            body: 'Fixed in the next commit',
            createdAt: comparison.createdAt,
            reviewComment: {
              path: 'src/main/container.ts',
              line: 8,
              startLine: null,
              side: 'old',
              outdated: true,
              url: comparison.url + '#discussion_r2'
            }
          }
        ]
      }
      await run(`window.showComparison(${JSON.stringify(reviewDiscussion)})`)
      await wait(
        `document.querySelector('[data-pr-event="CHANGES_REQUESTED"]')?.textContent.includes('Requested changes by reviewer')`
      )
      await wait(
        `document.querySelector('[data-comparison="pr"] .chat-detail__message--user')?.textContent.includes('Fixed in the next commit')`
      )
      assert.ok(
        await run(
          `Array.from(document.querySelectorAll('[data-comparison="pr"] .chat-detail__message--assistant')).some(message=>message.textContent.includes('Handle the missing session') && message.textContent.includes('src/main/container.ts:12–14'))`
        )
      )
      assert.ok(
        await run(
          `document.querySelector('[data-comparison="pr"] .chat-detail__message--user').textContent.includes('src/main/container.ts:8 (outdated)')`
        )
      )
      assert.equal(
        await run(
          `document.querySelectorAll('[data-comparison="pr"] [data-pr-event="COMMENTED"]').length`
        ),
        1
      )
      assert.equal(
        await run(
          `document.querySelectorAll('[data-comparison="pr"] [data-chat-message-id]').length`
        ),
        4
      )
      await capture('review-discussion.png')

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
        const composer = files.querySelector('[aria-label="Pull request comment"]');
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
        const selectionTarget = await run(`(() => {
          const cells=[...document.querySelectorAll('[role="dialog"] .diff-code[data-change-key]')];
          const cell=cells.find(cell=>cell.dataset.changeKey.startsWith(${JSON.stringify(side === 'old' ? 'D' : 'I')})) ?? cells[0];
          const walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT);const nodes=[];
          while(walker.nextNode())if(walker.currentNode.textContent.trim())nodes.push(walker.currentNode);
          const node=nodes.sort((a,b)=>b.textContent.length-a.textContent.length)[0];
          const range=document.createRange();range.selectNodeContents(node);const rect=range.getBoundingClientRect();
          return {key:cell.dataset.changeKey,start:{x:Math.ceil(rect.left+1),y:Math.round(rect.top+rect.height/2)},end:{x:Math.floor(rect.right-1),y:Math.round(rect.top+rect.height/2)}};
        })()`)
        const expected = selectionTarget.key
        window.webContents.sendInputEvent({ type: 'mouseMove', ...selectionTarget.start })
        window.webContents.sendInputEvent({
          type: 'mouseDown',
          ...selectionTarget.start,
          button: 'left',
          clickCount: 1
        })
        window.webContents.sendInputEvent({ type: 'mouseMove', ...selectionTarget.end })
        window.webContents.sendInputEvent({
          type: 'mouseUp',
          ...selectionTarget.end,
          button: 'left',
          clickCount: 1
        })
        await wait(`!document.querySelector('[aria-label="Comment on selection"]').disabled`)
        const point = await run(
          `(()=>{const rect=document.querySelector('[aria-label="Comment on selection"]').getBoundingClientRect();return {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)}})()`
        )
        window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
        window.webContents.sendInputEvent({
          type: 'mouseDown',
          ...point,
          button: 'left',
          clickCount: 1
        })
        // Let document-level selection handlers run before a real user's mouse-up.
        await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
        assert.equal(
          await run(`document.querySelector('[aria-label="Comment on selection"]').disabled`),
          false,
          'pressing Comment must preserve the selected code until activation'
        )
        window.webContents.sendInputEvent({
          type: 'mouseUp',
          ...point,
          button: 'left',
          clickCount: 1
        })
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
      await window.webContents.insertText('PR #6 comment')
      await wait(`document.querySelector('[aria-label="Comment"]').value==='PR #6 comment'`)
      await capture('pr-6-review-draft.png')
      await run('window.failReview=true')
      await click('Comment')
      await wait(
        `document.querySelector('[aria-label="Pull request files"]').textContent.includes('Review submission failed')`
      )
      assert.equal(await run('window.reviewDraft.comments.length'), 2)
      assert.equal(await run('window.reviewDraft.body'), 'PR #6 comment')
      await run('window.failReview=false')
      await click('Comment')
      await wait(`window.reviewDraft.body==='' && (window.reviewRefreshes??0)>0`)
      const submitted = await run('window.reviewSubmissions.at(-1)')
      assert.equal(submitted.number, reviewDetail.number)
      assert.equal(submitted.repository, reviewDetail.repository)
      assert.equal(submitted.commitId, reviewChanges.commitId)
      assert.equal(submitted.body, 'PR #6 comment')
      assert.equal(submitted.comments.length, 2)
      assert.deepEqual(
        submitted.comments.map((comment) => comment.path),
        textFiles.slice(0, 2).map((file) => file.path)
      )
      assert.equal(await run('window.reviewDraft.comments.length'), 0)
      assert.equal(await run('window.reviewDraft.body'), '')
      await capture('pr-6-review-posted.png')
      // A regular comment is posted as an issue comment; choosing a merge method only selects it.
      const actionDetail = {
        ...reviewDetail,
        number: 808,
        state: 'open',
        isDraft: false,
        activity: [
          {
            id: 'commit-popup',
            kind: 'event',
            state: 'committed',
            commitSha: 'b'.repeat(40),
            author: 'contributor',
            body: 'A long commit title that can use the available width without a fixed narrow label cap',
            createdAt: reviewDetail.createdAt
          }
        ]
      }
      await run(`window.showReview(${JSON.stringify(actionDetail)})`)
      await wait(
        `document.querySelector('[aria-label="CI status"]').textContent.includes('All checks passed · 1 check')`
      )
      await wait(
        `document.querySelector('[aria-label="Merge pull request"]').textContent.includes('Squash and merge')`
      )
      assert.equal(
        await run(
          `document.querySelector('[aria-label="Merge pull request"]').classList.contains('ui-button--normal')`
        ),
        true
      )
      assert.equal(
        await run(
          `document.querySelector('[aria-label="Comment"]').closest('form').querySelector('button:last-child').classList.contains('ui-button--normal')`
        ),
        true
      )
      const beforeMethodSelection = await run('window.prActions.length')
      await click('Merge options')
      await wait(`document.querySelector('[role="menuitemradio"]')`)
      assert.equal(
        await run(
          `document.querySelectorAll('.message-box__chat-config-option--has-description').length`
        ),
        3
      )
      assert.ok(
        await run(
          `Array.from(document.querySelectorAll('.message-box__chat-config-option-label')).every(row=>Number(getComputedStyle(row).fontWeight)<600)`
        )
      )
      assert.ok(
        await run(`Array.from(document.querySelectorAll('[role="menuitemradio"]')).every(row=>{
        const label=row.querySelector('.message-box__chat-config-option-label');const description=row.querySelector('.message-box__chat-config-option-description');
        return getComputedStyle(row).display==='grid' && description.getBoundingClientRect().top>=label.getBoundingClientRect().bottom-1;
      })`),
        'merge rows must use the model picker layout with descriptions below their labels'
      )
      await capture('merge-options.png')
      await run(
        `Array.from(document.querySelectorAll('[role="menuitemradio"]')).find(row=>row.textContent.includes('Rebase and merge')).click()`
      )
      await wait(
        `document.querySelector('[aria-label="Merge pull request"]').textContent.includes('Rebase and merge')`
      )
      assert.equal(
        await run('window.prActions.length'),
        beforeMethodSelection,
        'selecting a merge method must not merge'
      )
      assert.ok(
        await run(
          `(()=>{const group=document.querySelector('[aria-label="Merge pull request"]').closest('.ui-button-group');const green=getComputedStyle(document.querySelector('[aria-label="CI status"] > svg')).color;return Array.from(group.querySelectorAll('.ui-button__icon svg')).every(icon=>getComputedStyle(icon).color===green)})()`
        ),
        'merge and dropdown icons must be green'
      )
      const beforeMerge = await run('window.prActions.length')
      await click('Merge pull request')
      await wait(`window.prActions.length===${beforeMerge + 1}`)
      assert.deepEqual((await run('window.prActions.at(-1)')).method, 'rebase')
      assert.deepEqual((await run('window.prActions.at(-1)')).headSha, 'a'.repeat(40))
      await run(`document.querySelector('[aria-label="Comment"]').focus()`)
      await window.webContents.insertText('A normal discussion comment')
      await wait(
        `Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Close PR with comment')`
      )
      const beforeComment = await run('window.prActions.length')
      const beforeReviews = await run('window.reviewSubmissions.length')
      await click('Comment')
      await wait(`window.prActions.length===${beforeComment + 1} && window.reviewDraft.body===''`)
      assert.equal((await run('window.prActions.at(-1)')).action, 'comment')
      assert.equal(await run('window.reviewSubmissions.length'), beforeReviews)
      await run(`document.querySelector('[aria-label="Comment"]').focus()`)
      await window.webContents.insertText('Closing with an explanation')
      await run(`window.failAction='close'`)
      const beforeClose = await run('window.prActions.length')
      await click('Close PR with comment')
      await wait(
        `document.querySelector('[aria-label="Pull request files"]').textContent.includes('close action failed')`
      )
      assert.deepEqual(
        (await run(`window.prActions.slice(${beforeClose})`)).map((item) => item.action),
        ['comment', 'close']
      )
      assert.equal(await run('window.reviewDraft.body'), '')
      await run('window.failAction=null')
      await click('Close PR')
      await wait(`window.prActions.length===${beforeClose + 3}`)
      assert.equal((await run('window.prActions.at(-1)')).action, 'close')
      // The commit popup has only that commit's files. It never replaces the PR's final tree.
      const commitFile = { ...reviewChanges.files[0], path: 'commit-only.ts', previousPath: null }
      await run(
        `window.commitChanges=${JSON.stringify({ commitId: 'b'.repeat(40), files: [commitFile] })}`
      )
      const bottomBefore = await run(
        `document.querySelector('[aria-label="Pull request changed files"]').textContent`
      )
      const commitButtonLabel =
        'Review commit ' + 'b'.repeat(7) + ': ' + actionDetail.activity[0].body
      const commitWidth = await run(
        `Array.from(document.querySelectorAll('button')).find(button=>button.getAttribute('aria-label')===${JSON.stringify(commitButtonLabel)}).getBoundingClientRect().width`
      )
      assert.ok(commitWidth > 400, 'long commit title should use the available width')
      await click(commitButtonLabel)
      await wait(`document.querySelector('[role="dialog"] .diff-code')`)
      assert.equal(await run('window.commitRequests.at(-1).commitSha'), 'b'.repeat(40))
      assert.equal(
        await run(
          `document.querySelector('[aria-label="Pull request changed files"]').textContent`
        ),
        bottomBefore
      )
      assert.ok(
        await run(
          `document.querySelector('[role="dialog"]').textContent.includes('commit-only.ts')`
        )
      )
      assert.ok(
        !(await run(`document.querySelector('[role="dialog"]').textContent`)).includes(
          reviewChanges.files[1].path.split('/').at(-1)
        )
      )
      await capture('commit-popup.png')
      await click('Close file editor')
      await click('Open ' + reviewChanges.files[1].path)
      await wait(`document.querySelector('[role="dialog"] .diff-code')`)
      assert.ok(
        !(await run(`document.querySelector('[role="dialog"]').textContent`)).includes(
          'commit-only.ts'
        )
      )
      await click('Close file editor')
      // Reload CI in-place without changing the draft or the discussion.
      await run(`window.commitChanges={commitId:'b'.repeat(40),files:[]}`)
      await click(commitButtonLabel)
      await wait(`document.querySelector('dialog[aria-label="Commit changes"][open]')`)
      assert.ok(
        await run(
          `document.querySelector('dialog[aria-label="Commit changes"]').textContent.includes('No files changed')`
        )
      )
      await click('Close')
      assert.equal(
        await run(
          `document.querySelector('[aria-label="Pull request changed files"]').textContent`
        ),
        bottomBefore
      )
      await run(
        `window.management.checks='pending';document.querySelector('[aria-label="Comment"]').focus()`
      )
      await window.webContents.insertText('Keep my pending comment')
      const lastReads = await run('window.managementReads')
      await run(`window.dispatchEvent(new Event('focus'))`)
      await wait(
        `window.managementReads>${lastReads} && document.querySelector('[aria-label="CI status"]').textContent.includes('Checks in progress')`
      )
      assert.equal(await run('window.reviewDraft.body'), 'Keep my pending comment')
      await capture('pr-actions.png')
      await run(`window.management.checks='failure';window.dispatchEvent(new Event('focus'))`)
      await wait(
        `document.querySelector('[aria-label="CI status"][data-status="failure"]')?.textContent.includes('Checks failed')`
      )
      assert.equal(await run('window.reviewDraft.body'), 'Keep my pending comment')
      // Exercise Comment after selecting text near the right/bottom edge of a large scrolled diff.
      const longLine = 'wide_selected_line_' + 'x'.repeat(180)
      const wideDiff =
        '--- a/wide.txt\n+++ b/wide.txt\n@@ -1,120 +1,120 @@\n' +
        Array.from({ length: 120 }, (_, i) => '-old_' + i + '_' + longLine).join('\n') +
        '\n' +
        Array.from({ length: 120 }, (_, i) => '+new_' + i + '_' + longLine).join('\n') +
        '\n'
      await run(
        `window.prChanges=${JSON.stringify({ commitId: 'a'.repeat(40), files: [{ path: 'wide.txt', kind: 'edit', previousPath: null, diff: wideDiff }] })};window.showReview(${JSON.stringify({ ...actionDetail, number: 809, activity: [] })})`
      )
      await wait(`document.querySelector('[aria-label="Open wide.txt"]')`)
      assert.equal(
        await run(
          `document.querySelector('[aria-label="Pull request files"]').textContent.includes('Files changed')`
        ),
        false
      )
      assert.equal(
        await run(`document.querySelector('[aria-label="Refresh pull request files"]')===null`),
        true
      )
      await click('Open wide.txt')
      await wait(`document.querySelector('[role="dialog"] .diff-code[data-change-key="I110"]')`)
      await run(
        `(()=>{const cell=document.querySelector('[role="dialog"] .diff-code[data-change-key="I110"]');cell.scrollIntoView({block:'end',inline:'end'})})()`
      )
      await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
      await run(`(()=>{
        const cell=document.querySelector('[role="dialog"] .diff-code[data-change-key="I110"]');const walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT);const texts=[];
        while(walker.nextNode())if(walker.currentNode.textContent.trim())texts.push(walker.currentNode);
        const node=texts.sort((a,b)=>b.textContent.length-a.textContent.length)[0];const range=document.createRange();range.setStart(node,Math.max(0,node.textContent.length-12));range.setEnd(node,node.textContent.length);
        const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
        const scroller=document.querySelector('.file-editor-dialog__diff-scroll');const viewport=scroller.getBoundingClientRect();
        scroller.scrollLeft+=range.getBoundingClientRect().right-viewport.right+32;
        document.dispatchEvent(new Event('selectionchange'));
        window.beforeCommentScroll={left:scroller.scrollLeft,top:scroller.scrollTop};
      })()`)
      await wait(`!document.querySelector('[aria-label="Comment on selection"]').disabled`)
      const widePoint = await run(
        `(()=>{const r=document.querySelector('[aria-label="Comment on selection"]').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`
      )
      window.webContents.sendInputEvent({
        type: 'mouseDown',
        ...widePoint,
        button: 'left',
        clickCount: 1
      })
      window.webContents.sendInputEvent({
        type: 'mouseUp',
        ...widePoint,
        button: 'left',
        clickCount: 1
      })
      await wait(`document.querySelector('.unified-diff__review-form input')`)
      await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
      assert.ok(
        await run(
          `(()=>{const input=document.querySelector('.unified-diff__review-form').getBoundingClientRect();const viewport=document.querySelector('.file-editor-dialog__diff-scroll').getBoundingClientRect();return input.left>=viewport.left && input.right<=viewport.right && input.top>=viewport.top && input.bottom<=viewport.bottom})()`
        ),
        'comment editor must be visible within the scrolled diff'
      )
      assert.equal(
        await run(
          `Math.abs(document.querySelector('.file-editor-dialog__diff-scroll').scrollLeft-window.beforeCommentScroll.left)<=1`
        ),
        true,
        'opening Comment must not pan away from the selection'
      )
      await capture('wide-diff-comment.png')
      const commentsBeforeWide = await run('window.reviewDraft.comments.length')
      await window.webContents.insertText('Comment on scrolled line')
      await click('Add comment')
      await wait(`window.reviewDraft.comments.length===${commentsBeforeWide + 1}`)
      assert.deepEqual(await run('window.reviewDraft.comments.at(-1)'), {
        id: (await run('window.reviewDraft.comments.at(-1)')).id,
        path: 'wide.txt',
        line: 110,
        endLine: 110,
        side: 'new',
        comment: 'Comment on scrolled line'
      })
      await click('Close file editor')
      // An editor selection captured for Comment must survive focus/selection changes before activation.
      await run('window.showEditable()')
      await wait(`document.querySelector('.monaco-editor')`)
      await run(
        `(()=>{const editor=window.monaco.editor.getEditors().find(editor=>editor.getModel()?.uri.path.endsWith('/modified/selection.txt'));editor.setSelection(new window.monaco.Selection(1,1,1,5));window.capturedCommentAction=window.editorCommentAction;editor.setSelection(new window.monaco.Selection(1,1,1,1));window.capturedCommentAction()})()`
      )
      await wait(`document.querySelector('.unified-diff__review-form input')`)
      await run(`document.querySelector('.unified-diff__review-form input').focus()`)
      await window.webContents.insertText('Keep the originally selected range')
      await click('Add comment')
      await wait('window.selectedComment')
      assert.deepEqual(await run('window.selectedComment.location'), {
        line: 1,
        endLine: 1,
        side: 'new'
      })
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
