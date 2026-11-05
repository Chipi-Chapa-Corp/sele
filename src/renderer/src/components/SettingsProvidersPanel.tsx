import { PackagePlus, RefreshCw, X } from 'lucide-react'
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
import type { SettingsPanelProps } from './SettingsPanel.types'
import { SettingsSkillPathAction } from './SettingsSkillPathAction'
import { Switch } from './Switch'

type SettingsProvidersPanelProps = Pick<
  SettingsPanelProps,
  | 'containerOptions'
  | 'handleCodexRecommendedPluginsChange'
  | 'handleProviderConnectionsChanged'
  | 'handleNewSessionContainerChange'
  | 'handleProviderAppEnabledChange'
  | 'handleProviderSkillEnabledChange'
  | 'handleProviderSkillsEnabledChange'
  | 'newSessionContainerValue'
  | 'newSessionProvider'
  | 'newSessionProviderOptions'
  | 'newSessionProviderValueContent'
  | 'newSessionSourceAvailabilityReady'
  | 'providerAccountUpdatingId'
  | 'providerResourceUpdatingKey'
  | 'providerResourcesError'
  | 'providerResourcesLoadState'
  | 'setEditingSshEnvironment'
  | 'setNewSessionProvider'
  | 'setProviderResourcesRefresh'
  | 'setSshEnvironmentDialogOpen'
  | 'setSshEnvironmentError'
  | 'settingsPanelSettings'
  | 'settingsProviderApps'
  | 'settingsProviderSkills'
  | 'sshEnvironmentError'
  | 'newSessionContainer'
>

