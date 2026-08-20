import type { AppGitFileChange } from '../shared/app'

export const maxVisibleUntrackedGitFiles = 200

export const limitVisibleUntrackedGitFiles = (
  files: AppGitFileChange[]
): { files: AppGitFileChange[]; untrackedFilesHiddenForPerformance: boolean } => {
  const untrackedFileCount = files.filter((file) => file.kind === 'untracked').length
  if (untrackedFileCount <= maxVisibleUntrackedGitFiles) {
    return { files, untrackedFilesHiddenForPerformance: false }
  }

  return {
    files: files.filter((file) => file.kind !== 'untracked'),
    untrackedFilesHiddenForPerformance: true
  }
}
