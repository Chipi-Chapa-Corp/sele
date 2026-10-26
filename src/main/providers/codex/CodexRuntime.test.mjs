import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { after, test } from 'node:test'
import { build } from 'esbuild'

// Real detached processes and sockets, with a fake provider; no accounts, GUI, or model calls.
const directory = await mkdtemp(join(tmpdir(), 'sele-runtime-test-'))
const bundle = join(directory, 'connector.mjs')
await build({
  entryPoints: [new URL('./CodexRuntime.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
  plugins: [
    {
      name: 'raw',
      setup(builder) {
        builder.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: join(args.resolveDir, args.path.slice(0, -4)),
          namespace: 'raw'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'raw' }, async (args) => ({
          contents: `export default ${JSON.stringify(await readFile(args.path, 'utf8'))}`
        }))
      }
    }
  ]
})
const { connectCodexRuntime, codexRuntimeKey } = await import(pathToFileURL(bundle).href)
const provider = join(directory, 'provider.cjs')
await writeFile(
  provider,
  `
const fs=require('node:fs');const {createInterface}=require('node:readline');
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
let starts=0,lastResult=null,active=false,initializes=0;
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line),p=m.params||{};
 const reply=result=>send({id:m.id,result});
 if(!m.method){lastResult=m.result;return}
 if(m.method==='initialize') { initializes++; return setTimeout(()=>reply({pid:process.pid,initializes}),p.delay||0) }
 if(m.method==='initialized')return;
 if(m.method==='thread/start')return reply({thread:{id:'thread',cwd:'/fixture',status:{type:'idle'},turns:[]}});
 if(m.method==='turn/start'){
  starts++;active=true;send({method:'turn/started',params:{threadId:'thread',turn:{id:'turn',status:'inProgress'}}});
  reply({turn:{id:'turn',status:'inProgress'}});
  if(p.finishFile)setTimeout(()=>{fs.writeFileSync(p.finishFile,'completed');active=false;
   send({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}})},600);
  return;
 }
 if(m.method==='fixture/ask'){
  setTimeout(()=>send({id:900,method:p.method,params:{threadId:'thread',turnId:'turn',callId:'call',tool:'fixture'}}),p.delay||0);
  return reply({});
 }
 if(m.method==='fixture/delayed')return setTimeout(()=>reply({marker:p.marker}),200);
 if(m.method==='fixture/complete') {active=false;
  send({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});return reply({})}
 if(m.method==='fixture/state')return reply({pid:process.pid,starts,active,lastResult});
 reply({});
});
`
)

const command = { file: process.execPath, args: [provider], env: process.env }
const connections = new Set()
const connectRuntime = async (profile, identity = 'account-a') => {
  const transport = await connectCodexRuntime(profile, identity, command)
  connections.add(transport)
  return transport
}
after(async () => {
  for (const transport of connections) transport.kill()
  // Allow broker stop messages and child reaping to finish before removing fixtures.
  await new Promise((resolve) => setTimeout(resolve, 150))
  await rm(directory, { recursive: true, force: true })
})

