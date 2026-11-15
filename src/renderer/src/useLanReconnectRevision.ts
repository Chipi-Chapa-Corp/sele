import { startTransition, useEffect, useState } from 'react'
import { onLanReconnected } from './lanConnectionEvents'
let revision = 0
onLanReconnected(() => {
  revision++
})
export const useLanReconnectRevision = (): number => {
  const [current, setCurrent] = useState(revision)
  useEffect(
    () =>
      onLanReconnected(() => {
        startTransition(() => setCurrent(revision))
      }),
    []
  )
  return current
}
