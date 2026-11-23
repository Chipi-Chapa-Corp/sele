import { record } from './elicitation.ts'
import type { ProviderMcpToolApproval } from './provider'

type Operation = {
  title: string
  action?: string
  target?: 'repository' | 'issue' | 'comment' | 'review' | 'thread'
  facts?: string[]
  body?: string
}

const operations: Record<string, Operation> = {
  'github.create_pull_request': {
    title: 'Create pull request',
    action: 'Create PR',
    target: 'repository',
    facts: ['issue', 'maintainer_can_modify'],
    body: 'body'
  },
  'github.merge_pull_request': { title: 'Merge pull request', action: 'Merge PR' },
  'github.enable_auto_merge': { title: 'Enable auto-merge' },
  'github.update_pull_request': {
    title: 'Update pull request',
    action: 'Update PR',
    facts: ['title', 'base_branch', 'maintainer_can_modify'],
    body: 'body'
  },
  'github.mark_pull_request_ready_for_review': {
    title: 'Mark ready for review',
    action: 'Mark ready'
  },
  'github.convert_pull_request_to_draft': {
    title: 'Convert pull request to draft',
    action: 'Convert to draft'
  },
  'github.add_review_to_pr': { title: 'Submit PR review', action: 'Submit review', body: 'review' },
  'github.dismiss_pull_request_review': {
    title: 'Dismiss review',
    target: 'review',
    body: 'message'
  },
  'github.request_pull_request_reviewers': {
    title: 'Request reviewers',
    facts: ['reviewers', 'team_reviewers']
  },
  'github.remove_pull_request_reviewers': {
    title: 'Remove review requests',
    facts: ['reviewers', 'team_reviewers']
  },
  'github.resolve_review_thread': { title: 'Resolve review thread', target: 'thread' },
  'github.unresolve_review_thread': { title: 'Reopen review thread', target: 'thread' },
  'github.reply_to_review_comment': {
    title: 'Reply to review comment',
    action: 'Post reply',
    facts: ['comment_id'],
    body: 'comment'
  },
  'github.add_comment_to_issue': {
    title: 'Post PR comment',
    action: 'Post comment',
    body: 'comment'
  },
  'github.update_issue_comment': {
    title: 'Edit conversation comment',
    action: 'Save comment',
    target: 'comment',
    body: 'comment'
  },
  'github.update_review_comment': {
    title: 'Edit inline review comment',
    action: 'Save comment',
    target: 'comment',
    body: 'comment'
  },
  'github.lock_issue_conversation': {
    title: 'Lock conversation',
    target: 'issue',
    facts: ['lock_reason']
  },
  'github.unlock_issue_conversation': { title: 'Unlock conversation', target: 'issue' },
  'github.label_pr': { title: 'Add PR label', facts: ['label'] },
  'github.add_issue_labels': { title: 'Add labels', target: 'issue', facts: ['labels'] },
  'github.remove_issue_label': { title: 'Remove label', target: 'issue', facts: ['label'] },
  'github.add_issue_assignees': { title: 'Add assignees', target: 'issue', facts: ['assignees'] },
  'github.remove_issue_assignees': {
    title: 'Remove assignees',
    target: 'issue',
    facts: ['assignees']
  },
  'github.add_reaction_to_pr': {
    title: 'React to pull request',
    action: 'Add reaction',
    facts: ['reaction']
  },
  'github.remove_reaction_from_pr': {
    title: 'Remove PR reaction',
    action: 'Remove reaction',
    facts: ['reaction_id']
  },
  'github.add_reaction_to_issue_comment': {
    title: 'React to conversation comment',
    action: 'Add reaction',
    target: 'comment',
    facts: ['reaction']
  },
  'github.remove_reaction_from_issue_comment': {
    title: 'Remove conversation comment reaction',
    action: 'Remove reaction',
    target: 'comment',
    facts: ['reaction_id']
  },
  'github.add_reaction_to_pr_review_comment': {
    title: 'React to inline comment',
    action: 'Add reaction',
    target: 'comment',
    facts: ['reaction']
  },
  'github.remove_reaction_from_pr_review_comment': {
    title: 'Remove inline comment reaction',
    action: 'Remove reaction',
    target: 'comment',
    facts: ['reaction_id']
  }
}

const labels: Record<string, string> = {
  title: 'New title',
  base_branch: 'New base branch',
  maintainer_can_modify: 'Allow maintainer edits',
  issue: 'From issue',
  comment_id: 'In reply to',
  lock_reason: 'Lock reason',
  team_reviewers: 'Teams'
}

