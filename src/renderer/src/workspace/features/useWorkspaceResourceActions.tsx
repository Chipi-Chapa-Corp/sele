import type { ProviderId } from '../../../../shared/provider'
import {
  resolveSettingsProviderSkillUpdates,
  type SettingsProviderApp,
  type SettingsProviderSkill
} from '../../../../shared/providerOwnership'
import { normalizeContainerTarget } from '../../containerSelection'
import { providerApi } from '../../providerApi'
import { getErrorMessage } from '../chatControllerUtils'
import type { WorkspaceSession } from '../useWorkspaceSelection'

export function useWorkspaceResourceActions({
  providerState,
  sourceState,
  settings,
  resourceRefresh
}: WorkspaceSession) {
  const handleProviderSkillEnabledChange = async (
    resource: SettingsProviderSkill,
    enabled: boolean
  ): Promise<void> => {
    const updateKey = `skill:${resource.skill.path}`
    if (providerState.providerResourceUpdatingKey || resource.skill.enabled === enabled) return
    const container = normalizeContainerTarget(sourceState.newSessionContainer)

    providerState.setProviderResourceUpdatingKey(updateKey)
    providerState.setProviderResourcesError(null)
    providerState.setSettingsProviderSkills((currentResources) =>
      currentResources.map((currentResource) =>
        currentResource.skill.path === resource.skill.path
          ? { ...currentResource, skill: { ...currentResource.skill, enabled } }
          : currentResource
      )
    )
    try {
      await providerApi.setSkillEnabled(
        resource.providerId,
        resource.skill.path,
        enabled,
        settings.settingsProjectCwd,
        {
          container,
          deferRefresh: true,
          knownSkills: [resource.skill]
        }
      )
    } catch (error) {
      console.error('Unable to update a provider skill.', error)
      providerState.setSettingsProviderSkills((currentResources) =>
        currentResources.map((currentResource) =>
          currentResource.skill.path === resource.skill.path
            ? {
                ...currentResource,
                skill: { ...currentResource.skill, enabled: resource.skill.enabled }
              }
            : currentResource
        )
      )
      providerState.setProviderResourcesError(getErrorMessage(error, 'Unable to update skill.'))
    } finally {
      resourceRefresh.queueDeferredProviderResourceRefresh({
        providerId: resource.providerId,
        cwd: settings.settingsProjectCwd,
        container
      })
      providerState.setProviderResourceUpdatingKey(null)
    }
  }

  const handleProviderAppEnabledChange = async (
    resource: SettingsProviderApp,
    childSkills: SettingsProviderSkill[],
    enabled: boolean
  ): Promise<void> => {
    const updateKey = `app:${resource.providerId}:${resource.app.id}`
    const childSkillPaths = new Set(childSkills.map((childSkill) => childSkill.skill.path))
    const container = normalizeContainerTarget(sourceState.newSessionContainer)
    if (
      providerState.providerResourceUpdatingKey ||
      (resource.app.enabled === enabled &&
        childSkills.every((childSkill) => childSkill.skill.enabled === enabled))
    ) {
      return
    }

    providerState.setProviderResourceUpdatingKey(updateKey)
    providerState.setProviderResourcesError(null)
    providerState.setSettingsProviderApps((currentResources) =>
      currentResources.map((currentResource) =>
        currentResource.providerId === resource.providerId &&
        currentResource.app.id === resource.app.id
          ? { ...currentResource, app: { ...currentResource.app, enabled } }
          : currentResource
      )
    )
    providerState.setSettingsProviderSkills((currentResources) =>
      currentResources.map((currentResource) =>
        childSkillPaths.has(currentResource.skill.path)
          ? { ...currentResource, skill: { ...currentResource.skill, enabled } }
          : currentResource
      )
    )
    try {
      await providerApi.setAppEnabled(resource.providerId, resource.app.id, enabled, {
        container,
        deferRefresh: true,
        knownApp: resource.app,
        knownSkills: childSkills.map((childSkill) => childSkill.skill)
      })
    } catch (error) {
      console.error('Unable to update a provider app.', error)
      const previousChildState = new Map(
        childSkills.map((childSkill) => [childSkill.skill.path, childSkill.skill.enabled])
      )
      providerState.setSettingsProviderApps((currentResources) =>
        currentResources.map((currentResource) =>
          currentResource.providerId === resource.providerId &&
          currentResource.app.id === resource.app.id
            ? {
                ...currentResource,
                app: { ...currentResource.app, enabled: resource.app.enabled }
              }
            : currentResource
        )
      )
      providerState.setSettingsProviderSkills((currentResources) =>
        currentResources.map((currentResource) => {
          const previousEnabled = previousChildState.get(currentResource.skill.path)
          return previousEnabled == null
            ? currentResource
            : {
                ...currentResource,
                skill: { ...currentResource.skill, enabled: previousEnabled }
              }
        })
      )
      providerState.setProviderResourcesError(getErrorMessage(error, 'Unable to update app.'))
    } finally {
      resourceRefresh.queueDeferredProviderResourceRefresh({
        providerId: resource.providerId,
        cwd: settings.settingsProjectCwd,
        container
      })
      providerState.setProviderResourceUpdatingKey(null)
    }
  }

  const handleProviderSkillsEnabledChange = async (
    resources: SettingsProviderSkill[],
    enabled: boolean
  ): Promise<void> => {
    const changedResources = resources.filter((resource) => resource.skill.enabled !== enabled)
    if (providerState.providerResourceUpdatingKey || changedResources.length === 0) return

    const updateKey = 'skills:unparented'
    const changedSkillPaths = new Set(changedResources.map((resource) => resource.skill.path))
    const previousSkillState = new Map(
      changedResources.map((resource) => [resource.skill.path, resource.skill.enabled])
    )
    const container = normalizeContainerTarget(sourceState.newSessionContainer)
    const pathsByProvider = new Map<ProviderId, string[]>()
    changedResources.forEach((resource) => {
      pathsByProvider.set(resource.providerId, [
        ...(pathsByProvider.get(resource.providerId) ?? []),
        resource.skill.path
      ])
    })

    providerState.setProviderResourceUpdatingKey(updateKey)
    providerState.setProviderResourcesError(null)
    providerState.setSettingsProviderSkills((currentResources) =>
      currentResources.map((currentResource) =>
        changedSkillPaths.has(currentResource.skill.path)
          ? { ...currentResource, skill: { ...currentResource.skill, enabled } }
          : currentResource
      )
    )
    try {
      const updatedSkillLists = await Promise.all(
        Array.from(pathsByProvider, ([providerId, paths]) =>
          providerApi.setSkillsEnabled(providerId, paths, enabled, settings.settingsProjectCwd, {
            container,
            deferRefresh: true,
            knownSkills: changedResources
              .filter((resource) => resource.providerId === providerId)
              .map((resource) => resource.skill)
          })
        )
      )
      const updateResolution = resolveSettingsProviderSkillUpdates(
        changedResources,
        updatedSkillLists.flat(),
        enabled
      )
      providerState.setSettingsProviderSkills((currentResources) =>
        currentResources.map((currentResource) => {
          const updatedSkill = updateResolution.skillsByPath.get(currentResource.skill.path)
          return updatedSkill ? { ...currentResource, skill: updatedSkill } : currentResource
        })
      )
      if (updateResolution.failedCount > 0) {
        providerState.setProviderResourcesError(
          `${updateResolution.failedCount} ${updateResolution.failedCount === 1 ? 'skill' : 'skills'} could not be updated.`
        )
      }
    } catch (error) {
      console.error('Unable to update provider skills.', error)
      providerState.setSettingsProviderSkills((currentResources) =>
        currentResources.map((currentResource) => {
          const previousEnabled = previousSkillState.get(currentResource.skill.path)
          return previousEnabled == null
            ? currentResource
            : {
                ...currentResource,
                skill: { ...currentResource.skill, enabled: previousEnabled }
              }
        })
      )
      providerState.setProviderResourcesError(getErrorMessage(error, 'Unable to update skills.'))
    } finally {
      pathsByProvider.forEach((_, providerId) =>
        resourceRefresh.queueDeferredProviderResourceRefresh({
          providerId,
          cwd: settings.settingsProjectCwd,
          container
        })
      )
      providerState.setProviderResourceUpdatingKey(null)
    }
  }
  return {
    handleProviderSkillEnabledChange,
    handleProviderAppEnabledChange,
    handleProviderSkillsEnabledChange
  }
}
