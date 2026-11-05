import type { CSSProperties } from 'react'
import type { AppFileTreeFile } from '../../../shared/app'
import type {
  ProviderApp,
  ProviderId,
  ProviderSkill,
  ProviderSkillInput
} from '../../../shared/provider'
import { getComposerMentionAtCaret } from '../composerMention'
import { toCssRem } from '../cssUnits'
import { maxSelectedSkillCount } from './composerLimits'
const maxFileMentionResultCount = 50
export type FileMention = {
  start: number
  end: number
  query: string
}

export type SkillMention = {
  start: number
  end: number
  query: string
}

export type ProjectFileCache = {
  cwd: string
  files: AppFileTreeFile[]
  repositoryRoot: string
  sourceKey: string
}

export type ComposerCache = {
  cwd: string | null
  providerId: ProviderId
  providerResourcesRevision: number
  sourceKey: string
  skills: ProviderSkill[]
  apps: ProviderApp[]
}

export const isComposerCacheCurrent = (
  cache: ComposerCache | null,
  providerId: ProviderId,
  cwd: string | null,
  sourceKey: string,
  providerResourcesRevision: number
): cache is ComposerCache =>
  cache?.providerId === providerId &&
  cache.cwd === cwd &&
  cache.sourceKey === sourceKey &&
  cache.providerResourcesRevision === providerResourcesRevision

export type ComposerResult =
  | { kind: 'skill'; skill: ProviderSkill }
  | { kind: 'app'; app: ProviderApp }
export type MentionMenuStyle = CSSProperties & {
  '--menu-surface-max-height': string
}

export const getMentionMenuStyle = (anchorRect: DOMRect): MentionMenuStyle => {
  const viewportInset = 9.6
  const menuOffset = 6.4
  const maxMenuHeight = Math.min(336, window.innerHeight * 0.56)
  const menuWidth = Math.min(416, anchorRect.width, window.innerWidth - viewportInset * 2)
  const maxLeft = Math.max(viewportInset, window.innerWidth - menuWidth - viewportInset)
  const spaceAbove = Math.max(0, anchorRect.top - menuOffset - viewportInset)
  const spaceBelow = Math.max(
    0,
    window.innerHeight - anchorRect.bottom - menuOffset - viewportInset
  )
  const openUp = spaceAbove >= spaceBelow
  const availableHeight = Math.min(maxMenuHeight, openUp ? spaceAbove : spaceBelow)
  const menuStyle: MentionMenuStyle = {
    '--menu-surface-max-height': toCssRem(availableHeight),
    left: toCssRem(Math.min(Math.max(viewportInset, anchorRect.left), maxLeft)),
    width: toCssRem(menuWidth)
  }

  if (openUp) {
    menuStyle.bottom = toCssRem(window.innerHeight - anchorRect.top + menuOffset)
  } else {
    menuStyle.top = toCssRem(anchorRect.bottom + menuOffset)
  }

  return menuStyle
}

export const getFileMentionAtCaret = (message: string, caret: number): FileMention | null => {
  return getComposerMentionAtCaret(message, caret, '@')
}

export const getSkillMentionAtCaret = (message: string, caret: number): SkillMention | null => {
  return getComposerMentionAtCaret(message, caret, '$')
}

export const getMentionFileName = (path: string): string => path.split('/').pop() || path

export const getMentionAttachmentPath = (repositoryRoot: string, path: string): string => {
  const separator = repositoryRoot.includes('\\') ? '\\' : '/'
  return `${repositoryRoot.replace(/[\\/]+$/, '')}${separator}${path.replace(/[\\/]/g, separator)}`
}

