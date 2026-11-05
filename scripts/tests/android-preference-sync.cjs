const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
module.exports = async (ui, {desktop, artifacts, modelId, chatId, cwd}) => {
  const {run, waitFor, tap, adb, delay} = ui
  const keys=['sele:app-settings:v1','sele:chat-sidebar-tabs:v1','sele:chat-presets:v1:codex','sele:sync-proof']
  const original=await desktop.eval(`Object.fromEntries(${JSON.stringify(keys)}.map(key=>[key,preferencesApi.getItem(key).value]))`)
  const write=async (page,key,value) => {
    const expression=`(async()=>{preferencesApi.${value===null?'removeItem':'setItem'}(${JSON.stringify(key)}${value===null?'':','+JSON.stringify(value)});return preferencesApi.flush()})()`
    const result=await (page===desktop?desktop.eval(expression):run(expression))
    assert.equal(result.ok,true)
  }
  const matches=(key,value)=>`preferencesApi.getItem(${JSON.stringify(key)}).value===${JSON.stringify(value)}`
  try {
    const settings=JSON.parse(original[keys[0]]||'{}')
    const dark=JSON.stringify({...settings,appearance:{...settings.appearance,theme:'dark'}})
    await write(desktop,keys[0],dark)
    await waitFor('document.documentElement.dataset.colorScheme==="dark"')
    await waitFor('getComputedStyle(document.querySelector(".chat-panel")).backgroundColor === "rgb(23, 21, 19)"')
    await delay(400)
    const pixel = async name => {
      const file=path.join(artifacts,name+'.png')
      await delay(400)
      await ui.screenshot(file)
      const source='data:image/png;base64,'+(await fs.readFile(file)).toString('base64')
      return desktop.eval(`new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);resolve([...context.getImageData(Math.floor(image.width/2),20,1,1).data].slice(0,3))};image.onerror=()=>reject(Error('Cannot decode native screenshot'));image.src=${JSON.stringify(source)}})`)

    }
    const darkBar=await pixel('synced-dark-theme')
    await require('./android-bars-animation.cjs')(ui,{artifacts,base:darkBar})
    assert.ok(Math.max(...darkBar)<70,'Android status bar uses the selected dark theme')
    await ui.navigate('Chats')
    const dimDarkBar=await pixel('dark-sidebar-status')
    assert.ok(dimDarkBar[1]<darkBar[1],'opening sidebar also dims the dark Android status bar')
    await ui.navigate('Conversation')
    await ui.navigate('Open settings')
    await tap('#settings-tab-appearance')
    await tap('.settings-dialog [aria-label="Theme"] button')
    await desktop.waitFor('document.documentElement.dataset.colorScheme==="light"')
    await waitFor('document.documentElement.dataset.colorScheme==="light"')
    await tap('.settings-dialog button[aria-label="Close settings"]')
    await waitFor('!document.querySelector(".settings-dialog")')
    await ui.navigate('Conversation')
    const lightBar=await pixel('light-status')
    assert.ok(Math.min(...lightBar)>200,'Android status bar returns to the light shell')
    await ui.navigate('Chats')
    const dimLightBar=await pixel('light-sidebar-status')
    assert.ok(dimLightBar.every((channel,index)=>channel<lightBar[index]-30),'opening sidebar dims Android status bar in light mode')
    await ui.navigate('Conversation')
    await write(desktop,keys[1],JSON.stringify({all:true,active:true,sleeping:true,working:false}))
    await ui.navigate('Chats')
    await waitFor('!document.querySelector(\'.chat-home__filter-tabs button[aria-label="Working chats"]\')')
    await write(ui,keys[1],JSON.stringify({all:true,active:true,sleeping:true,working:true}))
    await desktop.waitFor('Boolean(document.querySelector(\'.chat-home__filter-tabs button[aria-label="Working chats"]\'))')
    const desktopFilter=await desktop.eval('preferencesApi.getItem("sele:chat-sidebar-filter:v1").value')
    await run('preferencesApi.setItem("sele:chat-sidebar-filter:v1","all")')
    await delay(200)
    assert.equal(await desktop.eval('preferencesApi.getItem("sele:chat-sidebar-filter:v1").value'),desktopFilter,'current tab is local to each device')
    await tap('.chat-home__filter-tabs button[aria-label="All chats"]')
    await tap(`[data-chat-id="${chatId}"] .chat-list-item__main`)
    await waitFor('document.querySelector("main.chat")?.dataset.mobilePane==="conversation"')
    const projectName='Synced project with a long and readable name'
    await desktop.eval(`appApi.addProject(${JSON.stringify({cwd,name:projectName})})`)
    await ui.navigate('Chats')
    await waitFor(`document.querySelector('.chat-sidebar').textContent.includes(${JSON.stringify(projectName)})`)
    await tap(`[data-chat-id="${chatId}"] .chat-list-item__main`)
    const notes=await desktop.eval(`providerApi.getCwdNotes('codex',${JSON.stringify(cwd)})`)
    try {
      const note={id:'sync-note',text:'Notes from desktop',createdAt:Date.now()}
      await desktop.eval(`providerApi.setCwdNotes('codex',${JSON.stringify(cwd)},${JSON.stringify([...notes,note])})`)
      await tap('button[aria-label="Chat tools"]')
      await tap('.mobile-chat-tools .cwd-notes button')
      await waitFor('document.querySelector(".cwd-notes-menu")?.textContent.includes("Notes from desktop")')
      await desktop.eval(`providerApi.setCwdNotes('codex',${JSON.stringify(cwd)},${JSON.stringify([...notes,{...note,text:'Updated live on desktop'}])})`)
      await waitFor('document.querySelector(".cwd-notes-menu")?.textContent.includes("Updated live on desktop")')
      await ui.dismissKeyboard()
      adb(['shell','input','keyevent','4'])
      await waitFor('!document.querySelector(".cwd-notes-menu")')
      adb(['shell','input','keyevent','4'])
      await waitFor('!document.querySelector(".mobile-chat-tools")')
    } finally {
      await desktop.eval(`providerApi.setCwdNotes('codex',${JSON.stringify(cwd)},${JSON.stringify(notes)})`)
    }
    const preset={model:modelId,reasoningEffort:'high',approvalMode:'never',sandboxMode:'danger-full-access',agentMode:'interactive',serviceTier:null}
    await write(desktop,keys[2],JSON.stringify([preset]))
    await tap('.message-box__chat-config-trigger')
    await waitFor('document.querySelectorAll(".message-box__chat-config-preset-row").length===1')
    const second={...preset,reasoningEffort:'medium'}
    await write(desktop,keys[2],JSON.stringify([preset,second]))
    await waitFor('document.querySelectorAll(".message-box__chat-config-preset-row").length===2')
    await tap('.message-box__chat-config-preset-row button[aria-label^="Delete preset:"]')
    await desktop.waitFor('JSON.parse(preferencesApi.getItem("sele:chat-presets:v1:codex").value).length===1')
    adb(['shell','input','keyevent','4'])
    await waitFor('!document.querySelector(".message-box__chat-config-menu")')
    await write(ui,keys[3],'saved from Android')
    await desktop.waitFor(matches(keys[3],'saved from Android'))
    await ui.restart()
    await waitFor(matches(keys[3],'saved from Android'))
    await write(desktop,keys[3],null)
    await waitFor(matches(keys[3],null))
    console.log('MOBILE PREFERENCE SYNC PASSED: live bidirectional theme/settings/tabs, project metadata and notes, presets while open, native preset deletion, host durability after Activity restart, local current tab')
  } finally {
    for(const key of keys)await write(desktop,key,original[key])
  }
}
