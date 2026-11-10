import type { AppContainerTarget } from '../../shared/app'
import type {
  ProviderAccountConfiguration,
  ProviderAccountRateLimitResetCredit,
  ProviderAccountRateLimitResetOutcome,
  ProviderAccountUsage,
  ProviderSourceOptions
} from '../../shared/provider'
import { getContainerTargetKey } from '../containerTarget.ts'

const reminderWindowMs = 3 * 60_000
const responseWindowMs = 30_000
const expiryMarginMs = 10_000
const pollIntervalMs = 15_000

const expiration = (credit: ProviderAccountRateLimitResetCredit): number =>
  credit.expiresAt == null
    ? Number.POSITIVE_INFINITY
    : credit.expiresAt > 1_000_000_000_000
      ? credit.expiresAt
      : credit.expiresAt * 1_000

type Dependencies = {
  sources: () => Promise<(AppContainerTarget | null)[]>
  available: (container: AppContainerTarget | null) => Promise<boolean>
  accounts: (container: AppContainerTarget | null) => Promise<ProviderAccountConfiguration>
  usage: (options: ProviderSourceOptions) => Promise<ProviderAccountUsage>
  reset: (options: ProviderSourceOptions) => Promise<ProviderAccountRateLimitResetOutcome>
  prompt: (account: string, waitMs: number, signal: AbortSignal) => Promise<boolean>
}

/** Runs in the main process so an inactive account or background window cannot miss a reset. */
export class ExpiringResetCredits {
  private timer: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private sources = new Map<string, Promise<void>>()
  private handled = new Map<string, number>()
  private approved = new Map<string, number>()
  private prompts = new Set<AbortController>()
  private readonly dependencies: Dependencies
  private readonly now: () => number

  constructor(dependencies: Dependencies, now: () => number = Date.now) {
    this.dependencies = dependencies
    this.now = now
  }

  start = (): void => {
    if (this.timer) return
    this.stopped = false
    const check = (): void => {
      void this.tick().catch((error) => console.error('Unable to check expiring resets.', error))
    }
    this.timer = setInterval(check, pollIntervalMs)
    this.timer.unref?.()
    check()
  }

  tick = async (): Promise<void> => {
    if (this.stopped) return
    for (const entries of [this.handled, this.approved])
      for (const [key, expiresAt] of entries) if (expiresAt <= this.now()) entries.delete(key)
    const work: Promise<void>[] = []
    for (const container of await this.dependencies.sources()) {
      if (this.stopped) break
      const key = getContainerTargetKey(container)
      let pending = this.sources.get(key)
      if (!pending) {
        pending = this.checkSource(container).finally(() => this.sources.delete(key))
        this.sources.set(key, pending)
      }
      work.push(pending)
    }
    await Promise.all(work)
  }

  close = async (): Promise<void> => {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const controller of this.prompts) controller.abort()
    await Promise.all(this.sources.values())
  }

  private checkSource = async (container: AppContainerTarget | null): Promise<void> => {
    try {
      // Saved credentials can outlive the CLI installation in this source.
      if (!(await this.dependencies.available(container)) || this.stopped) return
      const configuration = await this.dependencies.accounts(container)
      if (this.stopped || !configuration.available) return
      await Promise.all(
        configuration.accounts.map(async (account) => {
          const options = { container, accountId: account.id, forceRefresh: true }
          try {
            const usage = await this.dependencies.usage(options)
            if (this.stopped || usage.authenticationRequired) return
            const credit = usage.rateLimitResetCredits?.availableCount
              ? usage.rateLimitResetCredits.credits
                  ?.filter((credit) => {
                    const remaining = expiration(credit) - this.now()
                    return (
                      remaining > 0 &&
                      remaining < reminderWindowMs &&
                      !this.handled.has(this.creditKey(options, credit))
                    )
                  })
                  .sort((first, second) => expiration(first) - expiration(second))[0]
              : undefined
            if (!credit) return
            const key = this.creditKey(options, credit)
            const waitMs = Math.max(
              0,
              Math.min(responseWindowMs, expiration(credit) - this.now() - expiryMarginMs)
            )
            const label = `${account.displayName ?? account.login ?? account.id}${
              container?.kind === 'container' ? ` (${container.name})` : ''
            }`
            if (!this.approved.has(key)) {
              const controller = new AbortController()
              this.prompts.add(controller)
              let timeout: ReturnType<typeof setTimeout> | undefined
              let accepted: boolean
              try {
                accepted = await Promise.race([
                  this.dependencies.prompt(label, waitMs, controller.signal),
                  new Promise<boolean>((resolve) => {
                    timeout = setTimeout(() => resolve(true), waitMs)
                  })
                ])
              } finally {
                clearTimeout(timeout)
                controller.abort()
                this.prompts.delete(controller)
              }
              if (this.stopped) return
              if (!accepted) {
                this.handled.set(key, expiration(credit))
                return
              }
              this.approved.set(key, expiration(credit))
            }
            // A manual reset elsewhere may have consumed this credit while the popup was open.
            const current = await this.dependencies.usage(options)
            if (
              this.stopped ||
              current.authenticationRequired ||
              !current.rateLimitResetCredits?.availableCount ||
              !current.rateLimitResetCredits.credits?.some(
                (candidate) =>
                  this.creditKey(options, candidate) === key && expiration(candidate) > this.now()
              )
            )
              return
            const outcome = await this.dependencies.reset(options)
            // Nothing was consumed: usage may arrive before expiry, so try again on the next poll.
            if (outcome !== 'nothingToReset') this.handled.set(key, expiration(credit))
          } catch (error) {
            console.error(`Unable to protect expiring resets for account ${account.id}.`, error)
          }
        })
      )
    } catch (error) {
      console.error('Unable to read accounts for expiring resets.', error)
    }
  }

  private creditKey = (
    options: ProviderSourceOptions,
    credit: ProviderAccountRateLimitResetCredit
  ): string =>
    JSON.stringify([
      getContainerTargetKey(options.container),
      options.accountId,
      credit.id,
      expiration(credit)
    ])
}
