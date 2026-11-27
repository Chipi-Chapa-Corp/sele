// Line editors (zsh, fish, nu, bash 5.1+) enable bracketed paste when they start reading a command.
export const BRACKETED_PASTE_ON = "\x1b[?2004h";
const BRACKETED_PASTE_OFF = "\x1b[?2004l";
// Longer than one subprocess poll plus its ps timeout, so a startup prompt is seen as busy first.
export const SHELL_QUIET_FALLBACK = "3 seconds";
export const SHELL_QUIET_FALLBACK_MS = 3_000;

export function lineEditorReading(text: string, previous: boolean): boolean {
  const on = text.lastIndexOf(BRACKETED_PASTE_ON);
  const off = text.lastIndexOf(BRACKETED_PASTE_OFF);
  return on === off ? previous : on > off;
}

/** PowerShell and cmd have no bracketed-paste line-editor signal. */
export function shellHasLineEditorSignal(shell: string | null): boolean {
  if (shell === null) return false;
  const name = (shell.split(/[/\\]/).at(-1) ?? shell).toLowerCase().replace(/\.exe$/, "");
  return name !== "cmd" && name !== "pwsh" && name !== "powershell";
}
