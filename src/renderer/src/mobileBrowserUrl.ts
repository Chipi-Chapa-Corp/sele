/** Loopback addresses on a companion refer to the paired computer. */
export const mobileBrowserUrl = (url: string, origin: string): string => {
  const page = new URL(url)
  if (!['http:', 'https:'].includes(page.protocol))
    throw new Error('Enter an HTTP or HTTPS address.')
  if (
    page.hostname === 'localhost' ||
    page.hostname.endsWith('.localhost') ||
    /^127\./.test(page.hostname) ||
    page.hostname === '[::1]'
  )
    page.hostname = new URL(origin).hostname
  return page.href
}

/** External links also support mail and telephone actions. */
export const mobileLinkUrl = (url: string, origin: string): string => {
  const parsed = new URL(url)
  return ['http:', 'https:'].includes(parsed.protocol) ? mobileBrowserUrl(url, origin) : url
}
