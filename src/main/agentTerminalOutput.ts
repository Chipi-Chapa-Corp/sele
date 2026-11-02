import { execFile } from 'node:child_process'
import { open } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'
import type { AppContainerTarget } from '../shared/app'
import { getHostCommand } from './hostProcess'

/** Reads only new bytes, with bounded reads in the same environment as the command. */
export const createAgentTerminalOutputReader = (
  file: string,
  container: AppContainerTarget | null
) => {
  let offset = 0
  const decoder = new StringDecoder('utf8')
  return async (): Promise<{ data: string }> => {
    let bytes: Buffer
    if (process.platform === 'win32') {
      const handle = await open(file, 'r')
      try {
        const buffer = Buffer.alloc(65536)
        const result = await handle.read(buffer, 0, buffer.length, offset)
        bytes = buffer.subarray(0, result.bytesRead)
      } finally {
        await handle.close()
      }
    } else {
      const command = await getHostCommand(
        'sh',
        [
          '-c',
          'if [ -r "$1" ]; then tail -c "+$2" "$1" | head -c 65536; fi',
          'sele-agent-output',
          file,
          String(offset + 1)
        ],
        { container }
      )
      bytes = await new Promise<Buffer>((resolve, reject) => {
        execFile(
          command.file,
          command.args,
          {
            cwd: command.cwd,
            env: command.env,
            encoding: 'buffer',
            maxBuffer: 128 * 1024,
            timeout: 5000,
            windowsHide: true
          },
          (error, stdout) => (error ? reject(error) : resolve(stdout))
        )
      })
    }
    offset += bytes.length
    return { data: decoder.write(bytes) }
  }
}
