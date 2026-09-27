import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { app, clipboard } from 'electron'

const execFileAsync = promisify(execFile)

export const copyVideoFile = async (name: string, data: Buffer): Promise<void> => {
  // A clipboard file must remain available after the preview (or app) closes.
  // Repeated copies reuse the same cached bytes, including remote workspace files.
  const directory = join(
    app.getPath('userData'),
    'sele-clipboard',
    createHash('sha256').update(data).digest('hex')
  )
  await mkdir(directory, { recursive: true })
  const path = join(directory, basename(name))
  await writeFile(path, data)

  if (process.platform === 'win32') {
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; ' +
          '$files = New-Object System.Collections.Specialized.StringCollection; ' +
          '[void]$files.Add($env:SELE_CLIPBOARD_FILE); ' +
          '[System.Windows.Forms.Clipboard]::SetFileDropList($files)'
      ],
      { env: { ...process.env, SELE_CLIPBOARD_FILE: path }, timeout: 10000 }
    )
    return
  }

  const url = pathToFileURL(path).href
  clipboard.writeBuffer(
    process.platform === 'darwin' ? 'public.file-url' : 'text/uri-list',
    Buffer.from(process.platform === 'darwin' ? url : `${url}\r\n`)
  )
}
