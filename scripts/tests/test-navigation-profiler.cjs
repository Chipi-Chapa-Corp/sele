// A private fixture window only. Run through isolated-gui.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-profiler-'))
    try {
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        {
          env,
          encoding: 'utf8',
          timeout: 30000
        }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0) {
        process.stderr.write(result.stderr || String(result.error))
        process.exitCode = 1
      }
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow } = require('electron')
  const { capture, waitForClick } = require('../diagnostics/profile-chat-navigation.cjs')
  const { createPlan, replay } = require('../diagnostics/replay-chat-switches.cjs')
  const directory = process.argv[2]
  app.setPath('userData', path.join(directory, 'profile'))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    let code = 0
    const session = new (require('node:inspector').Session)()
    session.connect()
    try {
      const win = new BrowserWindow({ show: true, webPreferences: { backgroundThrottling: false } })
      await win.loadURL(`data:text/html,<div class="chat-list-group"><div class="chat-list-item chat-list-item--selected" data-chat-id="fixture"><button class="chat-list-item__main">Fixture chat</button></div>
        <div class="chat-list-item" data-chat-id="active"><span class="chat-list-item__loading"></span><button class="chat-list-item__main">Active fixture</button></div></div><script>
        window.clicks=0;window.sentMessages=0;
        document.querySelectorAll('button').forEach(button=>button.onclick=()=>{
          const select=()=>{
            document.querySelector('.chat-list-item--selected')?.classList.remove('chat-list-item--selected');
            button.closest('.chat-list-item').classList.add('chat-list-item--selected');
          };
          if(window.deferSelection)setTimeout(select,150);else select();
          window.clicks++;const end=performance.now()+80;while(performance.now()<end){}
        })
      </script>`)
      const debuggerApi = win.webContents.debugger
      debuggerApi.attach('1.3')
      const commands = []
      const renderer = {
        send: (method, params) => {
          commands.push(method)
          return debuggerApi.sendCommand(method, params)
        },
        evaluate: (expression) => win.webContents.executeJavaScript(expression),
        on: (callback) => {
          const listener = (_event, method, params) => callback({ method, params })
          debuggerApi.on('message', listener)
          return () => debuggerApi.off('message', listener)
        }
      }
      const main = {
        send: (method) =>
          new Promise((resolve, reject) => {
            session.post(method, (error, result) => (error ? reject(error) : resolve(result)))
          })
      }
      await capture({
        renderer,
        main,
        directory,
        durationMs: 200,
        onReady: async () => {
          assert.equal(
            await renderer.evaluate('window.clicks'),
            0,
            'capture itself never navigates'
          )
          await renderer.evaluate("document.querySelector('button').click()")
        }
      })
      const observations = JSON.parse(
        await fs.readFile(path.join(directory, 'navigation.json'), 'utf8')
      )
      assert.equal(observations.navigations.length, 1)
      assert.equal(observations.navigations[0].destination, 'fixture')
      assert.ok(observations.navigations[0].firstFrame !== null)
      assert.ok(
        observations.longTasks.some((task) => task.duration >= 70),
        'records the fixture stall'
      )
      assert.ok(observations.frameGaps.some((gap) => gap.duration >= 70))
      const trace = JSON.parse(
        await fs.readFile(path.join(directory, 'browser.trace.json'), 'utf8')
      )
      assert.ok(trace.traceEvents.some((event) => event.name === 'sele:navigation:1'))
      for (const name of ['renderer', 'main']) {
        const profile = JSON.parse(
          await fs.readFile(path.join(directory, `${name}.cpuprofile`), 'utf8')
        )
        assert.ok(profile.nodes.length > 0 && profile.samples.length > 0)
      }
      assert.equal(await renderer.evaluate('typeof window.__seleNavigationCapture'), 'undefined')
      assert.equal(await renderer.evaluate('window.sentMessages'), 0)
      await assert.rejects(
        capture({
          renderer,
          main,
          directory: path.join(directory, 'interrupted'),
          onReady: () => {
            throw new Error('fixture interrupted')
          }
        }),
        /fixture interrupted/
      )
      assert.equal(await renderer.evaluate('typeof window.__seleNavigationCapture'), 'undefined')
      assert.equal(commands.filter((method) => method === 'Profiler.disable').length, 2)
      assert.equal(debuggerApi.listenerCount('message'), 0, 'capture removes its protocol listener')
      assert.equal(await renderer.evaluate('window.clicks'), 1)
      const lightDirectory = path.join(directory, 'cpu-only')
      await capture({ renderer, main, directory: lightDirectory, trace: false, durationMs: 30 })
      await assert.rejects(fs.stat(path.join(lightDirectory, 'browser.trace.json')), {
        code: 'ENOENT'
      })
      const profilerCommands = commands.filter((method) => method.startsWith('Profiler.')).length
      const frameDirectory = path.join(directory, 'frames-only')
      await capture({
        renderer,
        main,
        directory: frameDirectory,
        trace: false,
        cpuProfiles: false,
        durationMs: 30
      })
      assert.equal(
        commands.filter((method) => method.startsWith('Profiler.')).length,
        profilerCommands
      )
      await assert.rejects(fs.stat(path.join(frameDirectory, 'renderer.cpuprofile')), {
        code: 'ENOENT'
      })
      assert.ok(await fs.stat(path.join(frameDirectory, 'navigation.json')))
      const armed = renderer.evaluate(`(${waitForClick.toString()})()`)
      await renderer.evaluate("document.querySelector('button').click()")
      assert.equal(await armed, true, 'arming waits for an actual navigation click')
      const planned = await createPlan(renderer)
      assert.deepEqual(planned, {
        from: 'fixture',
        to: 'active',
        fromActive: false,
        toActive: true
      })
      const clicksBefore = await renderer.evaluate('window.clicks')
      const switches = await replay(renderer, planned, { cycles: 1, dwellMs: 0 })
      assert.equal(switches.length, 2)
      assert.equal(await renderer.evaluate('window.clicks'), clicksBefore + 2)
      assert.equal(
        await renderer.evaluate(
          "document.querySelector('.chat-list-item--selected').dataset.chatId"
        ),
        'fixture'
      )
      assert.equal(await renderer.evaluate('window.sentMessages'), 0)
      await renderer.evaluate('window.deferSelection=true')
      const deferred = await replay(renderer, planned, { cycles: 1, dwellMs: 0 })
      assert.ok(
        deferred.every(
          (measurement) => measurement.selectionFrameMs > measurement.firstFrameMs + 20
        ),
        'a frame showing the old selection is not reported as completed navigation'
      )
      await renderer.evaluate('window.deferSelection=false')
      await renderer.evaluate(
        "document.querySelector('.chat-list-item--selected').classList.remove('chat-list-item--selected');document.querySelector('[data-chat-id=active]').classList.add('chat-list-item--selected')"
      )
      await assert.rejects(replay(renderer, planned), /Selection changed outside the test/)
      assert.equal(
        await renderer.evaluate(
          "document.querySelector('.chat-list-item--selected').dataset.chatId"
        ),
        'active'
      )
      const beforeModal = await renderer.evaluate('window.clicks')
      await renderer.evaluate(
        "const modal=document.createElement('div');modal.setAttribute('aria-modal','true');document.body.append(modal)"
      )
      await assert.rejects(replay(renderer, planned), /Close the modal/)
      assert.equal(
        await renderer.evaluate('window.clicks'),
        beforeModal,
        'modal guard performs no clicks'
      )
      console.log(
        'Navigation profiler passed: passive capture, both CPU profiles, browser trace, stall timing, and failure cleanup'
      )
    } catch (error) {
      console.error(error)
      code = 1
    } finally {
      session.disconnect()
    }
    app.exit(code)
  })
}
