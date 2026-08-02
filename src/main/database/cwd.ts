import type { ProviderChatCwdKind, ProviderChatCwdMetadata } from '../../shared/provider'
import { getDatabase } from './sqlite'

const isProviderChatCwdKind = (value: unknown): value is ProviderChatCwdKind =>
  value === 'directory' || value === 'gitWorktree'

export const getStoredCwdMetadata = async (
  cwd: string
): Promise<ProviderChatCwdMetadata | null> => {
  const db = await getDatabase()
  const row = await db
    .selectFrom('cwd_metadata')
    .select(['kind', 'project_cwd', 'branch_name', 'worktree_base_branch_name'])
    .where('cwd', '=', cwd)
    .executeTakeFirst()

  if (row?.branch_name == null) return null

  return isProviderChatCwdKind(row?.kind)
    ? {
        kind: row.kind,
        projectCwd: row.project_cwd,
        branchName: row.branch_name || null,
        worktreeBaseBranchName: row.worktree_base_branch_name || null
      }
    : null
}

export const setStoredCwdMetadata = async (
  cwd: string,
  metadata: ProviderChatCwdMetadata
): Promise<void> => {
  const db = await getDatabase()

  await db
    .insertInto('cwd_metadata')
    .values({
      cwd,
      kind: metadata.kind,
      project_cwd: metadata.projectCwd,
      branch_name: metadata.branchName ?? '',
      worktree_base_branch_name: metadata.worktreeBaseBranchName ?? ''
    })
    .onConflict((conflict) =>
      conflict.column('cwd').doUpdateSet({
        kind: metadata.kind,
        project_cwd: metadata.projectCwd,
        branch_name: metadata.branchName ?? '',
        worktree_base_branch_name: metadata.worktreeBaseBranchName ?? ''
      })
    )
    .execute()
}
