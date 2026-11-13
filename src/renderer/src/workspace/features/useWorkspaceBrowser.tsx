import { useCallback, useEffect } from 'react'
import type { BrowserOpenRequest } from '../../../../shared/browser'
import { isExpectedUrlParseError } from '../../../../shared/expectedAbsence.ts'
import { appApi } from '../../appApi'
import { browserApi } from '../../browserApi'
import { useWorkspacePanes } from './useWorkspacePanes'
import { useWorkspaceSettingsContext } from './useWorkspaceSettingsContext'
import type { WorkspaceState } from '../composition/useWorkspaceState'

export function useWorkspaceBrowser({
  settings,
  dialogState,
  panes
}: WorkspaceState & {
  settings: ReturnType<typeof useWorkspaceSettingsContext>
  panes: ReturnType<typeof useWorkspacePanes>
}) {
  const handleOpenBrowserRequest = useCallback(
    (request: BrowserOpenRequest): void => {
      if (!settings.effectiveAppSettings.browser.enabled) {
        void appApi
          .handleExternalLink({ url: request.url, action: 'open' })
          .catch((error: unknown) => {
            console.error('Unable to open a browser link externally.', error)
          })
        return
      }

      dialogState.setBrowserOpened(true)
      dialogState.setBrowserOpenRequest(request)
      panes.setChangesPaneView('browser')
    },
    [settings.effectiveAppSettings.browser.enabled]
  )

  useEffect(() => browserApi.onOpenRequested(handleOpenBrowserRequest), [handleOpenBrowserRequest])

  useEffect(
    () =>
      browserApi.onAutomationOpen((id) => {
        if (!settings.effectiveAppSettings.browser.enabled) {
          browserApi.automationRespond({
            id,
            error: 'The in-app browser is disabled in Sele settings.'
          })
          return
        }
        browserApi.automationAccept(id)
        dialogState.setBrowserOpened(true)
      }),
    [settings.effectiveAppSettings.browser.enabled]
  )

  useEffect(
    () =>
      browserApi.onAutomationVisibility((visible) => {
        if (visible) {
          dialogState.setBrowserOpened(true)
          panes.setChangesPaneView('browser')
        } else {
          panes.setChangesPaneView((current) => (current === 'browser' ? 'git' : current))
        }
      }),
    []
  )

  useEffect(() => {
    if (settings.effectiveAppSettings.browser.enabled) return

    let active = true
    queueMicrotask(() => {
      if (!active) return
      dialogState.setBrowserOpened(false)
      dialogState.setBrowserOpenRequest(null)
      panes.setChangesPaneView((currentView) => (currentView === 'browser' ? 'git' : currentView))
      if (panes.lastNonTerminalChangesPaneViewRef.current === 'browser') {
        panes.lastNonTerminalChangesPaneViewRef.current = 'git'
      }
    })

    return () => {
      active = false
    }
  }, [settings.effectiveAppSettings.browser.enabled])

  useEffect(() => {
    const handleLinkClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0) return

      const target = event.target
      const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null
      if (!anchor) return

      let url: URL
      try {
        url = new URL(anchor.href)
      } catch (error) {
        if (isExpectedUrlParseError(error)) return
        console.error('Unable to parse a clicked link.', error)
        return
      }
      if (!['http:', 'https:', 'file:', 'mailto:', 'tel:'].includes(url.protocol)) return

      event.preventDefault()
      if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'file:') {
        handleOpenBrowserRequest({ id: crypto.randomUUID(), url: url.toString() })
        return
      }

      void appApi
        .handleExternalLink({ url: url.toString(), action: 'open' })
        .catch((error: unknown) => {
          console.error('Unable to open an external link.', error)
        })
    }

    document.addEventListener('click', handleLinkClick)
    return () => document.removeEventListener('click', handleLinkClick)
  }, [handleOpenBrowserRequest])
  return { handleOpenBrowserRequest }
}