export function SettingsProvidersPanel(props: SettingsProvidersPanelProps): React.ReactNode {
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
    setEditingSshEnvironment,
    setNewSessionProvider,
    setProviderResourcesRefresh,
    setSshEnvironmentDialogOpen,
    setSshEnvironmentError,
    settingsPanelSettings,
    settingsProviderApps,
    settingsProviderSkills,
    sshEnvironmentError
  } = props

  const providerResourcesLoading = providerResourcesLoadState !== 'ready'
  const { appGroups, unparentedSkills } = groupSettingsProviderResources(
    settingsProviderSkills,
    settingsProviderApps
  )
  const standaloneToggleSkills = unparentedSkills.filter(
    (resource) =>
      resource.providerId !== 'claude' ||
      !resource.skill.path.replace(/\\/g, '/').includes('/plugins/marketplaces/')
  )
  const unparentedSkillsEnabled = areAnySettingsProviderSkillsEnabled(standaloneToggleSkills)
  return (
    <section
      className="settings-dialog__panel"
      id="settings-panel-providers"
      role="tabpanel"
      aria-label="Provider settings"
    >
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
          menuActions={[
            ...(sshEnvironmentError
              ? [
                  {
                    id: 'provider-environment-error',
                    label: sshEnvironmentError,
                    title: sshEnvironmentError,
                    disabled: true,
                    icon: <X aria-hidden="true" />,
                    callback: () => {}
                  }
                ]
              : []),
            {
              id: 'provider-add-environment',
              label: 'Add environment',
              title: 'Add environment',
              icon: <PackagePlus aria-hidden="true" />,
              callback: () => {
                setEditingSshEnvironment(null)
                setSshEnvironmentError(null)
                setSshEnvironmentDialogOpen(true)
              }
            }
          ]}
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
            <section className="settings-dialog__section" aria-labelledby="settings-providers-ads">
              <h2 className="settings-dialog__section-heading" id="settings-providers-ads">
                Ads
              </h2>
              <div className="settings-dialog__section-cards">
                <div className="settings-dialog__field">
                  <div className="settings-dialog__field-header">
                    <h3 id="settings-provider-codex-recommended-plugins">
                      Show recommended plugins to agent
                    </h3>
                    <p>
                      Include the Codex list of available recommended plugins in new agent turns.
                    </p>
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
              </div>
            </section>
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
          const filteredAppGroups = appGroups
            .map((group) => {
              const appMatches = [group.resource.app.name, group.resource.app.description].some(
                (value) => value.toLocaleLowerCase().includes(normalizedQuery)
              )
              return {
                ...group,
                visibleSkills: appMatches ? group.skills : group.skills.filter(matchesSkill)
              }
            })
            .filter(
              (group) =>
                !normalizedQuery ||
                group.visibleSkills.length > 0 ||
                [group.resource.app.name, group.resource.app.description].some((value) =>
                  value.toLocaleLowerCase().includes(normalizedQuery)
                )
            )
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
                <section
                  className="settings-dialog__section"
                  aria-labelledby="settings-providers-status"
                >
                  <h2 className="settings-dialog__section-heading" id="settings-providers-status">
                    Status
                  </h2>
                  <div className="settings-dialog__section-cards">
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
                  </div>
                </section>
              )}
              {providerResourcesLoading ? (
                <section
                  className="settings-dialog__section"
                  aria-labelledby="settings-providers-apps"
                >
                  <h2 className="settings-dialog__section-heading" id="settings-providers-apps">
                    Apps
                  </h2>
                  <div className="settings-dialog__section-cards">
                    <div className="settings-dialog__field">
                      <div className="settings-dialog__field-header">
                        <h3>Loading apps…</h3>
                      </div>
                    </div>
                  </div>
                </section>
              ) : filteredAppGroups.length === 0 && !normalizedQuery ? (
                <section
                  className="settings-dialog__section"
                  aria-labelledby="settings-providers-apps"
                >
                  <h2 className="settings-dialog__section-heading" id="settings-providers-apps">
                    Apps
                  </h2>
                  <div className="settings-dialog__section-cards">
                    <div className="settings-dialog__field">
                      <div className="settings-dialog__field-header">
                        <h3>No connected apps found</h3>
                        <p>This environment did not report any installed apps.</p>
                      </div>
                    </div>
                  </div>
                </section>
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
                          group.visibleSkills.map((childSkill, skillIndex) => {
                            const skillToggleId = `settings-provider-app-${appIndex}-skill-${skillIndex}`

                            return (
                              <div className="settings-dialog__field" key={childSkill.skill.path}>
                                <div className="settings-dialog__field-header">
                                  <div className="settings-dialog__skill-title">
                                    <h3 id={skillToggleId}>{childSkill.skill.name}</h3>
                                    <SettingsSkillPathAction path={childSkill.skill.path} />
                                  </div>
                                  <p>{getSettingsSkillDescription(childSkill.skill)}</p>
                                </div>
                                <Switch
                                  className="settings-switch"
                                  aria-labelledby={skillToggleId}
                                  checked={childSkill.skill.enabled}
                                  disabled={Boolean(providerResourceUpdatingKey)}
                                  onChange={(event) =>
                                    void handleProviderSkillEnabledChange(
                                      childSkill,
                                      event.currentTarget.checked
                                    )
                                  }
                                />
                              </div>
                            )
                          })}
                      </div>
                    </section>
                  )
                })
              )}
              {(!normalizedQuery ||
                filteredStandaloneSkills.length > 0 ||
                providerResourcesLoading) && (
                <section
                  className="settings-dialog__section"
                  aria-labelledby="settings-providers-skills"
                >
                  <h2 className="settings-dialog__section-heading" id="settings-providers-skills">
                    Skills
                  </h2>
                  <div className="settings-dialog__section-cards">
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
                      filteredStandaloneSkills.map((resource, index) => {
                        const toggleId = `settings-provider-skill-${index}`

                        return (
                          <div className="settings-dialog__field" key={resource.skill.path}>
                            <div className="settings-dialog__field-header">
                              <div className="settings-dialog__skill-title">
                                <h3 id={toggleId}>{resource.skill.name}</h3>
                                <SettingsSkillPathAction path={resource.skill.path} />
                              </div>
                              <p>
                                {getSettingsSkillDescription(resource.skill)}
                                {resource.providerId === 'claude' &&
                                resource.skill.path
                                  .replace(/\\/g, '/')
                                  .includes('/plugins/marketplaces/')
                                  ? resource.skill.enabled
                                    ? ' Start a new Claude session after changing this plugin.'
                                    : ' Turn on to install or enable its plugin. Start a new Claude session to use it.'
                                  : ''}
                              </p>
                            </div>
                            <Switch
                              className="settings-switch"
                              aria-labelledby={toggleId}
                              checked={resource.skill.enabled}
                              disabled={Boolean(providerResourceUpdatingKey)}
                              onChange={(event) =>
                                void handleProviderSkillEnabledChange(
                                  resource,
                                  event.currentTarget.checked
                                )
                              }
                            />
                          </div>
                        )
                      })
                    )}
                  </div>
                </section>
              )}
            </>
          )
        }}
      </ProviderSettingsContent>
    </section>
  )
}
