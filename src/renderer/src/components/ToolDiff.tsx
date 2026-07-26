import { memo } from 'react'
import type { ProviderFileDiff } from '../../../shared/provider'
import { UnifiedDiff } from './UnifiedDiff'

const getDisplayPath = (path: string, projectCwd: string | null | undefined): string => {
  const normalizedPath = path.replace(/\\/g, '/')
  const rawProjectCwd = projectCwd?.trim().replace(/\\/g, '/')
  const normalizedProjectCwd =
    rawProjectCwd === '/' || /^[A-Za-z]:\/$/.test(rawProjectCwd ?? '')
      ? rawProjectCwd
      : rawProjectCwd?.replace(/\/+$/, '')

  if (!normalizedProjectCwd) return normalizedPath

  const caseInsensitive = /^(?:[A-Za-z]:\/|\/\/)/.test(normalizedProjectCwd)
  const comparisonPath = caseInsensitive ? normalizedPath.toLocaleLowerCase() : normalizedPath
  const comparisonProjectCwd = caseInsensitive
    ? normalizedProjectCwd.toLocaleLowerCase()
    : normalizedProjectCwd

  if (comparisonPath === comparisonProjectCwd) {
    return normalizedPath.split('/').filter(Boolean).at(-1) ?? normalizedPath
  }

  const projectPrefix = comparisonProjectCwd.endsWith('/')
    ? comparisonProjectCwd
    : `${comparisonProjectCwd}/`
  if (!comparisonPath.startsWith(projectPrefix)) return normalizedPath

  return normalizedPath.slice(projectPrefix.length)
}

type ToolDiffProps = {
  fileDiff: ProviderFileDiff
  projectCwd?: string | null
}

const ToolDiffComponent = ({ fileDiff, projectCwd }: ToolDiffProps): React.JSX.Element => {
  const displayPath = getDisplayPath(fileDiff.path, projectCwd)

  return (
    <section className="chat-detail__diff-section">
      <div className="chat-detail__diff-path">{displayPath}</div>
      <div className="chat-detail__diff-scroll">
        <UnifiedDiff className="chat-detail__diff" fileDiff={fileDiff} />
      </div>
    </section>
  )
}

export const ToolDiff = memo(
  ToolDiffComponent,
  (first, second) =>
    first.projectCwd === second.projectCwd &&
    first.fileDiff.path === second.fileDiff.path &&
    first.fileDiff.kind === second.fileDiff.kind &&
    first.fileDiff.diff === second.fileDiff.diff
)
