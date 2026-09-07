import type { BrowserCdpParams } from './BrowserAutomation'

export type BrowserCdpCommand = <T = BrowserCdpParams>(
  method: string,
  params?: BrowserCdpParams
) => Promise<T>
export type BrowserPoint = [number, number]

const keys: Record<string, [string, string, number]> = {
  enter: ['Enter', 'Enter', 13],
  return: ['Enter', 'Enter', 13],
  tab: ['Tab', 'Tab', 9],
  escape: ['Escape', 'Escape', 27],
  esc: ['Escape', 'Escape', 27],
  backspace: ['Backspace', 'Backspace', 8],
  delete: ['Delete', 'Delete', 46],
  space: [' ', 'Space', 32],
  up: ['ArrowUp', 'ArrowUp', 38],
  down: ['ArrowDown', 'ArrowDown', 40],
  left: ['ArrowLeft', 'ArrowLeft', 37],
  right: ['ArrowRight', 'ArrowRight', 39],
  arrowup: ['ArrowUp', 'ArrowUp', 38],
  arrowdown: ['ArrowDown', 'ArrowDown', 40],
  arrowleft: ['ArrowLeft', 'ArrowLeft', 37],
  arrowright: ['ArrowRight', 'ArrowRight', 39],
  home: ['Home', 'Home', 36],
  end: ['End', 'End', 35],
  pageup: ['PageUp', 'PageUp', 33],
  pagedown: ['PageDown', 'PageDown', 34]
}
const modifiers: Record<string, number> = { alt: 1, ctrl: 2, control: 2, cmd: 4, meta: 4, shift: 8 }

export async function pressBrowserKeys(cdp: BrowserCdpCommand, text: string): Promise<void> {
  // Validate the complete sequence before sending any input.
  const sequence = text
    .trim()
    .split(/\s+/)
    .map((chord) => {
      const parts = chord.split('+')
      const name = parts.pop()!
      let flags = 0
      for (const part of parts) {
        if (!modifiers[part.toLowerCase()]) throw new Error(`Unsupported key modifier: ${part}`)
        flags |= modifiers[part.toLowerCase()]
      }
      let entry = keys[name.toLowerCase()]
      if (!entry && /^[a-z0-9]$/i.test(name)) {
        entry = [
          flags & 8 ? name.toUpperCase() : name.toLowerCase(),
          /^\d$/.test(name) ? `Digit${name}` : `Key${name.toUpperCase()}`,
          name.toUpperCase().charCodeAt(0)
        ]
      }
      if (!entry) throw new Error(`Unsupported key: ${name}`)
      return { key: entry[0], code: entry[1], windowsVirtualKeyCode: entry[2], modifiers: flags }
    })
  for (const input of sequence) {
    const text =
      (input.modifiers & 7) === 0
        ? input.key === 'Enter'
          ? '\r'
          : input.key.length === 1
            ? input.key
            : undefined
        : undefined
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...input, ...(text ? { text } : {}) })
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...input })
  }
}

export async function clickBrowserPoint(
  cdp: BrowserCdpCommand,
  [x, y]: BrowserPoint,
  button: 'left' | 'right' | 'middle' = 'left',
  count = 1
): Promise<void> {
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  for (let clickCount = 1; clickCount <= count; clickCount++) {
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount })
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount })
  }
}
