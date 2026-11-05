import assert from 'node:assert/strict'
import test from 'node:test'
import {build} from 'esbuild'
import {createRequire} from 'node:module'
const bundle=await build({entryPoints:['src/main/browserSync.ts'],bundle:true,platform:'node',format:'cjs',write:false})
const module={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports)
const {publishBrowserTabs,syncBrowserTabs}=module.exports
let id=0
const owner=()=>{const messages=[];return {id:++id,messages,isDestroyed:()=>false,once:()=>{},send:(channel,value)=>messages.push({channel,value})}}
test('metadata reads do not open or activate a desktop browser; phone opens wait for an active workspace',()=>{
 const desktop=owner(),workspaceKey='project:inactive'
 const state={workspaceKey,active:false,activeTabId:'pc',tabs:[{id:'pc',url:'http://localhost:3000/',title:'PC'}]}
 publishBrowserTabs(desktop,state)
 const request={id:'mobile:phone',url:'https://example.com/'}
 assert.equal(syncBrowserTabs(workspaceKey,[request]).active,false)
 assert.equal(desktop.messages.length,0)
 publishBrowserTabs(desktop,{...state,active:true})
 const next=syncBrowserTabs(workspaceKey,[request])
 assert.deepEqual(next.accepted,[request]);assert.equal(next.tabs[0].url,state.tabs[0].url)
 assert.equal(desktop.messages.length,1)
 syncBrowserTabs(workspaceKey,[request]);assert.equal(desktop.messages.length,1,'one open while the desktop commits its tab')
 publishBrowserTabs(desktop,{...state,active:true,tabs:[...state.tabs,{...request,title:'Phone'}]})
 syncBrowserTabs(workspaceKey,[request]);assert.equal(desktop.messages.length,1)
 assert.equal(syncBrowserTabs('different-workspace',[request]).active,false)
 assert.throws(()=>syncBrowserTabs(workspaceKey,[{...request,url:'javascript:alert(1)'}]))
})
test('successive phone opens never echo a previous desktop URL while the new one commits',()=>{
 const desktop=owner(),workspaceKey='project:rapid'
 const publication=url=>({workspaceKey,active:true,activeTabId:'pc',tabs:[{id:'pc',url,title:'Page'}]})
 publishBrowserTabs(desktop,publication('https://example.com/'))
 const second={id:'pc',url:'https://example.com/second'}
 assert.deepEqual(syncBrowserTabs(workspaceKey,[second]).tabs,[])
 assert.deepEqual(syncBrowserTabs(workspaceKey).tabs,[],'stale metadata stays hidden until commit')
 publishBrowserTabs(desktop,publication(second.url))
 const popup={id:'pc',url:'https://example.com/popup'}
 assert.deepEqual(syncBrowserTabs(workspaceKey,[popup]).tabs,[],'acknowledging the next open must not echo the previous one')
 publishBrowserTabs(desktop,publication(popup.url))
 assert.equal(syncBrowserTabs(workspaceKey).tabs[0].url,popup.url)
})
