import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { onPreferencesChanged, trackPreferenceReads } from './preferences'

/** Keep existing typed preference readers and local setters, while re-reading
 * exactly the affected state when another client changes the host snapshot. */
export const usePreferenceState = <T>(read: () => T): [T, Dispatch<SetStateAction<T>>] => {
  const reader = useRef(read)
  reader.current = read
  const keys = useRef(new Set<string>())
  const [value, setValue] = useState(() => {
    const tracked = trackPreferenceReads(read)
    keys.current = tracked.keys
    return tracked.value
  })
  useEffect(
    () =>
      onPreferencesChanged((changed) => {
        if (![...keys.current].some((key) => changed.has(key))) return
        const tracked = trackPreferenceReads(reader.current)
        keys.current = tracked.keys
        setValue(tracked.value)
      }),
    []
  )
  return [value, setValue]
}
