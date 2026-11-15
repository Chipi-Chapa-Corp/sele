import { RefreshCw } from 'lucide-react'
import {
  areAnySettingsProviderSkillsEnabled,
  groupSettingsProviderResources,
  isSettingsProviderAppGroupEnabled,
  shouldShowSettingsProviderAppSkills,
  type SettingsProviderSkill
} from '../../../shared/providerOwnership'
import { getSettingsSkillDescription } from '../providerSettings'
import { Button } from './Button'
import { Dropdown } from './Dropdown'
import { ProviderSettingsContent } from './ProviderSettingsContent'
import { SettingsSection, sshEnvironmentMenuActions } from './settingsFields'
import type { SettingsPanelProps } from './SettingsPanel.types'
import { SettingsSkillPathAction } from './SettingsSkillPathAction'
import { Switch } from './Switch'

const isClaudeMarketplaceSkill = (resource: SettingsProviderSkill): boolean =>
  resource.providerId === 'claude' &&
  resource.skill.path.replace(/\\/g, '/').includes('/plugins/marketplaces/')

export function SettingsProvidersPanel(props: SettingsPanelProps): React.ReactNode {
  const {
    containerOptions,
    handleCodexRecommendedPluginsChange,
    handleProviderConnectionsChanged,
    handleNewSessionContainerChange,
    handleProviderAppEnabledChange,
    handleProviderSkillEnabledChange,
    handleProviderSkillsEnabledChange,
    newSessionContainerValue,
    newSessionProvider,
    newSessionProviderOptions,
    newSessionProviderValueContent,
    newSessionSourceAvailabilityReady,
    providerAccountUpdatingId,
    providerResourceUpdatingKey,
    providerResourcesError,
    providerResourcesLoadState,
    setNewSessionProvider,
    setProviderResourcesRefresh,
    settingsPanelSettings,
    settingsProviderApps,
    settingsProviderSkills
  } = props

  const providerResourcesLoading = providerResourcesLoadState !== 'ready'
  const { appGroups, unparentedSkills } = groupSettingsProviderResources(
    settingsProviderSkills,
    settingsProviderApps
  )
  const standaloneToggleSkills = unparentedSkills.filter(
    (resource) => !isClaudeMarketplaceSkill(resource)
  )
  const renderSkill = (
    resource: SettingsProviderSkill,
    toggleId: string,
    note?: string
  ): React.ReactElement => (
    <div className="settings-dialog__field" key={resource.skill.path}>
      <div className="settings-dialog__field-header">
        <div className="settings-dialog__skill-title">
          <h3 id={toggleId}>{resource.skill.name}</h3>
          <SettingsSkillPathAction path={resource.skill.path} />
        </div>
        <p>
          {getSettingsSkillDescription(resource.skill)}
          {note}
        </p>
      </div>
      <Switch
        className="settings-switch"
        aria-labelledby={toggleId}
        checked={resource.skill.enabled}
        disabled={Boolean(providerResourceUpdatingKey)}
        onChange={(event) =>
          void handleProviderSkillEnabledChange(resource, event.currentTarget.checked)
        }
      />
    </div>
  )
  const unparentedSkillsEnabled = areAnySettingsProviderSkillsEnabled(standaloneToggleSkills)
  return (
    <>
      <div
        className="settings-dialog__provider-configuration"
        role="group"
        aria-label="Provider configuration"
      >
        <span>Configure</span>
        <Dropdown
          aria-label="Provider"
          disabled={
            Boolean(providerResourceUpdatingKey) ||
            Boolean(providerAccountUpdatingId) ||
            newSessionProviderOptions.length === 0
          }
          emptyContent="No providers found"
          options={newSessionProviderOptions}
          size="small"
          value={newSessionProvider}
          valueContent={newSessionProviderValueContent}
          onChange={setNewSessionProvider}
        />
        <span>in</span>
        <Dropdown
          aria-label="Provider environment"
          disabled={Boolean(providerResourceUpdatingKey) || Boolean(providerAccountUpdatingId)}
          menuActions={sshEnvironmentMenuActions(props, 'provider')}
          options={containerOptions}
          size="small"
          value={newSessionContainerValue}
          valueContent={!newSessionSourceAvailabilityReady ? 'Checking' : undefined}
          onChange={handleNewSessionContainerChange}
        />
      </div>
      <ProviderSettingsContent
        key={newSessionProvider}
        onConnectionsChanged={() =>
          handleProviderConnectionsChanged(newSessionProvider, props.newSessionContainer)
        }
        providerId={newSessionProvider}
        container={props.newSessionContainer}
      >
        <>
          {newSessionProvider === 'codex' && (
            <SettingsSection id="settings-providers-ads" title="Ads">
              <div className="settings-dialog__field">
                <div className="settings-dialog__field-header">
                  <h3 id="settings-provider-codex-recommended-plugins">
                    Show recommended plugins to agent
                  </h3>
                  <p>Include the Codex list of available recommended plugins in new agent turns.</p>
                </div>
                <Switch
                  className="settings-switch"
                  aria-labelledby="settings-provider-codex-recommended-plugins"
                  checked={settingsPanelSettings.providers.codex.showRecommendedPlugins}
                  onChange={(event) =>
                    handleCodexRecommendedPluginsChange(event.currentTarget.checked)
                  }
                />
              </div>
            </SettingsSection>
          )}
        </>
        {(query) => {
          const normalizedQuery = query.trim().toLocaleLowerCase()
          const matchesSkill = (resource: SettingsProviderSkill): boolean =>
            [
              resource.skill.name,
              resource.skill.displayName,
              resource.skill.description,
              resource.skill.shortDescription,
              resource.skill.path
            ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery))
          const filteredAppGroups = appGroups.flatMap((group) => {
            const appMatches = [group.resource.app.name, group.resource.app.description].some(
              (value) => value.toLocaleLowerCase().includes(normalizedQuery)
            )
            const visibleSkills = appMatches ? group.skills : group.skills.filter(matchesSkill)
            return appMatches || visibleSkills.length > 0 ? [{ ...group, visibleSkills }] : []
          })
          const filteredStandaloneSkills = normalizedQuery
            ? unparentedSkills.filter(matchesSkill)
            : unparentedSkills

          return (
            <>
              {normalizedQuery &&
                !providerResourcesLoading &&
                filteredAppGroups.length === 0 &&
                filteredStandaloneSkills.length === 0 && <p role="status">No matching skills.</p>}
              {providerResourcesError && (
                <SettingsSection id="settings-providers-status" title="Status">
                  <div className="settings-dialog__field settings-dialog__field--inline">
                    <div className="settings-dialog__field-header">
                      <h3>{providerResourcesError}</h3>
                    </div>
                    <Button
                      callback={() => setProviderResourcesRefresh((refresh) => refresh + 1)}
                      disabled={providerResourcesLoading || Boolean(providerResourceUpdatingKey)}
                      icon={<RefreshCw aria-hidden="true" />}
                      label={<span>Retry</span>}
                      size="small"
                      theme="secondary"
                    />
                  </div>
                </SettingsSection>
              )}
              {providerResourcesLoading || (filteredAppGroups.length === 0 && !normalizedQuery) ? (
                <SettingsSection id="settings-providers-apps" title="Apps">
                  <div className="settings-dialog__field">
                    <div className="settings-dialog__field-header">
                      <h3>
                        {providerResourcesLoading ? 'Loading apps…' : 'No connected apps found'}
                      </h3>
                      {!providerResourcesLoading && (
                        <p>This environment did not report any installed apps.</p>
                      )}
                    </div>
                  </div>
                </SettingsSection>
              ) : (
                filteredAppGroups.map((group, appIndex) => {
                  const { resource } = group
                  const toggleId = `settings-provider-app-${appIndex}`
                  const updateKey = `app:${resource.providerId}:${resource.app.id}`
                  const appEnabled = isSettingsProviderAppGroupEnabled(group)

                  return (
                    <section
                      className="settings-dialog__section"
                      aria-label={resource.app.name}
                      key={updateKey}
                    >
                      {appIndex === 0 && (
                        <h2
                          className="settings-dialog__section-heading"
                          id="settings-providers-apps"
                        >
                          Apps
                        </h2>
                      )}
                      <div className="settings-dialog__section-cards">
                        <div className="settings-dialog__field">
                          <div className="settings-dialog__field-header">
                            <h3 id={toggleId}>{resource.app.name}</h3>
                            <p>
                              {resource.app.description}
                              {resource.app.enabled && !resource.app.callable
                                ? ' Not currently callable.'
                                : ''}
                            </p>
                          </div>
                          <Switch
                            className="settings-switch"
                            aria-labelledby={toggleId}
                            checked={appEnabled}
                            disabled={Boolean(providerResourceUpdatingKey)}
                            onChange={(event) =>
                              void handleProviderAppEnabledChange(
                                resource,
                                group.skills,
                                event.currentTarget.checked
                              )
                            }
                          />
                        </div>
                        {(normalizedQuery || shouldShowSettingsProviderAppSkills(group)) &&
                          group.visibleSkills.map((childSkill, skillIndex) =>
                            renderSkill(
                              childSkill,
                              `settings-provider-app-${appIndex}-skill-${skillIndex}`
                            )
                          )}
                      </div>
                    </section>
                  )
                })
              )}
              {(!normalizedQuery ||
                filteredStandaloneSkills.length > 0 ||
                providerResourcesLoading) && (
                <SettingsSection id="settings-providers-skills" title="Skills">
                  {!normalizedQuery && (
                    <div className="settings-dialog__field">
                      <div className="settings-dialog__field-header">
                        <h3 id="settings-provider-unparented-skills">All standalone skills</h3>
                        <p>
                          Enable or disable standalone skills. Plugin skills are controlled
                          individually.
                        </p>
                      </div>
                      <Switch
                        className="settings-switch"
                        aria-labelledby="settings-provider-unparented-skills"
                        checked={unparentedSkillsEnabled}
                        disabled={
                          providerResourcesLoading ||
                          standaloneToggleSkills.length === 0 ||
                          Boolean(providerResourceUpdatingKey)
                        }
                        onChange={(event) =>
                          void handleProviderSkillsEnabledChange(
                            standaloneToggleSkills,
                            event.currentTarget.checked
                          )
                        }
                      />
                    </div>
                  )}
                  {providerResourcesLoading ? (
                    <div className="settings-dialog__field">
                      <div className="settings-dialog__field-header">
                        <h3>Loading skills…</h3>
                      </div>
                    </div>
                  ) : filteredStandaloneSkills.length === 0 && !normalizedQuery ? (
                    <div className="settings-dialog__field">
                      <div className="settings-dialog__field-header">
                        <h3>No standalone skills found</h3>
                        <p>All reported skills belong to an app.</p>
                      </div>
                    </div>
                  ) : (
                    filteredStandaloneSkills.map((resource, index) =>
                      renderSkill(
                        resource,
                        `settings-provider-skill-${index}`,
                        !isClaudeMarketplaceSkill(resource)
                          ? ''
                          : resource.skill.enabled
                            ? ' Start a new Claude session after changing this plugin.'
                            : ' Turn on to install or enable its plugin. Start a new Claude session to use it.'
                      )
                    )
                  )}
                </SettingsSection>
              )}
            </>
          )
        }}
      </ProviderSettingsContent>
    </>
  )
}
