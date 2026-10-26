// Read-only planning by default. --run requires an explicitly approved saved plan.
const fs = require('node:fs/promises')
const path = require('node:path')
const { capture, connect, evaluate } = require('./profile-chat-navigation.cjs')
const { sleep } = require('../e2e/harness.cjs')

async function createPlan(renderer) {
  return evaluate(
    renderer,
    `(() => {
    const from=document.querySelector('.chat-list-item--selected');
    if(!from)throw new Error('Select a root chat before planning the switching test');
    const group=from.closest('.chat-list-group');
    const candidates=root=>[...root.querySelectorAll('.chat-list-item[data-chat-id]')]
      .filter(row=>row.dataset.chatId!==from.dataset.chatId&&row.getBoundingClientRect().height>0);
    const active=row=>Boolean(row.querySelector('.chat-list-item__loading'));
    const nearby=candidates(group??document);
    const all=candidates(document);
    const to=nearby.find(row=>active(row)!==active(from))??all.find(row=>active(row)!==active(from))??all.find(active);
    if(!to)throw new Error('No active-chat pair is available');
    return {from:from.dataset.chatId,to:to.dataset.chatId,fromActive:active(from),toActive:active(to)};
  })()`
  )
}

async function replay(renderer, plan, { cycles = 3, dwellMs = 350 } = {}) {
  if (!plan?.from || !plan?.to || plan.from === plan.to) throw new Error('Invalid switching plan')
  if (!Number.isInteger(cycles) || cycles < 1 || cycles > 5)
    throw new Error('Use 1–5 switching cycles')
  const inspect = () =>
    evaluate(
      renderer,
      `({
    selected:document.querySelector('.chat-list-item--selected')?.dataset.chatId,
    modal:Boolean(document.querySelector('dialog[open], [aria-modal="true"]'))
  })`
    )
  const click = (id) =>
    evaluate(
      renderer,
      `(async () => {
    const row=[...document.querySelectorAll('.chat-list-item[data-chat-id]')].find(row=>row.dataset.chatId===${JSON.stringify(id)});
    const button=row?.querySelector('button.chat-list-item__main');
    if(!button)throw new Error('Planned chat is no longer available');
    const start=performance.now();button.click();
    let firstFrameMs=null;
    const selectionFrameMs=await new Promise((resolve,reject)=>{
      const check=()=>{
        const elapsed=performance.now()-start;
        firstFrameMs??=elapsed;
        if(document.querySelector('.chat-list-item--selected')?.dataset.chatId===${JSON.stringify(id)})return resolve(elapsed);
        if(elapsed>2000)return reject(new Error('Planned selection did not commit'));
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
    return {firstFrameMs,selectionFrameMs};
  })()`
    )
  let expected = plan.from
  let restore = false
  const measurements = []
  try {
    for (let i = 0; i < cycles * 2; i++) {
      const state = await inspect()
      if (state.modal) throw new Error('Close the modal before running the switching test')
      if (state.selected !== expected) {
        restore = false
        throw new Error('Selection changed outside the test; stopped without overriding it')
      }
      const target = i % 2 === 0 ? plan.to : plan.from
      restore = true
      expected = target
      measurements.push({ destination: target, ...(await click(target)) })
      await sleep(dwellMs)
    }
  } finally {
    if (restore) {
      const state = await inspect()
      if (!state.modal && state.selected === expected && state.selected !== plan.from)
        await click(plan.from)
    }
  }
  return measurements
}

async function run() {
  const args = process.argv.slice(2)
  const planPath = path.resolve('test-results/navigation-switch-plan.json')
  const renderer = await connect(
    9333,
    (target) => target.type === 'page' && target.url === 'http://localhost:5173/'
  )
  let main = null
  try {
    if (!args.includes('--run')) {
      const plan = await createPlan(renderer)
      await fs.mkdir(path.dirname(planPath), { recursive: true })
      await fs.writeFile(planPath, JSON.stringify(plan, null, 2))
      console.log(JSON.stringify({ plan, saved: planPath, actionsPerformed: 0 }))
      return
    }
    const plan = JSON.parse(await fs.readFile(planPath, 'utf8'))
    const cpuProfiles = !args.includes('--no-profile')
    if (cpuProfiles) main = await connect(9334, (target) => target.type === 'node')
    const directory = path.resolve(`test-results/switch-replay-${Date.now()}`)
    let measurements
    await capture({
      renderer,
      main,
      directory,
      trace: false,
      cpuProfiles,
      durationMs: 100,
      onReady: async () => {
        measurements = await replay(renderer, plan)
      }
    })
    await fs.writeFile(path.join(directory, 'switches.json'), JSON.stringify(measurements, null, 2))
    console.log(JSON.stringify({ directory, measurements }))
  } finally {
    renderer.close()
    main?.close()
  }
}

module.exports = { createPlan, replay }
if (require.main === module)
  run().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
