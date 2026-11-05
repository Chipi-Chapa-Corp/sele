export type MobileConnection = { origin: string; token: string; hostId?: string; name?: string }

const storageKey = 'sele-android-connection-v1'

const isLanHostname = (hostname: string): boolean => {
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.home.arpa')
  )
    return true
  if (/^[a-z0-9-]+$/i.test(hostname) && !/^\d+$/.test(hostname)) return true
  const parts = hostname.split('.').map(Number)
  if (
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 169 && parts[1] === 254)
    )
  }
  return hostname === '[::1]' || /^\[(?:f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i.test(hostname)
}

export const parseMobileConnection = (link: string): MobileConnection => {
  let url: URL
  try {
    url = new URL(link.trim())
  } catch {
    throw new Error('Paste the full connection link from Sele’s Local network settings.')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !isLanHostname(url.hostname) ||
    !['/', '/index.html'].includes(url.pathname) ||
    url.search
  ) {
    throw new Error('Use a connection link for a Sele computer on your local network.')
  }
  const token = new URLSearchParams(url.hash.slice(1)).get('token')
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    throw new Error(
      'The link has no valid access key. Copy a new connection link from Sele Settings.'
    )
  }
  return { origin: url.origin, token }
}

export const mobileConnectionLink = (connection: MobileConnection): string =>
  `${connection.origin}/#token=${connection.token}`

export const mobileWebSocketUrl = (connection: MobileConnection): string =>
  `${connection.origin.replace(/^http/, 'ws')}/sele/ws`

export const readMobileConnection = (
  storage: Pick<Storage, 'getItem'> = localStorage
): MobileConnection | null => {
  const stored = storage.getItem(storageKey)
  if (!stored) return null
  try {
    const value = JSON.parse(stored) as MobileConnection
    return {
      ...parseMobileConnection(mobileConnectionLink(value)),
      ...(typeof value.hostId === 'string' && /^[a-f0-9-]{36}$/.test(value.hostId)
        ? { hostId: value.hostId }
        : {}),
      ...(typeof value.name === 'string' && value.name.length <= 80 ? { name: value.name } : {})
    }
  } catch {
    console.warn('The saved Android connection is invalid. A new connection link is required.')
    return null
  }
}

export const saveMobileConnection = (
  connection: MobileConnection,
  storage: Pick<Storage, 'setItem'> = localStorage
): void => {
  const valid = parseMobileConnection(mobileConnectionLink(connection))
  storage.setItem(
    storageKey,
    JSON.stringify({ ...valid, hostId: connection.hostId, name: connection.name })
  )
}

export const forgetMobileConnection = async (): Promise<void> => {
  const { Capacitor } = await import('@capacitor/core')
  if (Capacitor.isNativePlatform()) {
    const { writeAndroidStorage } = await import('./androidStorage')
    await writeAndroidStorage(storageKey, null)
  }
  localStorage.removeItem(storageKey)
  location.reload()
}

export const requestMobileConnection = async (
  error?: string,
  previous?: MobileConnection | null
): Promise<MobileConnection> => {
  const [{ createRoot }, { createElement }, { MobileConnectionScreen }] = await Promise.all([
    import('react-dom/client'),
    import('react'),
    import('./components/MobileConnectionScreen')
  ])
  const container = document.createElement('div')
  document.getElementById('root')!.replaceChildren(container)
  const root = createRoot(container)
  return new Promise((resolve) => {
    root.render(
      createElement(MobileConnectionScreen, {
        error,
        previous,
        onConnect: (connection: MobileConnection) => {
          root.unmount()
          container.remove()
          resolve(connection)
        }
      })
    )
  })
}
