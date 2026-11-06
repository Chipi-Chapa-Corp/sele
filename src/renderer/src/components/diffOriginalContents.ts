import type { ProviderFileDiff } from '../../../shared/provider'
import { parseDiff } from 'react-diff-view'
import { toUnifiedDiff } from '../unifiedDiffRendering'

export const getOriginalContents = (
  fileDiff: ProviderFileDiff,
  currentContents: string
): string => {
  const unifiedDiff = toUnifiedDiff(fileDiff)
  if (!unifiedDiff) return fileDiff.kind === 'create' ? '' : currentContents

  try {
    const file = parseDiff(unifiedDiff)[0]
    if (!file || file.hunks.length === 0) {
      return fileDiff.kind === 'create' ? '' : currentContents
    }

    const oldLines = file.hunks.flatMap((hunk) =>
      hunk.changes.flatMap((change) => (change.type === 'insert' ? [] : [change.content]))
    )
    const contents = oldLines.join('\n')
    return file.oldEndingNewLine && oldLines.length > 0 ? `${contents}\n` : contents
  } catch (error) {
    console.error('[caught:UnifiedDiff:getOriginalContents]', error)
    return fileDiff.kind === 'create' ? '' : currentContents
  }
}
