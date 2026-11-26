import { type KnownTerminalSession } from "@t3tools/client-runtime/state/terminal";

/**
 * Terminal IDs that need close confirmation: sessions with an active unfinished
 * subprocess, or all IDs when session metadata is unavailable.
 */
export function terminalIdsRequiringCloseConfirmation(
  terminalIds: ReadonlyArray<string>,
  knownSessions: ReadonlyArray<KnownTerminalSession> | null,
): string[] {
  if (knownSessions === null) return [...terminalIds];
  const busyIds = new Set(
    knownSessions
      .filter((session) => session.state.status === "running" && session.state.hasRunningSubprocess)
      .map((session) => session.target.terminalId),
  );
  return terminalIds.filter((terminalId) => busyIds.has(terminalId));
}