const reactions: Record<string, string> = {
  '+1': '👍 Thumbs up',
  '-1': '👎 Thumbs down',
  laugh: '😄 Laugh',
  hooray: '🎉 Hooray',
  confused: '😕 Confused',
  heart: '❤️ Heart',
  rocket: '🚀 Rocket',
  eyes: '👀 Eyes'
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined

const positiveId = (value: unknown): string | undefined =>
  (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) ||
  (typeof value === 'string' && /^[1-9]\d*$/.test(value))
    ? String(value)
    : undefined

export const isGitHubPullRequestTool = (name: string): boolean => Object.hasOwn(operations, name)

export function getGitHubPullRequestApproval(approval: ProviderMcpToolApproval) {
  const tool = approval.toolName
  if (!tool || !isGitHubPullRequestTool(tool)) return undefined

  const operation = operations[tool]
  const parameters = new Map(approval.parameters.map((field) => [field.name, field]))
  const value = (name: string) => parameters.get(name)?.value
  const repository = text(value('repository_full_name')) ?? text(value('repo_full_name'))
  const prNumber = positiveId(value('pr_number'))
  const number = operation.target === 'issue' ? positiveId(value('issue_number')) : prNumber
  const comment = operation.target === 'comment' ? positiveId(value('comment_id')) : undefined
  const review = operation.target === 'review' ? text(value('review_id')) : undefined
  const thread = operation.target === 'thread' ? text(value('thread_id')) : undefined
  const repoTarget = [repository, number && `#${number}`].filter(Boolean).join(' ')
  const detail = comment
    ? `Comment #${comment}`
    : review
      ? `Review ${review}`
      : thread
        ? `Thread ${thread}`
        : ''
  const target = [repoTarget, detail].filter(Boolean).join(' · ')
  const identified =
    !!repository &&
    /^[\w.-]+\/[\w.-]+$/.test(repository) &&
    (!!number || !!comment || operation.target === 'repository')
  const create = tool === 'github.create_pull_request'
  const merge = tool === 'github.merge_pull_request'
  const draft = create && value('draft') === true
  let { title, action = title } = operation
  if (draft) {
    title = 'Create draft pull request'
    action = 'Create draft PR'
  } else if (merge) {
    const method = value('merge_method')
    if (method === 'squash') action = 'Squash and merge'
    else if (method === 'rebase') action = 'Rebase and merge'
    else if (method != null && method !== 'merge') action = 'Allow once'
  } else if (tool === 'github.update_pull_request') {
    const state = value('state')
    if (state === 'closed') {
      title = 'Close pull request'
      action = 'Close PR'
    } else if (state === 'open') {
      title = 'Reopen pull request'
      action = 'Reopen PR'
    }
  } else if (tool === 'github.add_review_to_pr') {
    const verdict = value('action')
    if (verdict === 'APPROVE') {
      title = 'Approve pull request'
      action = 'Submit approval'
    } else if (verdict === 'REQUEST_CHANGES') {
      title = action = 'Request changes'
    }
  }

  const head = text(value('head')) ?? text(value('head_branch'))
  const base = text(value('base')) ?? text(value('base_branch'))
  const headRepo = create ? text(value('head_repo')) : undefined
  const facts = (operation.facts ?? []).flatMap((name) => {
    const field = parameters.get(name)
    if (!field || field.value == null || field.value === '') return []
    const reaction = name === 'reaction' && typeof field.value === 'string' ? field.value : ''
    const id = name === 'issue' || name.endsWith('_id') ? positiveId(field.value) : undefined
    return [
      {
        ...field,
        label: Object.hasOwn(labels, name) ? labels[name] : field.label,
        value:
          reaction && Object.hasOwn(reactions, reaction)
            ? reactions[reaction]
            : id
              ? `#${id}`
              : field.value
      }
    ]
  })
  const fileComments = value('file_comments')
  const inlineComments = (Array.isArray(fileComments) ? fileComments : []).flatMap((entry) => {
    const field = record(entry)
    const path = text(field?.path)
    const body = text(field?.body)
    if (!path || !body) return []
    const line = positiveId(field?.line)
    const start = positiveId(field?.start_line)
    const position = positiveId(field?.position)
    const location = line
      ? `:${start && start !== line ? `${start}–` : ''}${line}`
      : position
        ? ` · diff position ${position}`
        : ''
    return [{ location: path + location + (field?.side === 'LEFT' ? ' · old version' : ''), body }]
  })
  return {
    title,
    action: identified ? action : 'Allow once',
    target: target || 'PR details unavailable',
    prTitle: text(value(create ? 'title' : 'pr_title')),
    head:
      (create || merge) && head
        ? headRepo && !head.includes(':')
          ? `${headRepo}:${head}`
          : head
        : undefined,
    base: create || merge ? base : undefined,
    facts,
    body: operation.body ? text(value(operation.body)) : undefined,
    inlineComments
  }
}
