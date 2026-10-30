import { useLayoutEffect, useRef, useState } from 'react'
import type { AppLocalImageOptions } from '../../shared/app'
import { appApi } from './appApi'
import { createLocalMediaCache, getLocalMediaKey, type LocalMediaKind } from './localMediaCache'

export const localMediaCache = createLocalMediaCache((options, kind) =>
  kind === 'video' ? appApi.getLocalVideo(options) : appApi.getLocalImage(options)
)

export function useLocalMedia(
  options: AppLocalImageOptions | null,
  kind: LocalMediaKind = 'image'
): { url?: string; error?: string } | null {
  const key = options ? getLocalMediaKey(options, kind) : null
  const [loaded, setLoaded] = useState<{ key: string; url?: string; error?: string } | null>(null)
  const published = useRef(loaded)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key includes every media option.
  useLayoutEffect(() => {
    if (!options || !key) return
    const lease = localMediaCache.acquire(options, kind)
    let active = true
    const publish = (next: typeof loaded): void => {
      const previous = published.current
      if (
        previous?.key === next?.key &&
        previous?.url === next?.url &&
        previous?.error === next?.error
      )
        return
      published.current = next
      setLoaded(next)
    }
    if (lease.url) publish({ key, url: lease.url })
    else {
      // Activity can reconnect after an idle lease expired. The mounted image
      // still has decoded pixels; keep them while reacquiring the same resource.
      if (published.current?.key !== key) publish(null)
      void lease.ready.then(
        (url) => {
          if (active) publish({ key, url })
        },
        (error) => {
          console.error('[caught:useLocalMedia]', error)
          if (active) publish({ key, error: 'Unable to load media' })
        }
      )
    }
    return () => {
      active = false
      lease.release()
    }
  }, [key])
  return loaded?.key === key ? loaded : null
}
