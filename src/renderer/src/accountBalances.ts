import type { ProviderAccountBalance } from '../../shared/provider'

/** Organization-wide spend is replaced by the selected chat's own cost in the usage popover. */
const organizationSpendIds = new Set(['anthropic:month', 'openai:month'])

export const getDisplayedBalances = (
  balances: readonly ProviderAccountBalance[]
): ProviderAccountBalance[] => balances.filter((balance) => !organizationSpendIds.has(balance.id))

const balancePriority = (balance: ProviderAccountBalance): number =>
  balance.kind === 'remaining' ? 0 : balance.limit != null ? 1 : 2

/**
 * The balance shown next to the usage badges: the selected model's provider, or the only
 * provider that reports one. Prepaid balances beat capped spend, which beats plain spend.
 */
export const selectBadgeBalance = (
  balances: readonly ProviderAccountBalance[],
  modelProviderId: string | undefined
): ProviderAccountBalance | null => {
  balances = getDisplayedBalances(balances)
  const providerIds = new Set(balances.map((balance) => balance.modelProviderId))
  const providerId =
    modelProviderId && providerIds.has(modelProviderId)
      ? modelProviderId
      : providerIds.size === 1
        ? [...providerIds][0]
        : null
  if (!providerId) return null
  return (
    balances
      .filter((balance) => balance.modelProviderId === providerId)
      .sort((first, second) => balancePriority(first) - balancePriority(second))[0] ?? null
  )
}

export type AccountBalanceGroup = {
  providerId: string
  providerName: string
  balances: ProviderAccountBalance[]
}

/** Groups balances by model provider, with the selected model's provider first. */
export const groupAccountBalances = (
  balances: readonly ProviderAccountBalance[],
  modelProviderId: string | undefined
): AccountBalanceGroup[] => {
  const groups = new Map<string, AccountBalanceGroup>()
  for (const balance of getDisplayedBalances(balances)) {
    const group = groups.get(balance.modelProviderId) ?? {
      providerId: balance.modelProviderId,
      providerName: balance.modelProviderName,
      balances: []
    }
    group.balances.push(balance)
    groups.set(balance.modelProviderId, group)
  }
  return [...groups.values()].sort((first, second) => {
    if (first.providerId === modelProviderId) return -1
    if (second.providerId === modelProviderId) return 1
    return first.providerName.localeCompare(second.providerName)
  })
}

export const formatBalanceAmount = (
  amount: number,
  currency: string,
  { compact = false }: { compact?: boolean } = {}
): string => {
  // Keep small nonzero spend visible instead of rounding it to 0.00.
  const small = amount !== 0 && Math.abs(amount) < 0.01
  const options: Intl.NumberFormatOptions = {
    style: 'currency',
    currency,
    maximumFractionDigits: small ? Math.min(6, Math.ceil(-Math.log10(Math.abs(amount))) + 1) : 2,
    ...(compact && Math.abs(amount) >= 1_000 ? { notation: 'compact' as const } : {})
  }
  try {
    return new Intl.NumberFormat(undefined, options).format(amount)
  } catch {
    // Unknown currency codes fall back to a plain number with the code.
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: options.maximumFractionDigits }).format(amount)} ${currency}`
  }
}

export const getBalanceUsedPercent = (balance: ProviderAccountBalance): number | null =>
  balance.kind === 'spent' && balance.limit != null && balance.limit > 0
    ? Math.min(Math.max((balance.amount / balance.limit) * 100, 0), 100)
    : null

export const describeBalance = (balance: ProviderAccountBalance): string => {
  const amount = formatBalanceAmount(balance.amount, balance.currency)
  if (balance.kind === 'remaining') return `${amount} left`
  return balance.limit != null
    ? `${amount} / ${formatBalanceAmount(balance.limit, balance.currency)}`
    : `${amount} spent`
}
