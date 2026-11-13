export type CodexApprovalPolicy =
  | 'never'
  | 'on-request'
  | 'on-failure'
  | {
      granular: {
        sandbox_approval: boolean
        rules: boolean
        mcp_elicitations: boolean
        request_permissions: boolean
        skill_approval: boolean
      }
    }

export function getCodexApprovalPolicy(
  policy: 'never' | 'on-request' | 'on-failure'
): CodexApprovalPolicy {
  if (policy !== 'never') return policy
  // `never` also silently declines MCP forms before Sele can display them.
  // Keep command/permission escalations disabled, but let the user answer app
  // consent, authentication and other MCP forms. This grants no approval itself.
  return {
    granular: {
      sandbox_approval: false,
      rules: false,
      mcp_elicitations: true,
      request_permissions: false,
      skill_approval: false
    }
  }
}
