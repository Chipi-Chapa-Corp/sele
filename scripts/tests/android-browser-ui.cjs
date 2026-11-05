const assert=require('node:assert/strict')
const path=require('node:path')
const {WebSocket}=require('ws')
module.exports=async(ui,{desktop,browserUrl,artifacts})=>{
 const {run,tap,adb,delay,waitFor}=ui
 console.log('MOBILE UI: direct native browser and automatic bidirectional URL sharing')
 const selected=await run('document.querySelector(".chat-list-item--selected")?.dataset.chatId')
 if(selected){
  await desktop.click('.chat-home__filter-tabs button[aria-label="All chats"]')
  for(let i=0;i<20&&await desktop.eval('Boolean(document.querySelector(\'.chat-sidebar .chat-list-group__toggle[aria-expanded="false"]\'))');i++)await desktop.click('.chat-sidebar .chat-list-group__toggle[aria-expanded="false"]')
  await desktop.waitFor(`Boolean(document.querySelector('[data-chat-id="${selected}"] .chat-list-item__main'))`)
  await desktop.click(`[data-chat-id="${selected}"] .chat-list-item__main`)
 }

 await desktop.click('.changes-sidebar [aria-label="Sidebar view"] button[aria-label="Browser"]')
 await desktop.waitFor('Boolean(document.querySelector(\'.browser-panel input[aria-label="Address"]\'))')
 await desktop.click('.browser-panel input[aria-label="Address"]')
 await desktop.press('a',['ctrl']);await desktop.type(browserUrl);await desktop.press('Enter')
 const guest=`([...document.querySelectorAll('webview')].find(view=>view.getURL().startsWith(${JSON.stringify(browserUrl)})))`
 await desktop.waitFor(`${guest} && ${guest}.executeJavaScript('Boolean(document.getElementById("name"))')`)
 await desktop.click('.browser-panel button[aria-label="New browser tab"]')
 await run(`(()=>{window.__browserMethods=[];window.__browserSyncResponses=[];const original=localAccessApi.remoteBrowser.bind(localAccessApi);localAccessApi.remoteBrowser=options=>{window.__browserMethods.push(options.method);return original(options).then(result=>{window.__browserSyncResponses.push({opens:options.opens,result:result?.sync});window.__browserSyncResponses=window.__browserSyncResponses.slice(-8);return result})}})()`)
 await ui.navigate('Workspace')
 await tap('.changes-sidebar [aria-label="Sidebar view"] button[aria-label="Browser"]')
 await waitFor('Boolean(document.querySelector(".browser-panel--mobile"))')
 assert.equal(await run('Boolean(document.querySelector(".remote-browser, .remote-browser__page img"))'),false)
 const host=await desktop.eval('localAccessApi.getState().then(state=>new URL(state.urls[0]).hostname)')
 const transferred=new URL(browserUrl);transferred.hostname=host;const expected=transferred.href
 await waitFor(`document.querySelector('.browser-panel input[aria-label="Address"]')?.value===${JSON.stringify(expected)}`)
 const pid=adb(['shell','pidof','com.chipichapa.sele.android'])
 const port=adb(['forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`])
 let socket
 try{
  let target
  const deadline=Date.now()+15000
  while(Date.now()<deadline){const targets=await(await fetch(`http://127.0.0.1:${port}/json`)).json();target=targets.find(t=>t.url.startsWith(expected));if(target)break;await delay(100)}
  assert.ok(target,'desktop URL opens in a separate on-device WebView')
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject)})
  let id=0;const pending=new Map();socket.on('message',data=>{const value=JSON.parse(data);const p=pending.get(value.id);if(p){pending.delete(value.id);value.error?p.reject(Error(value.error.message)):p.resolve(value.result)}})
  const command=(method,params)=>new Promise((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});socket.send(JSON.stringify({id:current,method,params}))})
  const page=async expression=>{const value=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));return value.result.value}
  const until=async expression=>{const end=Date.now()+15000;while(Date.now()<end){try{if(await page(expression))return}catch{}await delay(100)}throw Error('Native browser timeout: '+expression+' '+await page('JSON.stringify({url:location.href,history:history.length})')+' '+await run('JSON.stringify(window.__browserSyncResponses)'))}
  await until('Boolean(document.getElementById("name"))')
  assert.ok(await page('innerWidth<500 && navigator.userAgent.includes("Mobile")'),'page uses a mobile viewport and user agent')
  assert.equal(await page('typeof window.Capacitor'),'undefined','website has no Sele native bridge')
  const nativeTap=async selector=>{await delay(250);const r=await page(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);const b=await run('(()=>{const r=document.querySelector(".browser-panel__workspace").getBoundingClientRect();return {x:r.x,y:r.y}})()');await ui.touchPoint({x:b.x+r.x,y:b.y+r.y})}
  await nativeTap('#name')
  await until('document.activeElement.id==="name"')
  const keyboardEnd=Date.now()+10000;while(Date.now()<keyboardEnd&&!ui.keyboardVisible())await delay(100)
  assert.equal(ui.keyboardVisible(),true)
  adb(['shell','input','text',"'Direct%sAndroid'"])
  await until('document.getElementById("name").value==="Direct Android"')
  await nativeTap('form button')
  await until('document.getElementById("result").textContent==="Direct Android"')
  assert.equal(await desktop.eval(`${guest}.executeJavaScript('document.getElementById("name").value')`),'','phone browsing does not send typing/clicks to the desktop')
  await ui.dismissKeyboard();await delay(300)
  const bounds=await run('(()=>{const r=document.querySelector(".browser-panel__workspace").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+30,h:r.height}})()')
  await ui.swipe({x:bounds.x,y:bounds.y+bounds.h*.7},{x:bounds.x,y:bounds.y+30})
  await until('scrollY>0')
  await ui.swipe({x:bounds.x,y:bounds.y+30},{x:bounds.x,y:bounds.y+bounds.h*.7})
  await until('scrollY===0')
  await nativeTap('a')
  await until('location.pathname==="/second"')
  await desktop.waitFor('[...document.querySelectorAll("webview")].some(view=>view.getURL().endsWith("/second"))')
  await waitFor('!document.querySelector(\'.browser-panel__navigation button[aria-label="Back"]\').disabled')
  await tap('.browser-panel__navigation button[aria-label="Back"]')
  await until('location.pathname==="/"')
  await nativeTap('#new-window')
  await until('location.pathname==="/popup"')
  await desktop.waitFor('[...document.querySelectorAll("webview")].some(view=>view.getURL().endsWith("/popup"))')
  await tap('.browser-panel__navigation button[aria-label="Back"]')
  await until('location.pathname==="/"')
  await ui.screenshot(path.join(artifacts,'direct-mobile-browser.png'))
  await tap('.mobile-conversation-header [aria-label="Open sidebar"]')
  await waitFor('document.querySelector("main.chat").dataset.mobilePane==="chats"')
  const footer=await run('(()=>{const row=document.querySelector(".mobile-sidebar-footer__actions").getBoundingClientRect();return [...document.querySelectorAll(".mobile-sidebar-footer__actions>.ui-button")].map(e=>{const r=e.getBoundingClientRect();return {width:r.width,expected:(row.width-3*parseFloat(getComputedStyle(e.parentElement).columnGap))/4,icon:e.querySelector("svg").getBoundingClientRect().width}})})()')
  for(const button of footer){assert.ok(Math.abs(button.width-button.expected)<1,'footer actions fill their grid columns');assert.ok(button.icon>=21,'mobile action icons are enlarged')}
  adb(['shell','input','keyevent','4']);await waitFor('document.querySelector("main.chat").dataset.mobilePane==="workspace"');await delay(400)
  await nativeTap('#name');await until('document.activeElement.id==="name"');await ui.dismissKeyboard()
  assert.equal(await run('Boolean(document.querySelector(\'button[aria-label="Tabs from computer"]\'))'),false,'automatic sync needs no transfer button')
  // A desktop URL opened after the phone is already browsing appears without an import action.
  const later=browserUrl+'/desktop-later'
  await desktop.click('.browser-panel input[aria-label="Address"]')
  await desktop.press('a',['ctrl']);await desktop.type(later);await desktop.press('Enter')
  await waitFor('document.querySelectorAll(".browser-panel__tabs .ui-segmented-control__item").length===2')
  // Arrival leaves the phone's current tab selected.
  await waitFor(`document.querySelector('.browser-panel input[aria-label="Address"]').value===${JSON.stringify(expected)}`)
  const closeGeometry=await run('(()=>{const e=document.querySelector(".browser-panel__tabs .ui-segmented-control__action"),r=e.getBoundingClientRect(),s=e.querySelector("svg").getBoundingClientRect();return {button:r.toJSON(),icon:s.toJSON()}})()')
  assert.ok(Math.abs(closeGeometry.button.y+closeGeometry.button.height/2-closeGeometry.icon.y-closeGeometry.icon.height/2)<1,'browser close icon is vertically centered')
  await nativeTap('#name');await until('document.hasFocus() && document.activeElement.id==="name"');await ui.dismissKeyboard()
  const methods=await run('window.__browserMethods');assert.ok(methods.includes('sync'));assert.ok(methods.every(m=>m==='sync'),'URL metadata only, no screenshot polling or input forwarding')
  await desktop.click('.changes-sidebar [aria-label="Sidebar view"] button[aria-label="Git"]')
  // An explicit phone URL queues until the PC Browser becomes active.
  const phoneUrl=browserUrl+'/phone-only'
  await tap('.browser-panel input[aria-label="Address"]');adb(['shell','input','keycombination','113','29']);adb(['shell','input','text',"'"+phoneUrl+"'"]);adb(['shell','input','keyevent','66']);
  await waitFor(`document.querySelector('.browser-panel input[aria-label="Address"]').value===${JSON.stringify(phoneUrl)}`)
  await ui.dismissKeyboard()
  await delay(1600)
  assert.equal(await desktop.eval('Boolean(document.querySelector(".browser-panel--active"))'),false,'phone URL does not steal desktop section')
  await desktop.click('.changes-sidebar [aria-label="Sidebar view"] button[aria-label="Browser"]')
  await desktop.waitFor(`[...document.querySelectorAll('webview')].some(view=>view.getURL()===${JSON.stringify(phoneUrl)})`)
  await delay(1500)
  assert.equal(await run('document.querySelector(\'.browser-panel input[aria-label="Address"]\').value'),phoneUrl,'phone loopback stays local on acknowledgment')
  console.log('MOBILE BROWSER PASSED: native mobile viewport/IME/submit/scroll/history, no transfer button, automatic PC URLs, queued phone URLs accepted when desktop Browser active, no URL echo loop, centered close icon')
 }finally{socket?.close();adb(['forward','--remove',`tcp:${port}`])}
}
