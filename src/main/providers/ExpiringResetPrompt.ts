import { BrowserWindow, dialog } from 'electron'

export const promptExpiringReset = async (
  account: string,
  waitMs: number,
  signal: AbortSignal
): Promise<boolean> => {
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    title: 'Manual reset expiring',
    message: `Use the expiring manual reset for ${account}?`,
    detail: `This Codex account has a manual reset expiring in under 3 minutes. Select OK to reset now, or Cancel to skip this credit. If you do nothing, Sele will reset automatically in ${Math.ceil(waitMs / 1_000)} seconds.`,
    buttons: ['OK', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    signal
  }
  // macOS requires a parent for an abortable, asynchronous message box.
  if (!parent && process.platform === 'darwin') return true
  const result = await (parent
    ? dialog.showMessageBox(parent, options)
    : dialog.showMessageBox(options))
  return result.response === 0
}
