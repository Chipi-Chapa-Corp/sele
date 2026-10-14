import { app, BrowserWindow } from 'electron'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const [directory, token] = process.argv.slice(2)
const record = (event: string, extra = {}): void => {
  appendFileSync(
    join(directory, 'events.jsonl'),
    JSON.stringify({ event, token, pid: process.pid, ...extra }) + '\n'
  )
}
record('runtime-import')

export const startApplication = async (): Promise<{ focus: () => void }> => {
  await delay(Number(process.env.SELE_SINGLE_INSTANCE_FIXTURE_DELAY_MS ?? 0))
  await app.whenReady()
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  await window.loadFile(join(directory, 'index.html'))
  const previous = await window.webContents.executeJavaScript(`(() => {
    const key = 'sele:single-instance-fixture'
    const previous = localStorage.getItem(key)
    localStorage.setItem(key, 'saved')
    return previous
  })()`)
  window.webContents.session.flushStorageData()
  record('ready', { previous })

  let closing = false
  app.on('before-quit', (event) => {
    if (closing) return
    closing = true
    event.preventDefault()
    record('closing')
    void delay(2000).then(() => app.quit())
  })
  app.on('quit', () => record('quit'))
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (command) => {
    if (String(command).includes('quit')) app.quit()
  })
  return {
    focus: () => {
      record('focus')
      if (!window.isDestroyed() && !closing) {
        window.show()
        window.focus()
      }
    }
  }
}
