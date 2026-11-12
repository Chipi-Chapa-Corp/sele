import { Maximize2, Minimize2, Minus, Settings, X } from 'lucide-react'
import { startTransition, useCallback, useEffect } from 'react'
import { appApi } from '../../appApi'
import { Button } from '../../components/Button'
import { useLatestHandler } from '../stableProps'
import { useWorkspaceDialogState } from '../state/useWorkspaceDialogState'
import { useWorkspacePreferenceState } from '../state/useWorkspacePreferenceState'
import { useWorkspaceSettingsContext } from './useWorkspaceSettingsContext'

type WorkspaceChromeDependencies = {
  dialogState: ReturnType<typeof useWorkspaceDialogState>
  settings: ReturnType<typeof useWorkspaceSettingsContext>
  preferences: ReturnType<typeof useWorkspacePreferenceState>
}

export function useWorkspaceChrome({
  dialogState,
  settings,
  preferences
}: WorkspaceChromeDependencies) {
  useEffect(() => {
    let active = true

    appApi
      .getWindowState()
      .then((nextWindowState) => {
        startTransition(() => {
          if (active) dialogState.setWindowState(nextWindowState)
        })
      })
      .catch((error: unknown) => {
        console.error('Unable to load the window state.', error)
      })

    const unsubscribe = appApi.onWindowStateUpdated(dialogState.setWindowState)

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const windowControlsHidden = settings.settingsPanelSettings.appearance.position === 'hidden'

  // Render functions handed to memoized panels must only change with their output.
  const minimizeWindow = useLatestHandler((): void => {
    void appApi.minimizeWindow()
  })

  const toggleWindowMaximized = useLatestHandler((): void => {
    void appApi
      .toggleWindowMaximized()
      .then(dialogState.setWindowState)
      .catch((error: unknown) => {
        console.error('Unable to toggle the window maximized state.', error)
      })
  })

  const closeWindow = useLatestHandler((): void => {
    void appApi.closeWindow()
  })

  const windowMaximized = dialogState.windowState.isMaximized

  const renderWindowControls = useCallback(
    (placement: 'darwin' | 'default'): React.ReactElement | null =>
      windowControlsHidden ? null : (
        <div
          className={`window-controls window-controls--${placement}`}
          aria-label="Window controls"
        >
          <button
            className="window-control window-control--minimize"
            type="button"
            aria-label="Minimize"
            title="Minimize"
            onClick={minimizeWindow}
          >
            <Minus aria-hidden="true" />
          </button>
          <button
            className="window-control window-control--maximize"
            type="button"
            aria-label={windowMaximized ? 'Restore' : 'Maximize'}
            title={windowMaximized ? 'Restore' : 'Maximize'}
            onClick={toggleWindowMaximized}
          >
            {windowMaximized ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          </button>
          <button
            className="window-control window-control--close"
            type="button"
            aria-label="Close"
            title="Close"
            onClick={closeWindow}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      ),
    [closeWindow, minimizeWindow, toggleWindowMaximized, windowControlsHidden, windowMaximized]
  )

  const chromeControlTheme: 'transparent' | 'secondary' =
    settings.effectiveAppSettings.appearance.controlStyle === 'transparent'
      ? 'transparent'
      : 'secondary'

  const renderSettingsButton = useCallback(
    (): React.ReactElement => (
      <Button
        theme={chromeControlTheme}
        aria-label="Settings"
        title="Settings"
        callback={() => preferences.setSettingsOpen(true)}
        icon={<Settings aria-hidden="true" />}
      />
    ),
    [chromeControlTheme]
  )
  return { windowControlsHidden, renderWindowControls, chromeControlTheme, renderSettingsButton }
}
