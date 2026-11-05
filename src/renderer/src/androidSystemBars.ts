import { Capacitor } from '@capacitor/core'
import { localNetwork } from './nativeLocalNetwork'

/** Match the shell and its drawer scrim, including the native inset areas on
 * WebViews whose safe areas are handled by Capacitor's native padding. */
export const initializeAndroidSystemBars = (): void => {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return
  let previous = ''
  let frame = 0
  const update = (): void => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const root = document.documentElement
      const shell = document.querySelector<HTMLElement>('.chat')
      const styles = getComputedStyle(shell ?? root)
      const color = (
        styles.getPropertyValue('--mobile-shell-bg') || styles.getPropertyValue('--bg')
      ).trim()
      if (!/^#[\da-f]{6}$/i.test(color)) return
      const dark = root.dataset.colorScheme === 'dark'
      const dimmed = shell?.dataset.mobilePane === 'chats'
      const next = `${color}:${dark}:${dimmed}`
      if (next === previous) return
      previous = next
      // The native method owns both palette and icons. SystemBars.setStyle also
      // resets DecorView to Android's default background, flashing on drawer taps.
      void localNetwork
        .setSystemBars({ color, dark, dimmed })
        .catch((error) => console.warn('Unable to update Android shell surface.', error))
    })
  }
  const palette = new MutationObserver(update)
  palette.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ['data-color-scheme', 'data-mobile-pane']
  })
  const content = new MutationObserver(update)
  const appRoot = document.getElementById('root')
  if (appRoot) content.observe(appRoot, { childList: true })
  update()
}
