const assert = require('node:assert/strict')

exports.source = `
import {ActionMenu} from './src/renderer/src/components/ActionMenu';
const idleHost=document.createElement('div');idleHost.style.cssText='position:fixed;top:20px;left:20px';document.body.append(idleHost);
const idleRoot=createRoot(idleHost);
window.menuBuilds=0;window.menuActions=[];
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
