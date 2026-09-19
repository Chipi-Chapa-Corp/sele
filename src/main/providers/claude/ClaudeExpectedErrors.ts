export const isExpectedClaudeQueryShutdownError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === 'AbortError' ||
    /(?:already|is) closed|not (?:active|running|connected)|stream (?:ended|closed)|write after end/i.test(
      error.message
    ))
