import { installMobileFocusPolicy } from './mobileFocus'
import { installTouchEditingActivation } from './touchInput'
import { localNetwork } from './nativeLocalNetwork'
import { isAndroidClient } from './runtimeCapabilities'
import { initializeAndroidSystemBars } from './androidSystemBars'
import { initializePreferences, showPreferenceFailure } from './preferences'

installMobileFocusPolicy()
installTouchEditingActivation(
  isAndroidClient()
    ? {
        visible: () => Boolean(document.querySelector('[data-mobile-keyboard="open"]')),
        restore: () => {
          void localNetwork
            .showKeyboard()
            .catch((error) => console.warn('Unable to retain Android keyboard.', error))
        }
      }
    : undefined
)
initializeAndroidSystemBars()

const initialize = async (): Promise<void> => {
  if (!(window as Window & { providerApi?: unknown }).providerApi) {
    const { initializeLanBridge } = await import('./lanBridge')
    await initializeLanBridge()
  }
  await initializePreferences()
  const { initializeChatSleep } = await import('./chatSleep')
  await initializeChatSleep()
}

void initialize()
  .then(() => import('./bootstrap'))
  .catch(showPreferenceFailure)
