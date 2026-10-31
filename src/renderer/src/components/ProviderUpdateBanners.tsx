import type { ReactElement } from 'react'
import { BellOff, Download, X } from 'lucide-react'
import { Button } from './Button'
import { ProviderIcon } from './ProviderIcon'
import { getProviderUpdateKey, type ProviderUpdateSuggestion } from '../providerSettings'
import { useProviderLabels } from '../providerLabels'
import type { useProviderUpdates } from '../useProviderUpdates'
import { getProviderUpdateSummary } from '../workspace/gitControllerUtils'

type Props = Omit<ReturnType<typeof useProviderUpdates>, 'isProviderUpdating'>

export function ProviderUpdateBanners({
  providerUpdateSuggestions,
  providerUpdateErrors,
  updatingProviderUpdateKey,
  providerUpdateInProgress,
  handleSkipProviderUpdate,
  handleNeverSuggestProviderUpdate,
  handleNeverSuggestProviderUpdateVersion,
  handleUpdateProvider
}: Props): ReactElement | null {
  const providerLabels = useProviderLabels()
  if (!providerUpdateSuggestions.length) return null
  return (
    <div className="chat-provider-updates" aria-label="Provider updates">
      {providerUpdateSuggestions.map((suggestion: ProviderUpdateSuggestion) => {
        const key = getProviderUpdateKey(suggestion)
        const updating = updatingProviderUpdateKey === key
        const error = providerUpdateErrors[key]
        const summary = getProviderUpdateSummary(suggestion, providerLabels[suggestion.providerId])
        return (
          <section
            key={key}
            className="chat-approval chat-provider-update"
            aria-label={`${providerLabels[suggestion.providerId]} update suggestion`}
          >
            <div className="chat-approval__main">
              <span className="chat-approval__label chat-provider-update__label">
                <ProviderIcon providerId={suggestion.providerId} aria-hidden="true" />
                <span>{`${providerLabels[suggestion.providerId]} update available`}</span>
              </span>
              <span className="chat-approval__summary" title={summary}>
                {summary}
              </span>
              {error && (
                <span className="chat-approval__error" role="status">
                  {error}
                </span>
              )}
            </div>
            <div className="chat-approval__actions">
              <Button
                disabled={providerUpdateInProgress}
                callback={() => handleSkipProviderUpdate(suggestion)}
                dropdownActions={[
                  {
                    id: 'never-suggest-version',
                    label: 'Never suggest this version',
                    title: `Never suggest ${suggestion.latestVersion}`,
                    disabled: providerUpdateInProgress,
                    icon: <X aria-hidden="true" />,
                    callback: () => handleNeverSuggestProviderUpdateVersion(suggestion)
                  },
                  {
                    id: 'never-suggest',
                    label: 'Never suggest',
                    disabled: providerUpdateInProgress,
                    icon: <BellOff aria-hidden="true" />,
                    callback: () => handleNeverSuggestProviderUpdate(suggestion)
                  }
                ]}
                dropdownLabel="Skip update options"
                dropdownMenuAlign="end"
                dropdownPlacement="top"
                icon={<X aria-hidden="true" />}
                label={<span>Skip</span>}
                theme="secondary"
              />
              <Button
                disabled={providerUpdateInProgress}
                callback={() => void handleUpdateProvider(suggestion)}
                icon={<Download aria-hidden="true" />}
                label={<span>{updating ? 'Updating' : 'Update'}</span>}
                theme="primary"
              />
            </div>
          </section>
        )
      })}
    </div>
  )
}
