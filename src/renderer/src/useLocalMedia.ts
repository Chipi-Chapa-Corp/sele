import { useLayoutEffect, useState } from 'react'
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key includes every media option.
  useLayoutEffect(() => {
    if (!options || !key) return
    const lease = localMediaCache.acquire(options, kind)
    let active = true
    if (lease.url) setLoaded({ key, url: lease.url })
    else {
      setLoaded(null)
      void lease.ready.then(
        (url) => {
          if (active) setLoaded({ key, url })
        },
        (error) => {
          console.error('[caught:useLocalMedia]', error)
          if (active) setLoaded({ key, error: 'Unable to load media' })
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
