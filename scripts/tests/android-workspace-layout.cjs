const assert=require('node:assert/strict')
const path=require('node:path')
module.exports=async(ui,output)=>{
 const {run,tap,waitFor,delay,adb}=ui
 await ui.navigate('Workspace')
 await tap('.changes-sidebar [aria-label="Sidebar view"] button[aria-label="Git"]')
 await waitFor('Boolean(document.querySelector(".mobile-git-actions .changes-sidebar__sync-label"))')
 const measure=()=>run(`(()=>{
  const bounds=e=>e.getBoundingClientRect().toJSON();
  const title=document.querySelector('.mobile-conversation-header__title'),range=document.createRange();range.selectNodeContents(title);
  return {width:innerWidth,sidebar:bounds(document.querySelector('.changes-sidebar')),header:bounds(document.querySelector('.changes-sidebar__header')),body:bounds(document.querySelector('.changes-sidebar__body')),footer:bounds(document.querySelector('.mobile-git-actions')),title:bounds(range),controls:[...document.querySelectorAll('.changes-sidebar__view-toggle,.mobile-git-actions>.ui-button,.mobile-git-actions>.ui-button-group')].map(bounds),labels:[...document.querySelectorAll('.mobile-git-actions .ui-button__label,.mobile-git-actions .changes-sidebar__sync-label-segment')].map(e=>({text:e.textContent,width:e.clientWidth,scroll:e.scrollWidth}))}
 })()`)
 let layout=await measure();console.log('WORKSPACE PORTRAIT:',JSON.stringify(layout))
 await ui.screenshot(path.join(output,'git-portrait.png'))
 if(process.env.SELE_ANDROID_WORKSPACE_DIAGNOSTIC)return
 const verify=layout=>{
  for(const r of [layout.sidebar,layout.header,...layout.controls])assert.ok(r.left>=-1&&r.right<=layout.width+1,'workspace control stays in viewport')
  for(const label of layout.labels)assert.ok(label.scroll<=label.width+1,'full label is visible: '+label.text)
  assert.ok(Math.abs((layout.title.left+layout.title.right)/2-layout.width/2)<1,'Workspace text is centered in the screen')
  assert.ok(layout.footer.height<=112,'Git footer uses at most two touch rows')
 }
 verify(layout)
 assert.ok(layout.body.height/layout.sidebar.height>.68,'Git retains most of the workspace')
 if(process.env.SELE_ANDROID_WORKSPACE_NARROW){
  const previous=adb(['shell','wm','size']).match(/Override size:\s*(\d+x\d+)/)?.[1]??'reset'
  const scale=await run('devicePixelRatio')
  adb(['shell','wm','size',`${Math.round(320*scale)}x${Math.round(720*scale)}`])
  try{
   await waitFor('innerWidth<350');await delay(300);const narrow=await measure();console.log('WORKSPACE NARROW:',JSON.stringify(narrow));verify(narrow)
   await ui.screenshot(path.join(output,'git-narrow.png'))
  }finally{adb(['shell','wm','size',previous])}
  await waitFor('innerWidth>=350');await delay(300)
 }
 for(const section of ['Files','Recents','Terminal','Git']){
  await tap('.changes-sidebar [aria-label="Sidebar view"] button[aria-label="'+section+'"]')
  const widths=await run('[...document.querySelectorAll(".changes-sidebar__view-toggle")].map(e=>e.getBoundingClientRect().right)')
  assert.ok(widths.every(right=>right<=layout.width+1),'tabs fit in '+section)
 }
 await tap('.changes-sidebar [aria-label="Sidebar view"] button[aria-label="Browser"]')
 await waitFor('Boolean(document.querySelector(".browser-panel--mobile"))')
 const browserOrigin=await run('JSON.parse(localStorage.getItem("sele-android-connection-v1")).origin')
 for(let i=0;i<5;i++){
  await tap('.browser-panel button[aria-label="New browser tab"]')
  await tap('.browser-panel input[aria-label="Address"]')
  adb(['shell','input','keycombination','113','29'])
  adb(['shell','input','text',`${browserOrigin}/workspace-tab-${i}`])
  adb(['shell','input','keyevent','66'])
  // Address submit already blurs the editor. Await that IME close rather than
  // sending a Back while Android is removing its keyboard window.
  const hidden=Date.now()+10000
  while(Date.now()<hidden&&ui.keyboardVisible())await delay(100)
  assert.equal(ui.keyboardVisible(),false)
  await delay(300)
 }
 const browser=await run('(()=>{const panel=document.querySelector(".browser-panel"),rail=document.querySelector(".browser-panel__tabs-scroll"),add=document.querySelector(\'.browser-panel button[aria-label="New browser tab"]\'),active=rail.querySelector(\'[aria-pressed="true"]\');return {right:panel.getBoundingClientRect().right,addRight:add.getBoundingClientRect().right,width:rail.clientWidth,scroll:rail.scrollWidth,rail:rail.getBoundingClientRect().toJSON(),active:active.getBoundingClientRect().toJSON()}})()')
 assert.ok(browser.right<=layout.width+1&&browser.addRight<=layout.width+1,'many browser tabs never widen the workspace or hide New tab')
 console.log('BROWSER RAIL:',JSON.stringify(browser),await run('document.querySelectorAll(".browser-panel__tabs .ui-segmented-control__item").length'))
 assert.ok(browser.scroll>browser.width,'extra browser tabs scroll within their rail')
 assert.ok(browser.active.left>=browser.rail.left-1&&browser.active.right<=browser.rail.right+1,'newly selected browser tab is scrolled into view')
 await ui.screenshot(path.join(output,'browser-many-tabs.png'))
 await tap('.changes-sidebar [aria-label="Sidebar view"] button[aria-label="Git"]')
 adb(['shell','settings','put','system','accelerometer_rotation','0']);adb(['shell','settings','put','system','user_rotation','1'])
 try{
  await waitFor('innerWidth>innerHeight');await delay(400);layout=await measure();verify(layout)
  await ui.screenshot(path.join(output,'git-landscape.png'))
 }finally{adb(['shell','settings','put','system','user_rotation','0'])}
 await waitFor('innerHeight>innerWidth')
 await ui.navigate('Chats');await tap('.mobile-sidebar-footer__actions button[aria-label="New chat"]')
 await waitFor('Boolean(document.querySelector(".chat-panel__new-chat-vegvisir svg"))')
 assert.equal(await run('Boolean(document.querySelector(".chat-panel__new-chat-vegvisir canvas"))'),false,'mobile artwork uses retained SVG, not an offscreen surface')
 for(let i=0;i<3;i++){
  await ui.navigate('Workspace');await tap('.changes-sidebar [aria-label="Sidebar view"] button[aria-label="'+(i%2?'Files':'Git')+'"]')
  await ui.navigate('Conversation')
  await tap('#message-input');adb(['shell','input','text','draft']);await ui.dismissKeyboard()
  assert.equal(await run('document.querySelectorAll(".chat-panel__new-chat-vegvisir svg path").length>10'),true)
 }
 await delay(5000)
 const art=await run('(()=>{const e=document.querySelector(".chat-panel__new-chat-vegvisir"),path=e.querySelector("path"),r=e.getBoundingClientRect();return {width:r.width,height:r.height,stroke:getComputedStyle(path).stroke,animation:getComputedStyle(path).animationName,angle:e.style.getPropertyValue("--vegvisir-angle")}})()')
 assert.ok(art.width>150&&art.height>150);assert.notEqual(art.stroke,'none');assert.notEqual(art.animation,'none');assert.notEqual(art.angle,'0deg')
 await ui.screenshot(path.join(output,'new-chat-restored.png'))
 adb(['shell','input','keyevent','3']);await delay(300);adb(['shell','am','start','-W','-n','com.chipichapa.sele.android/.MainActivity']);await delay(500)
 assert.equal(await run('Boolean(document.querySelector(".chat-panel__new-chat-vegvisir svg"))'),true,'art survives Activity background/resume')
 await ui.screenshot(path.join(output,'new-chat-resumed.png'))
 console.log('ANDROID WORKSPACE PASSED: bounded tabs, complete wrapping Git labels, centered title, content area, landscape and SVG after workspace/keyboard/background transitions')
}
