import { useMemo, useState } from 'react'
import { Download, Globe2, RefreshCw } from 'lucide-react'
import type { AppContainerTarget } from '../../../shared/app'
import type { BrowserCookieImportBrowser, BrowserCookieProfile } from '../../../shared/browser'
import { browserApi } from '../browserApi'
import { getBrowserCookieImportMessage } from '../browserCookieImport'
import { Button } from './Button'
import { Dropdown, type DropdownOption } from './Dropdown'
import './BrowserImportSettings.css'

type BrowserImportSettingsProps = {
  currentEnvironment: AppContainerTarget | null
}

type BrowserImportState = 'idle' | 'loading' | 'importing'

const noProfileValue = '__sele_no_browser_cookie_profile__'
const browserOptions = [
  {
    value: 'chrome',
    label: 'Chrome',
    icon: <Globe2 aria-hidden="true" />
  },
  {
    value: 'firefox',
    label: 'Firefox',
    icon: <Globe2 aria-hidden="true" />
  },
  {
    value: 'zen',
    label: 'Zen',
    icon: <Globe2 aria-hidden="true" />
  }
] satisfies readonly DropdownOption<BrowserCookieImportBrowser>[]
const browserLabels: Record<BrowserCookieImportBrowser, string> = {
  chrome: 'Chrome',
  firefox: 'Firefox',
  zen: 'Zen'
}

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback

export const BrowserImportSettings: React.FC<BrowserImportSettingsProps> = ({
  currentEnvironment
}) => {
  const [browser, setBrowser] = useState<BrowserCookieImportBrowser>('firefox')
  const [profiles, setProfiles] = useState<BrowserCookieProfile[]>([])
  const [profileId, setProfileId] = useState(noProfileValue)
  const [state, setState] = useState<BrowserImportState>('idle')
  const [status, setStatus] = useState<{ error: boolean; message: string } | null>(null)
  const profileOptions = useMemo<DropdownOption<string>[]>(
    () =>
      profiles.map((profile) => ({
        value: profile.id,
        label: profile.name,
        description: profile.description
      })),
    [profiles]
  )
  const selectedProfile = profiles.find((profile) => profile.id === profileId) ?? null
  const loading = state === 'loading'
  const importing = state === 'importing'
  const browserLabel = browserLabels[browser]

  const handleBrowserChange = (nextBrowser: BrowserCookieImportBrowser): void => {
    setBrowser(nextBrowser)
    setProfiles([])
    setProfileId(noProfileValue)
    setStatus(null)
  }

  const handleLoadProfiles = async (): Promise<void> => {
    if (loading || importing) return

    setState('loading')
    setProfiles([])
    setProfileId(noProfileValue)
    setStatus(null)
    try {
      const foundProfiles = await browserApi.findCookieProfiles({
        browser,
        currentEnvironment
      })
      setProfiles(foundProfiles)
      setProfileId(foundProfiles[0]?.id ?? noProfileValue)
      setStatus(
        foundProfiles.length === 0
          ? { error: false, message: `No ${browserLabel} profiles found.` }
          : {
              error: false,
              message: `Found ${foundProfiles.length} ${browserLabel} ${foundProfiles.length === 1 ? 'profile' : 'profiles'}.`
            }
      )
    } catch (error) {
      setStatus({
        error: true,
        message: getErrorMessage(error, `Unable to load ${browserLabel} profiles.`)
      })
    } finally {
      setState('idle')
    }
  }

  const handleImport = async (): Promise<void> => {
    if (!selectedProfile || loading || importing) return

    setState('importing')
    setStatus(null)
    try {
      const result = await browserApi.importCookies({ browser, profileId: selectedProfile.id })
      setStatus({
        error: false,
        message: getBrowserCookieImportMessage(result, selectedProfile.name)
      })
    } catch (error) {
      setStatus({
        error: true,
        message: getErrorMessage(error, `Unable to import ${browserLabel} cookies.`)
      })
    } finally {
      setState('idle')
    }
  }

  return (
    <section className="settings-dialog__section" aria-labelledby="settings-browser-import">
      <h2 className="settings-dialog__section-heading" id="settings-browser-import">
        Import
      </h2>
      <div className="settings-dialog__section-cards">
        <div className="settings-dialog__field settings-dialog__field--inline">
          <div className="settings-dialog__field-header">
            <h3 id="settings-browser-import-browser">Browser</h3>
            <p>Load browser profiles from the host and current environment.</p>
          </div>
          <div className="browser-import-settings__controls">
            <Dropdown<BrowserCookieImportBrowser>
              aria-label="Browser to import from"
              disabled={loading || importing}
              options={browserOptions}
              value={browser}
              onChange={handleBrowserChange}
            />
          </div>
        </div>
        <div className="settings-dialog__field settings-dialog__field--inline">
          <div className="settings-dialog__field-header">
            <h3 id="settings-browser-import-profile">Profile</h3>
            <p>Import cookies into Sele’s persistent browser session.</p>
          </div>
          <div className="browser-import-settings__controls">
            <Dropdown<string>
              aria-label="Browser profile"
              disabled={profiles.length === 0 || loading || importing}
              emptyContent="No profiles found"
              options={profileOptions}
              value={profileId}
              valueContent={
                loading
                  ? 'Loading profiles'
                  : profiles.length === 0
                    ? 'No profiles found'
                    : !selectedProfile
                      ? 'Select a profile'
                      : undefined
              }
              onChange={setProfileId}
            />
            {selectedProfile && (
              <Button
                aria-label="Load cookies from profile"
                callback={handleImport}
                disabled={loading || importing}
                icon={<Download aria-hidden="true" />}
                size="small"
                theme="secondary"
                title="Load cookies from profile"
              />
            )}
            <Button
              aria-label="Reload browser profiles"
              callback={handleLoadProfiles}
              disabled={loading || importing}
              icon={
                <RefreshCw
                  aria-hidden="true"
                  className={
                    loading
                      ? 'app-loading-spinner browser-import-settings__loading-icon'
                      : undefined
                  }
                />
              }
              size="small"
              theme="secondary"
              title="Reload browser profiles"
            />
          </div>
        </div>
      </div>
      {status && (
        <p
          className={`browser-import-settings__status${status.error ? ' browser-import-settings__status--error' : ''}`}
          role={status.error ? 'alert' : 'status'}
        >
          {status.message}
        </p>
      )}
    </section>
  )
}
