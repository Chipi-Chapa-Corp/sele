import assert from 'node:assert/strict'
import test from 'node:test'
import {MobileBrowserSync,mergeBrowserTabs} from './mobileBrowserSync.ts'
const origin='http://192.168.0.5:4589'
const blank={tabs:[{id:'blank',title:'New tab',url:''}],activeTabId:'blank'}
const snapshot=(tabs,accepted=[])=>({active:true,activeTabId:tabs[0]?.id??null,tabs,accepted})
test('desktop tabs automatically load locally, preserve selection and ignore polling echoes',()=>{
 const sync=new MobileBrowserSync(blank)
 const state=snapshot([{id:'pc',url:'http://localhost:3000/a',title:'PC'}])
 const first=sync.receive(state,origin)
 const session=mergeBrowserTabs(blank,first)
 assert.equal(session.tabs[0].url,'http://192.168.0.5:3000/a')
 assert.equal(session.activeTabId,'desktop:pc')
 assert.equal(sync.receive(state,origin).tabs.length,0)
 assert.equal(sync.outgoing().length,0)
 const next=sync.receive(snapshot([...state.tabs,{id:'next',url:'https://example.com/',title:'Next'}]),origin)
 assert.equal(mergeBrowserTabs(session,next).activeTabId,'desktop:pc')
 sync.close('desktop:pc')
 assert.equal(sync.receive(snapshot([{...state.tabs[0],url:'http://localhost:3000/b'}]),origin).tabs.length,0)
})
test('phone URL opens queue until accepted; local loopback echo is never rewritten',()=>{
 const sync=new MobileBrowserSync(blank)
 sync.opened('phone','http://127.0.0.1:3001')
 assert.deepEqual(sync.outgoing(),[{id:'mobile:phone',url:'http://127.0.0.1:3001/'}])
 const request=sync.outgoing()[0]
 const echo=sync.receive(snapshot([{id:request.id,url:request.url,title:'Phone'}],[request]),origin)
 assert.equal(echo.tabs.length,0)
 assert.equal(sync.outgoing().length,0)
 sync.opened('phone','https://example.com/new')
 sync.receive(snapshot([], [request]),origin)
 assert.equal(sync.outgoing()[0].url,'https://example.com/new')
})
test('a phone navigation on an imported tab targets its existing desktop tab',()=>{
 const sync=new MobileBrowserSync(blank)
 sync.receive(snapshot([{id:'pc',url:'http://localhost:3000/a',title:'PC'}]),origin)
 sync.opened('desktop:pc','https://example.com/new')
 assert.deepEqual(sync.outgoing(),[{id:'pc',url:'https://example.com/new'}])
 assert.equal(sync.receive(snapshot([{id:'pc',url:'http://localhost:3000/b',title:'PC'}]),origin).tabs.length,0)
 sync.close('desktop:pc');assert.equal(sync.outgoing().length,0)
})
