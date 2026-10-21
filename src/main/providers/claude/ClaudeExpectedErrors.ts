export const isExpectedClaudeQueryShutdownError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === 'AbortError' ||
    /(?:already|is) closed|query closed before response received|not (?:active|running|connected)|stream (?:ended|closed)|write after end/i.test(
      error.message
    ))
