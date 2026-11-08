import type { Terminal } from '@xterm/xterm'

type Output = { data: string; replay: boolean; parsed?: () => void }

/** Keep replay boundaries intact until xterm's asynchronous parser finishes each write. */
export const createTerminalOutput = (terminal: Pick<Terminal, 'write' | 'parser'>) => {
  const pending: Output[] = []
  let writing = false
  let replaying = false
  let disposed = false
  // Queries have no visual effect. Consume historical queries before xterm answers
  // them, while preserving normal input, display controls and live query replies.
  const queries = [
    ...[
      { final: 'c' },
      { prefix: '>', final: 'c' },
      { final: 'n' },
      { prefix: '?', final: 'n' },
      { intermediates: '$', final: 'p' },
      { prefix: '?', intermediates: '$', final: 'p' }
    ].map((id) => terminal.parser.registerCsiHandler(id, () => replaying)),
    terminal.parser.registerCsiHandler(
      { final: 't' },
      (params) => replaying && [14, 16, 18].includes(params[0] as number)
    ),
    terminal.parser.registerDcsHandler({ intermediates: '$', final: 'q' }, () => replaying),
    ...[4, 10, 11, 12].map((id) =>
      terminal.parser.registerOscHandler(id, (data) => replaying && data.split(';').includes('?'))
    )
  ]
  const drain = (): void => {
    if (disposed || writing) return
    const next = pending.shift()
    if (!next) return
    writing = true
    replaying = next.replay
    terminal.write(next.data, () => {
      replaying = false
      writing = false
      if (disposed) return
      next.parsed?.()
      drain()
    })
  }
  return {
    write(data: string, replay = false, parsed?: () => void): void {
      if (disposed) return
      pending.push({ data, replay, parsed })
      drain()
    },
    dispose(): void {
      disposed = true
      pending.length = 0
      for (const query of queries) query.dispose()
    }
  }
}
