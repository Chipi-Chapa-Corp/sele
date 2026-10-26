import {
  startTransition,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type SetStateAction
} from 'react'
import type { ProviderAccountUsage } from '../../../shared/provider'
import type { UsageLoadState } from './controllerTypes'

// Scope is checked during render; changing chats never needs a clearing layout update.
export function useAccountUsageState(usageScope: object) {
  const usageScopeRef = useRef<object | null>(usageScope)
  type UsageSnapshot = {
    scope: object
    usage: ProviderAccountUsage | null
    state: UsageLoadState
    error: string | null
  }
  const [usageSnapshot, setUsageSnapshot] = useState<UsageSnapshot | null>(null)
  const currentUsage = usageSnapshot?.scope === usageScope ? usageSnapshot : null
  const accountUsage = currentUsage?.usage ?? null
  const accountUsageState = currentUsage?.state ?? 'loading'
  const accountUsageError = currentUsage?.error ?? null
  const usageAuthenticationRequired = accountUsage?.authenticationRequired === true
  const setUsageField = useCallback(
    <Key extends 'usage' | 'state' | 'error'>(
      key: Key,
      update: SetStateAction<UsageSnapshot[Key]>
    ): void => {
      startTransition(() =>
        setUsageSnapshot((current) => {
          if (usageScopeRef.current !== usageScope) return current
          const base: UsageSnapshot =
            current?.scope === usageScope
              ? current
              : { scope: usageScope, usage: null, state: 'loading', error: null }
          const value =
            typeof update === 'function'
              ? (update as (value: UsageSnapshot[Key]) => UsageSnapshot[Key])(base[key])
              : update
          return Object.is(value, base[key]) ? current : { ...base, [key]: value }
        })
      )
    },
    [usageScope]
  )
  const setAccountUsage = useCallback(
    (update: SetStateAction<ProviderAccountUsage | null>) => setUsageField('usage', update),
    [setUsageField]
  )
  const setAccountUsageState = useCallback(
    (update: SetStateAction<UsageLoadState>) => setUsageField('state', update),
    [setUsageField]
  )
  const setAccountUsageError = useCallback(
    (update: SetStateAction<string | null>) => setUsageField('error', update),
    [setUsageField]
  )
  useLayoutEffect(() => {
    usageScopeRef.current = usageScope
    return () => {
      usageScopeRef.current = null
    }
  }, [usageScope])
  return {
    accountUsage,
    accountUsageState,
    accountUsageError,
    usageAuthenticationRequired,
    usageScopeRef,
    setAccountUsage,
    setAccountUsageState,
    setAccountUsageError
  }
}
