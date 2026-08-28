import { appGitCommitMessageMaxFiles, type AppGitCommitMessageFileChange } from '../shared/app.ts'

const parseLineCount = (value: string): number | null => {
  if (value === '-') return null

  const count = Number.parseInt(value, 10)
  return Number.isFinite(count) && count >= 0 ? count : null
}

export const parseGitNumstat = (output: string): AppGitCommitMessageFileChange[] => {
  const fields = output.split('\0')
  const files: AppGitCommitMessageFileChange[] = []

  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index]
    if (!entry) continue

    const firstTab = entry.indexOf('\t')
    const secondTab = firstTab < 0 ? -1 : entry.indexOf('\t', firstTab + 1)
    if (firstTab < 0 || secondTab < 0) continue

    const additions = parseLineCount(entry.slice(0, firstTab))
    const deletions = parseLineCount(entry.slice(firstTab + 1, secondTab))
    const inlinePath = entry.slice(secondTab + 1)

    if (inlinePath) {
      files.push({ path: inlinePath, additions, deletions })
      continue
    }

    const previousPath = fields[index + 1]
    const path = fields[index + 2]
    index += 2
    if (!path) continue

    files.push({
      path,
      previousPath: previousPath || null,
      additions,
      deletions
    })
  }

  return files
}

const getChangedLineCount = (file: AppGitCommitMessageFileChange): number =>
  (file.additions ?? 0) + (file.deletions ?? 0)

export const summarizeGitNumstat = (
  output: string,
  maxFiles = appGitCommitMessageMaxFiles
): {
  fileCount: number
  files: AppGitCommitMessageFileChange[]
  totalChangedLines: number
} => {
  const allFiles = parseGitNumstat(output)
  const files = [...allFiles]
    .sort(
      (left, right) =>
        getChangedLineCount(right) - getChangedLineCount(left) ||
        left.path.localeCompare(right.path)
    )
    .slice(0, maxFiles)

  return {
    fileCount: allFiles.length,
    files,
    totalChangedLines: allFiles.reduce((total, file) => total + getChangedLineCount(file), 0)
  }
}
