import type { ProviderApp, ProviderId, ProviderSkill } from './provider'

export type SettingsProviderSkill = {
  providerId: ProviderId
  providerIds: ProviderId[]
  skill: ProviderSkill
}

export type SettingsProviderApp = {
  providerId: ProviderId
  app: ProviderApp
}

export type SettingsProviderAppGroup = {
  resource: SettingsProviderApp
  skills: SettingsProviderSkill[]
}

const normalizeProviderResourceName = (value: string): string =>
  value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '')

const getQualifiedSkillSourceName = (skillName: string): string | null => {
  const separatorIndex = skillName.indexOf(':')
  return separatorIndex > 0 ? skillName.slice(0, separatorIndex) : null
}

export const providerAppOwnsSkill = (
  app: Pick<ProviderApp, 'name' | 'skillNames'>,
  skill: Pick<ProviderSkill, 'name'>
): boolean => {
  if (app.skillNames?.includes(skill.name)) return true

  const sourceName = getQualifiedSkillSourceName(skill.name)
  if (!sourceName) return false

  const normalizedSourceName = normalizeProviderResourceName(sourceName)
  const normalizedAppName = normalizeProviderResourceName(app.name)
  if (!normalizedSourceName || !normalizedAppName) return false

  return (
    normalizedSourceName === normalizedAppName ||
    (normalizedSourceName.length >= 4 &&
      (normalizedAppName.includes(normalizedSourceName) ||
        normalizedSourceName.includes(normalizedAppName)))
  )
}

export const isSettingsProviderAppGroupEnabled = (group: SettingsProviderAppGroup): boolean =>
  group.resource.app.enabled || group.skills.some((resource) => resource.skill.enabled)

export const shouldShowSettingsProviderAppSkills = (group: SettingsProviderAppGroup): boolean =>
  isSettingsProviderAppGroupEnabled(group)

export const areAnySettingsProviderSkillsEnabled = (skills: SettingsProviderSkill[]): boolean =>
  skills.some((resource) => resource.skill.enabled)

export const resolveSettingsProviderSkillUpdates = (
  requestedResources: SettingsProviderSkill[],
  updatedSkills: ProviderSkill[],
  enabled: boolean
): { skillsByPath: Map<string, ProviderSkill>; failedCount: number } => {
  const updatedSkillsByPath = new Map(updatedSkills.map((skill) => [skill.path, skill]))
  const skillsByPath = new Map<string, ProviderSkill>()
  let failedCount = 0

  requestedResources.forEach((resource) => {
    const updatedSkill = updatedSkillsByPath.get(resource.skill.path) ?? resource.skill
    skillsByPath.set(resource.skill.path, updatedSkill)
    if (updatedSkill.enabled !== enabled) failedCount += 1
  })

  return { skillsByPath, failedCount }
}

export const groupSettingsProviderResources = (
  skills: SettingsProviderSkill[],
  apps: SettingsProviderApp[]
): { appGroups: SettingsProviderAppGroup[]; unparentedSkills: SettingsProviderSkill[] } => {
  const claimedSkillPaths = new Set<string>()
  const appGroups = apps.map((resource) => {
    const childSkills = skills.filter((skillResource) => {
      if (
        claimedSkillPaths.has(skillResource.skill.path) ||
        !skillResource.providerIds.includes(resource.providerId) ||
        !providerAppOwnsSkill(resource.app, skillResource.skill)
      ) {
        return false
      }

      claimedSkillPaths.add(skillResource.skill.path)
      return true
    })

    return { resource, skills: childSkills }
  })

  return {
    appGroups,
    unparentedSkills: skills.filter((resource) => !claimedSkillPaths.has(resource.skill.path))
  }
}
