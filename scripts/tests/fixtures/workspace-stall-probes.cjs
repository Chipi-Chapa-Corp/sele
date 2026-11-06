const assert = require('node:assert/strict')

exports.source = `
import {useUncommittedPatchFilter} from './src/renderer/src/workspace/useUncommittedPatchFilter';
import {ActionMenu} from './src/renderer/src/components/ActionMenu';
const idleHost=document.createElement('div');idleHost.style.cssText='position:fixed;top:20px;left:20px';document.body.append(idleHost);
const idleRoot=createRoot(idleHost);
window.patchWrites=0;window.patchRequests=[];window.menuBuilds=0;window.menuActions=[];
window.appApi.getUncommittedGitPatchChanges=options=>new Promise(resolve=>patchRequests.push({options,resolve}));
function PatchProbe({items,source,cwd,refresh}) {
  const [filter,setFilter]=useState(null),[state,setState]=useState('ready');
  const [error,setError]=useState(null),[dismissed,setDismissed]=useState(false);
  window.patchState={filter,state,error,dismissed};
  const track=setter=>value=>{window.patchWrites++;setter(value)};
  useUncommittedPatchFilter({changeSource:source,changesContainer:null,changesContainerKey:'host',
    changesCwd:cwd,items,gitChangeLoadRequest:refresh,
    setUncommittedPatchFilter:track(setFilter),setUncommittedPatchFilterState:track(setState),
    setUncommittedPatchFilterError:track(setError),setGitChangeLoadErrorDismissed:track(setDismissed)});
  return null;
}
window.renderPatch=(text,source='uncommitted',diff='',cwd='/a',refresh=0)=>flushSync(()=>idleRoot.render(
  <PatchProbe source={source} cwd={cwd} refresh={refresh} items={[
    {id:'text',type:'message',role:'assistant',content:text},
    ...(diff?[{id:'work',type:'working',items:[{type:'tool',diffs:[{path:'file.ts',kind:'edit',diff}]}]}]:[])
  ]}/>));
window.finishPatch=index=>{const request=patchRequests[index];request.resolve({patches:request.options.patches})};
window.menuTrigger=()=>document.querySelector('button[aria-label="Probe actions"]');
window.renderMenu=version=>flushSync(()=>idleRoot.render(<>
  <input id="menu-focus-probe"/>
  <ActionMenu label="Probe actions" content="Menu" actions={()=>{
    window.menuBuilds++;return [{id:'action',label:'Record version',callback:()=>menuActions.push(version)}]
  }}/>
</>));
window.disposeIdleProbe=()=>{idleRoot.unmount();idleHost.remove()};
`

exports.verify = async (run) => {
  const settle = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  await run('renderPatch("Initial")')
  await settle()
  const writes = await run('patchWrites')
  for (let i = 0; i < 5; i++) await run(`renderPatch("Text ${i}")`)
  await settle()
  assert.equal(await run('patchWrites'), writes, 'inactive Git filtering must not reset on streamed text')
  assert.equal(await run('patchRequests.length'), 0)
  await run('renderPatch("Initial","chat")')
  await settle()
  const emptyWrites = await run('patchWrites')
  await run('renderPatch("More text","chat")')
  await settle()
  assert.equal(await run('patchWrites'), emptyWrites, 'an unchanged empty patch set stays settled')
  await run('renderPatch("Initial","chat","patch one")')
  await settle()
  assert.equal(await run('patchRequests.length'), 1)
  const pendingWrites = await run('patchWrites')
  await run('renderPatch("More text","chat","patch one")')
  await settle()
  assert.equal(await run('patchRequests.length'), 1, 'text updates reuse a pending patch request')
  assert.equal(await run('patchWrites'), pendingWrites)
  await run('finishPatch(0)')
  await settle()
  assert.equal(await run('patchState.state'), 'ready')
  await run('renderPatch("Changed","chat","patch two")')
  await settle()
  await run('renderPatch("Other cwd","chat","patch two","/b")')
  await settle()
  assert.equal(await run('patchRequests.length'), 3)
  await run('finishPatch(1)')
  await settle()
  assert.equal(await run('patchState.filter.scope.cwd'), '/a', 'late results cannot publish into another scope')
  await run('finishPatch(2)')
  await settle()
  assert.equal(await run('patchState.filter.scope.cwd'), '/b')
  await run('renderPatch("Refresh","chat","patch two","/b",1)')
  await settle()
  assert.equal(await run('patchRequests.length'), 4, 'manual refresh still checks Git')
  await run('finishPatch(3)')
  await settle()

  await run('renderMenu(1)')
  await settle()
  assert.equal(await run('menuBuilds'), 0, 'closed row menus do not build actions')
  await run('document.getElementById("menu-focus-probe").focus({preventScroll:true});menuTrigger().click()')
  await settle()
  assert.equal(await run('menuTrigger().getAttribute("aria-expanded")'), 'true')
  assert.equal(await run('document.activeElement.id'), 'menu-focus-probe', 'pointer activation preserves composer focus')
  await run('renderMenu(2)')
  await run('document.querySelector(".ui-dropdown__action").click()')
  assert.deepEqual(await run('menuActions'), [2], 'opened menus use current callbacks')
  await run('menuTrigger().dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))')
  await settle()
  await run('menuTrigger().dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true}))')
  assert.equal(await run('document.activeElement.className'), 'ui-dropdown__action')
  await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))')
  await settle()
  assert.equal(await run('document.activeElement.getAttribute("aria-label")'), 'Probe actions')
  assert.equal(await run('document.activeElement.getAttribute("aria-expanded")'), 'false')
  await run('disposeIdleProbe()')
}
