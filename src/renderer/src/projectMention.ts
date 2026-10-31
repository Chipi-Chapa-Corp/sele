import type { AppProject } from '../../shared/app'
import type { ComposerMention } from './composerMention'

export const getProjectMentionResults = (projects: AppProject[], query: string): AppProject[] => {
  const normalizedQuery = query.toLocaleLowerCase()
  return projects
    .flatMap((project) => {
      const name = project.name.toLocaleLowerCase()
      const cwd = project.cwd.toLocaleLowerCase()
      if (!name.includes(normalizedQuery) && !cwd.includes(normalizedQuery)) return []
      const rank =
        !normalizedQuery || name === normalizedQuery
          ? 0
          : name.startsWith(normalizedQuery)
            ? 1
            : name.includes(normalizedQuery)
              ? 2
              : 3
      return [{ project, rank }]
    })
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.project.name.localeCompare(right.project.name) ||
        left.project.cwd.localeCompare(right.project.cwd)
    )
    .slice(0, 50)
    .map(({ project }) => project)
}

export const replaceProjectMention = (
  message: string,
  mention: ComposerMention,
  project: Pick<AppProject, 'cwd'>
): { message: string; caret: number } => {
  // Use the project's main directory, even when it also has additional directories.
  const path = /[\s"\\]/.test(project.cwd) ? JSON.stringify(project.cwd) : project.cwd
  const suffix = message.slice(mention.end)
  const insertion = path + (suffix.startsWith(' ') ? '' : ' ')
  return {
    message: message.slice(0, mention.start) + insertion + suffix,
    caret: mention.start + insertion.length
  }
}