export const getFileMentionResults = (
  files: AppFileTreeFile[],
  query: string
): AppFileTreeFile[] => {
  const normalizedQuery = query.toLocaleLowerCase()

  return files
    .flatMap((file) => {
      const normalizedPath = file.path.toLocaleLowerCase()
      const normalizedName = getMentionFileName(file.path).toLocaleLowerCase()
      if (normalizedQuery && !normalizedPath.includes(normalizedQuery)) return []

      const rank =
        !normalizedQuery || normalizedName === normalizedQuery
          ? 0
          : normalizedName.startsWith(normalizedQuery)
            ? 1
            : normalizedPath.startsWith(normalizedQuery)
              ? 2
              : normalizedName.includes(normalizedQuery)
                ? 3
                : 4

      return [{ file, rank }]
    })
    .sort(
      (firstResult, secondResult) =>
        firstResult.rank - secondResult.rank ||
        firstResult.file.path.localeCompare(secondResult.file.path)
    )
    .slice(0, maxFileMentionResultCount)
    .map((result) => result.file)
}

export const getComposerResultLabel = (result: ComposerResult): string =>
  result.kind === 'skill' ? result.skill.displayName || result.skill.name : result.app.name

export const getFirstSentence = (value: string): string => {
  const normalizedValue = value.replace(/\s+/g, ' ').trim()
  if (!normalizedValue) return ''

  return /^.*?[.!?](?=\s|$)/.exec(normalizedValue)?.[0] ?? normalizedValue
}

export const getSkillSummary = (skill: ProviderSkill): string =>
  getFirstSentence(skill.description || skill.shortDescription || '')

export const getComposerResults = (
  skills: ProviderSkill[],
  apps: ProviderApp[],
  query: string
): ComposerResult[] => {
  const normalizedQuery = query.toLocaleLowerCase()

  return [
    ...skills.flatMap((skill): Array<{ result: ComposerResult; rank: number }> => {
      const normalizedName = skill.name.toLocaleLowerCase()
      const normalizedDisplayName = skill.displayName?.toLocaleLowerCase() ?? ''
      const normalizedDescription = (
        skill.shortDescription || skill.description
      ).toLocaleLowerCase()
      if (
        normalizedQuery &&
        !normalizedName.includes(normalizedQuery) &&
        !normalizedDisplayName.includes(normalizedQuery) &&
        !normalizedDescription.includes(normalizedQuery)
      ) {
        return []
      }

      const rank =
        !normalizedQuery || normalizedName === normalizedQuery
          ? 0
          : normalizedName.startsWith(normalizedQuery)
            ? 1
            : normalizedDisplayName.startsWith(normalizedQuery)
              ? 2
              : normalizedName.includes(normalizedQuery)
                ? 3
                : 4

      return [{ result: { kind: 'skill', skill }, rank }]
    }),
    ...apps.flatMap((app): Array<{ result: ComposerResult; rank: number }> => {
      const normalizedName = app.name.toLocaleLowerCase()
      const normalizedDescription = app.description.toLocaleLowerCase()
      if (
        normalizedQuery &&
        !normalizedName.includes(normalizedQuery) &&
        !normalizedDescription.includes(normalizedQuery)
      ) {
        return []
      }

      const rank =
        !normalizedQuery || normalizedName === normalizedQuery
          ? 0
          : normalizedName.startsWith(normalizedQuery)
            ? 1
            : normalizedName.includes(normalizedQuery)
              ? 2
              : 3

      return [{ result: { kind: 'app', app }, rank }]
    })
  ]
    .sort(
      (firstResult, secondResult) =>
        firstResult.rank - secondResult.rank ||
        getComposerResultLabel(firstResult.result).localeCompare(
          getComposerResultLabel(secondResult.result)
        )
    )
    .map((result) => result.result)
}

export const escapeRegularExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const getSelectedSkillInputs = (
  message: string,
  skills: ProviderSkill[]
): ProviderSkillInput[] =>
  skills
    .flatMap((skill) =>
      new RegExp(
        `(^|[\\s([{])\\$${escapeRegularExpression(skill.name)}(?=$|[\\s)\\]},.!?;:])`
      ).test(message)
        ? [{ name: skill.name, path: skill.path }]
        : []
    )
    .slice(0, maxSelectedSkillCount)
