const assert=require('node:assert/strict')
const path=require('node:path')
const fs=require('node:fs/promises')
const {spawn,spawnSync}=require('node:child_process')
module.exports=async(ui,{artifacts,base})=>{
 const binary=path.join(process.env.ANDROID_HOME||path.join(require('node:os').homedir(),'Android/Sdk'),'platform-tools/adb')
 const args=['-P',process.env.SELE_ANDROID_ADB_PORT||'5049','-s',process.env.SELE_ANDROID_TEST_SERIAL]
 const remote='/sdcard/sele-system-bars-animation.mp4',file=path.join(artifacts,'system-bars-animation.mp4')
 // Warm native coordinate calibration before recording the transitions.
 await ui.navigate('Chats');ui.adb(['shell','input','keyevent','4']);await ui.waitFor('document.querySelector("main.chat").dataset.mobilePane!=="chats"');await ui.delay(300)
 const recording=spawn(binary,[...args,'shell','screenrecord','--bit-rate','1500000','--time-limit','8',remote],{stdio:['ignore','ignore','pipe']})
 let diagnostic='';recording.stderr.on('data',data=>diagnostic+=data)
 const done=new Promise((resolve,reject)=>{recording.once('error',reject);recording.once('close',code=>code===0?resolve():reject(Error('screenrecord: '+diagnostic)))})
 try{
  await ui.delay(400)
  for(let i=0;i<4;i++){await ui.navigate('Chats');await ui.delay(250);ui.adb(['shell','input','keyevent','4']);await ui.waitFor('document.querySelector("main.chat").dataset.mobilePane!=="chats"');await ui.delay(250)}
  await done
  ui.adb(['pull',remote,file])
  const result=spawnSync('/usr/bin/ffmpeg',['-v','error','-i',file,'-vf','crop=2:2:iw/2:20,scale=1:1,format=rgb24','-fps_mode','passthrough','-f','rawvideo','pipe:1'],{maxBuffer:1024*1024})
  assert.equal(result.status,0,result.stderr.toString())
  assert.ok(result.stdout.length>=3*8,'native recording includes the drawer animation frames')
  const values=[[],[],[]];for(let i=0;i<result.stdout.length;i++)values[i%3].push(result.stdout[i])
  // H.264 can quantize the small dark-theme dim delta to one color.
  // Lossless PNG checks separately prove dimming; video detects transient palette flashes.
  const max=values.map(v=>Math.max(...v)),min=values.map(v=>Math.min(...v))
  for(let i=0;i<3;i++){assert.ok(min[i]>=Math.round(base[i]*.6+[22,18,12][i]*.4)-8,'no black frame during drawer animation');assert.ok(max[i]<=base[i]+12,`no Android default-color flash during drawer animation: ${JSON.stringify({base,min,max})}`)}
  await fs.writeFile(path.join(artifacts,'system-bars-animation.json'),JSON.stringify({base,min,max,frames:result.stdout.length/3},null,2))
  console.log('MOBILE STATUS ANIMATION PASSED: native recorded frames stay within the dark shell/scrim palette without a light flash')
 }finally{if(recording.exitCode===null)recording.kill();ui.adb(['shell','rm','-f',remote])}
}