const rpc = (transport) => {
  let nextId = 0
  const pending = new Map(),
    messages = []
  createInterface({ input: transport.stdout }).on('line', (line) => {
    const message = JSON.parse(line)
    if (!message.method && pending.has(message.id)) {
      const request = pending.get(message.id)
      pending.delete(message.id)
      clearTimeout(request.timeout)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message.result)
    } else messages.push(message)
  })
  transport.on('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout)
      request.reject(new Error('Connection closed'))
    }
    pending.clear()
  })
  const write = (message) => transport.stdin.write(JSON.stringify(message) + '\n')
  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      const timeout = setTimeout(() => {
        pending.delete(id)
        reject(new Error('Timed out: ' + method))
      }, 5000)
      pending.set(id, { resolve, reject, timeout })
      write({ id, method, params })
    })
  return {
    request,
    write,
    messages,
    async initialize() {
      const result = await request('initialize')
      write({ method: 'initialized' })
      return result
    }
  }
}
const waitFor = async (predicate) => {
  const deadline = Date.now() + 5000
  while (!(await predicate())) {
    assert.ok(Date.now() < deadline, 'condition timed out')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
const detach = async (transport) => {
  const closed = once(transport, 'close')
  transport.detach()
  await closed
  connections.delete(transport)
}

test('a hard frontend crash leaves the same provider executing the accepted turn exactly once', async () => {
  const profile = join(directory, 'crash'),
    finishFile = join(directory, 'finished')
  const script = join(directory, 'frontend.mjs')
  await writeFile(
    script,
    `
import {connectCodexRuntime} from ${JSON.stringify(pathToFileURL(bundle).href)};
import {createInterface} from 'node:readline';
const t=await connectCodexRuntime(${JSON.stringify(profile)},'account-a',${JSON.stringify(command)});
let pid;
const send=(id,method,params={})=>t.stdin.write(JSON.stringify({id,method,params})+'\\n');
createInterface({input:t.stdout}).on('line',line=>{
 const m=JSON.parse(line);if(m.id===1&&!m.method){pid=m.result.pid;
 t.stdin.write(JSON.stringify({method:'initialized'})+'\\n');send(2,'thread/start')}
 if(m.id===2&&!m.method)send(3,'turn/start',{threadId:'thread',finishFile:${JSON.stringify(finishFile)}});
 if(m.id===3&&!m.method)process.stdout.write(JSON.stringify({pid})+'\\n');
});send(1,'initialize');`
  )
  const frontend = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  frontend.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const [line] = await Promise.race([
    once(createInterface({ input: frontend.stdout }), 'line'),
    once(frontend, 'exit').then(([code]) => {
      throw new Error(`Frontend exited (${code}): ${stderr}`)
    })
  ])
  const { pid } = JSON.parse(line)
  const exit = once(frontend, 'exit')
  frontend.kill('SIGKILL')
  await exit
  await waitFor(async () => {
    try {
      return (await readFile(finishFile, 'utf8')) === 'completed'
    } catch {
      return false
    }
  })
  const client = rpc(await connectRuntime(profile))
  const initialized = await client.initialize()
  assert.equal(initialized.pid, pid, 'reattach to the same process, not a replacement')
  assert.equal(initialized.seleRuntime.threads[0].thread.id, 'thread')
  const state = await client.request('fixture/state')
  assert.equal(state.starts, 1, 'do not replay turn/start on reconnect')
  assert.equal(state.active, false, 'the turn completed while the frontend was dead')
})

test('a clean shutdown detaches; a pending approval is delivered once after reconnect', async () => {
  const profile = join(directory, 'approval')
  const transport = await connectRuntime(profile),
    first = rpc(transport)
  const original = await first.initialize()
  await first.request('thread/start', { dynamicTools: [{ type: 'function', name: 'fixture' }] })
  await first.request('turn/start', { threadId: 'thread' })
  await first.request('fixture/ask', { method: 'item/commandExecution/requestApproval', delay: 50 })
  await detach(transport)
  await new Promise((resolve) => setTimeout(resolve, 100))
  const nextTransport = await connectRuntime(profile),
    second = rpc(nextTransport)
  const restored = await second.initialize()
  assert.equal(restored.pid, original.pid)
  assert.equal(restored.seleRuntime.threads[0].dynamicTools[0].name, 'fixture')
  await waitFor(() => second.messages.some((message) => message.id === 900))
  assert.equal(second.messages.filter((message) => message.id === 900).length, 1)
  second.write({ id: 900, result: { decision: 'accept' } })
  await waitFor(
    async () => (await second.request('fixture/state')).lastResult?.decision === 'accept'
  )
})

test('an in-flight client action gets an unknown-outcome failure and is never replayed', async () => {
  const profile = join(directory, 'tool')
  const transport = await connectRuntime(profile),
    first = rpc(transport)
  await first.initialize()
  await first.request('thread/start')
  await first.request('fixture/ask', { method: 'item/tool/call' })
  await waitFor(() => first.messages.some((message) => message.id === 900))
  await detach(transport)
  const second = rpc(await connectRuntime(profile))
  await second.initialize()
  await waitFor(async () => (await second.request('fixture/state')).lastResult?.success === false)
  const state = await second.request('fixture/state')
  assert.match(state.lastResult.contentItems[0].text, /outcome is unknown/)
  assert.equal(
    second.messages.some((message) => message.id === 900),
    false
  )
})

test('late replies cannot collide with a new client request ID after restart', async () => {
  const profile = join(directory, 'late')
  const transport = await connectRuntime(profile),
    first = rpc(transport)
  await first.initialize()
  const late = first.request('fixture/delayed', { marker: 'old' })
  // The old frontend's promise is abandoned at shutdown.
  const abandoned = assert.rejects(late, /Connection closed/)
  await detach(transport)
  const second = rpc(await connectRuntime(profile))
  await second.initialize()
  const state = await second.request('fixture/state')
  assert.equal(typeof state.pid, 'number')
  await new Promise((resolve) => setTimeout(resolve, 250))
  assert.equal(
    second.messages.some((message) => message.result?.marker === 'old'),
    false
  )
  // Dispose the test-only abandoned promise without waiting for a real app timeout.
  await abandoned
})

test('restarting during initialization does not initialize the provider connection twice', async () => {
  const profile = join(directory, 'initializing')
  const transport = await connectRuntime(profile),
    first = rpc(transport)
  const abandoned = assert.rejects(first.request('initialize', { delay: 200 }), /Connection closed/)
  await detach(transport)
  const second = rpc(await connectRuntime(profile))
  const result = await second.initialize()
  assert.equal(result.initializes, 1)
  await abandoned
})

test('a second live client cannot replace the worker or take over its stream', async () => {
  const profile = join(directory, 'exclusive')
  const first = rpc(await connectRuntime(profile))
  const original = await first.initialize()
  await assert.rejects(connectRuntime(profile), /rejected the connection/)
  assert.equal((await first.request('fixture/state')).pid, original.pid)
})

test('idle cleanup waits for detached work to finish and allows a later fresh launch', async (t) => {
  const profile = join(directory, 'idle')
  const stateDirectory = join(profile, 'codex-runtime-v1', codexRuntimeKey(profile, 'account-a'))
  const { mkdir } = await import('node:fs/promises')
  await mkdir(stateDirectory, { recursive: true })
  const token = 'a'.repeat(64)
  await writeFile(join(stateDirectory, 'token'), token)
  const worker = spawn(
    process.execPath,
    [new URL('./codexRuntime.cjs', import.meta.url).pathname],
    {
      stdio: ['pipe', 'ignore', 'pipe']
    }
  )
  t.after(() => worker.kill())
  worker.stdin.end(
    JSON.stringify({
      endpointPath: join(stateDirectory, 'endpoint.json'),
      token,
      command,
      idleTimeoutMs: 150
    }) + '\n'
  )
  await waitFor(async () => {
    try {
      await readFile(join(stateDirectory, 'endpoint.json'))
      return true
    } catch {
      return false
    }
  })
  const transport = await connectRuntime(profile),
    first = rpc(transport)
  const original = await first.initialize()
  await first.request('thread/start')
  await first.request('turn/start', { threadId: 'thread' })
  await detach(transport)
  await new Promise((resolve) => setTimeout(resolve, 250))
  assert.equal(worker.exitCode, null, 'an active detached turn cannot expire')
  const nextTransport = await connectRuntime(profile),
    second = rpc(nextTransport)
  assert.equal((await second.initialize()).pid, original.pid)
  await second.request('fixture/complete')
  const exited = once(worker, 'exit')
  await detach(nextTransport)
  await exited
  const third = rpc(await connectRuntime(profile))
  assert.notEqual((await third.initialize()).pid, original.pid, 'restart an expired idle worker')
})

test('profile, account and execution environment cannot share workers accidentally', () => {
  assert.notEqual(codexRuntimeKey('/a', ['host', 'a']), codexRuntimeKey('/b', ['host', 'a']))
  assert.notEqual(codexRuntimeKey('/a', ['host', 'a']), codexRuntimeKey('/a', ['host', 'b']))
  assert.notEqual(codexRuntimeKey('/a', ['host', 'a']), codexRuntimeKey('/a', ['ssh:box', 'a']))
})
