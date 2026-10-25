import type { CopilotSession } from '@github/copilot-sdk'
import type { ProviderChatGoal } from '../../../shared/provider.ts'

export type CopilotGoalState = Awaited<
  ReturnType<CopilotSession['rpc']['autopilotObjective']['getState']>
>['state']
type GoalSession = Pick<CopilotSession, 'rpc' | 'send'> & {
  /** The SDK strips this internal getter from its public declarations. */
  internalRpc?: {
    commands: {
      finalizeInvocationEffect: (params: {
        effect: object
        outcome: 'applied' | 'cancelled'
      }) => Promise<{ success: boolean; error?: string }>
    }
  }
}

export const getCopilotGoalInput = (objective: string | null): string | null => {
  const text = objective?.trim()
  if (!text) return null
  if (/^(on|off)$/i.test(text) || /(?:^|\s)--max-ai-credits(?:[=\s]|$)/.test(text))
    throw new Error('Describe the goal as a completion condition, without Copilot command options.')
  return text
}

export const mapCopilotGoal = (
  sessionId: string,
  state: CopilotGoalState,
  previous?: { id: number; goal: ProviderChatGoal },
  now = Date.now()
): ProviderChatGoal | null => {
  if (!state) return null
  return {
    threadId: sessionId,
    objective: state.objective,
    status: state.status === 'completed' ? 'complete' : state.status,
    // Copilot reports AI credits, not goal-scoped token spend or token budgets.
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: previous?.id === state.id ? previous.goal.createdAt : now,
    updatedAt: now
  }
}

/** Apply the native command's returned prompt instead of authoring objective state files. */
export const runCopilotGoal = async (
  session: GoalSession,
  command: string,
  objective: string | null,
  beforeSend: () => void
): Promise<void> => {
  // Reservation finalization is exposed by SDK 1.0.26 through its internal RPC getter.
  // Keep this narrow compatibility boundary covered by the bundled-runtime test.
  const finalize = session.internalRpc?.commands.finalizeInvocationEffect
  if (objective && !finalize)
    throw new Error('This Copilot SDK cannot finalize goal commands. Update the Copilot runtime.')
  const result = await session.rpc.commands.invoke({ name: command, input: objective ?? 'off' })
  const effect = result as typeof result & { reservationToken?: string }
  try {
    if (objective === null) {
      if (result.kind !== 'completed')
        throw new Error(result.kind === 'text' ? result.text : 'Copilot could not stop autopilot.')
      if ((await session.rpc.mode.get()) !== 'interactive')
        throw new Error('Copilot did not leave autopilot mode.')
      const { state } = await session.rpc.autopilotObjective.getState()
      if (state?.status === 'active') throw new Error('Copilot did not stop the active goal.')
      return
    }
    if (result.kind !== 'agent-prompt' || result.mode !== 'autopilot')
      throw new Error(result.kind === 'text' ? result.text : 'Copilot did not accept the goal.')
    const { state } = await session.rpc.autopilotObjective.getState()
    if (state?.objective !== objective || state.status !== 'active')
      throw new Error('Copilot did not activate the requested goal.')
    beforeSend()
    await session.send({
      prompt: result.prompt,
      displayPrompt: result.displayPrompt,
      agentMode: 'autopilot'
    })
    if (effect.reservationToken) {
      const finalized = await finalize!({ effect, outcome: 'applied' })
      if (!finalized.success)
        throw new Error(finalized.error || 'Copilot could not finalize the goal.')
    }
  } catch (error) {
    if (objective) {
      try {
        if (effect.reservationToken && finalize) {
          const canceled = await finalize({ effect, outcome: 'cancelled' })
          if (!canceled.success)
            throw new Error(canceled.error || 'Copilot could not cancel the goal update.')
        }
        // Finalizing a cancelled reservation releases admission; it does not stop autopilot.
        // Pause the unsent/failed objective explicitly so it cannot continue on its own.
        await runCopilotGoal(session, command, null, () => {})
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'The Copilot goal update and its rollback failed.'
        )
      }
    }
    throw error
  }
}
