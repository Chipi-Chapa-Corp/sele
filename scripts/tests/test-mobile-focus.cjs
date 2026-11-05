const assert=require('node:assert/strict')
const fs=require('node:fs/promises')
const path=require('node:path')
const {build}=require('esbuild')
if(!process.versions.electron){
 (async()=>{const dir=await fs.mkdtemp(path.resolve('tmp/mobile-focus-'));try{
 await build({stdin:{contents:"import {installMobileFocusPolicy} from './src/renderer/src/mobileFocus';installMobileFocusPolicy()",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'browser',outfile:path.join(dir,'focus.js')})
 await fs.writeFile(path.join(dir,'index.html'),'<meta name="viewport" content="width=device-width,initial-scale=1"><style>input,textarea,button{display:block;margin:20px;height:45px;width:280px}</style><input id="ordinary"><input id="search" type="search"><button id="open">Open</button><dialog><textarea id="goal"></textarea><button id="close">Close</button></dialog><div data-mobile-editor id="terminal"><div id="canvas">Terminal surface</div><textarea id="terminalInput"></textarea></div><script src="focus.js"></script><script>document.getElementById("canvas").onpointerdown=event=>event.preventDefault();document.getElementById("canvas").onpointerup=()=>document.getElementById("terminalInput").focus();document.getElementById("open").onclick=()=>{document.querySelector("dialog").showModal();document.getElementById("goal").focus()};document.getElementById("close").onclick=()=>document.querySelector("dialog").close("saved")</script>')
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
 const result=require('node:child_process').spawnSync(require('electron'),[__filename,dir,'--no-sandbox','--ozone-platform=x11'],{env,encoding:'utf8',timeout:40000});process.stdout.write(result.stdout);process.stderr.write(result.stderr);if(result.status!==0)throw Error('Mobile focus fixture failed')
 }finally{await fs.rm(dir,{recursive:true,force:true})}})().catch(error=>{console.error(error);process.exitCode=1})
}else{
 const {app,BrowserWindow}=require('electron');let window
 ;(async()=>{const dir=process.argv[2];app.setPath('userData',path.join(dir,'profile'));await app.whenReady();window=new BrowserWindow({width:440,height:720,show:true,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});await window.loadFile(path.join(dir,'index.html'));const run=s=>window.webContents.executeJavaScript(s);window.webContents.debugger.attach('1.3');const command=(method,params)=>window.webContents.debugger.sendCommand(method,params);const tap=async selector=>{const p=await run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await new Promise(r=>setTimeout(r,100))}
 await run('document.getElementById("ordinary").focus();document.getElementById("ordinary").select()');assert.notEqual(await run('document.activeElement.id'),'ordinary')
 await run('document.getElementById("search").focus()');assert.equal(await run('document.activeElement.id'),'search')
 await tap('#ordinary');assert.equal(await run('document.activeElement.id'),'ordinary')
 await run('document.getElementById("terminalInput").focus()');assert.notEqual(await run('document.activeElement.id'),'terminalInput');await tap('#canvas');assert.equal(await run('document.activeElement.id'),'terminalInput');await tap('#open');assert.notEqual(await run('document.activeElement.id'),'goal');assert.equal(await run('document.querySelector("dialog").open'),true)
 await tap('#goal');assert.equal(await run('document.activeElement.id'),'goal')
 await tap('#close');assert.equal(await run('document.querySelector("dialog").returnValue'),'saved');assert.notEqual(await run('document.activeElement.id'),'ordinary')
 window.setSize(1400,720);await new Promise(r=>setTimeout(r,100));await run('document.getElementById("ordinary").focus()');assert.equal(await run('document.activeElement.id'),'ordinary')
 console.log('MOBILE FOCUS PASSED: no nonsearch autofocus/select/dialog initial or restored caret; explicit touch and search work; dialog return value and desktop focus preserved')
 })().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{window?.destroy();app.exit(process.exitCode||0)})
}
