import type { App } from 'electron'

export const disableMiddleClickPaste = (
  commandLine: App['commandLine'],
  platform = process.platform
): void => {
  if (platform !== 'linux') return

  // Apply to every Chromium renderer, including webviews and sandboxed frames.
  // A DOM mouseup guard cannot cover those or controls that move their input
  // under the pointer (for example xterm). Keep ordinary clipboard paste and
  // middle-button actions such as opening links and closing tabs available.
  const settings = commandLine
    .getSwitchValue('blink-settings')
    .split(',')
    .filter(
      (setting) => setting && setting.split('=')[0].trim() !== 'selectionClipboardBufferAvailable'
    )
  settings.push('selectionClipboardBufferAvailable=false')
  commandLine.appendSwitch('blink-settings', settings.join(','))
}
