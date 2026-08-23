export type CollapsedProjectGroups = Record<string, boolean>

export const collapsedProjectGroupsStorageKey = 'sele:collapsed-project-groups:v1'

const maxStoredCollapsedProjectGroups = 1_000
const maxProjectGroupKeyLength = 8_192

const isProjectGroupKey = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.startsWith('cwd:') &&
  value.length > 'cwd:'.length &&
  value.length <= maxProjectGroupKeyLength

export const parseStoredCollapsedProjectGroups = (value: string | null): CollapsedProjectGroups => {
  if (!value) return {}

  try {
    const parsedValue = JSON.parse(value) as unknown
    if (!Array.isArray(parsedValue)) return {}

    const collapsedGroups: CollapsedProjectGroups = {}
    parsedValue.slice(0, maxStoredCollapsedProjectGroups).forEach((groupKey) => {
      if (isProjectGroupKey(groupKey)) collapsedGroups[groupKey] = true
    })
    return collapsedGroups
  } catch {
    return {}
  }
}

export const readStoredCollapsedProjectGroups = (): CollapsedProjectGroups => {
  try {
    return parseStoredCollapsedProjectGroups(
      window.localStorage.getItem(collapsedProjectGroupsStorageKey)
    )
  } catch {
    return {}
  }
}

export const writeStoredCollapsedProjectGroups = (
  collapsedGroups: Readonly<CollapsedProjectGroups>
): void => {
  try {
    const collapsedProjectGroupKeys = Object.entries(collapsedGroups)
      .filter(([groupKey, collapsed]) => collapsed && isProjectGroupKey(groupKey))
      .map(([groupKey]) => groupKey)
      .slice(0, maxStoredCollapsedProjectGroups)

    if (collapsedProjectGroupKeys.length === 0) {
      window.localStorage.removeItem(collapsedProjectGroupsStorageKey)
      return
    }

    window.localStorage.setItem(
      collapsedProjectGroupsStorageKey,
      JSON.stringify(collapsedProjectGroupKeys)
    )
  } catch {
    // Sidebar state is non-critical; ignore unavailable storage.
  }
}
