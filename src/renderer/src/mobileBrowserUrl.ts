/** Only imported desktop tabs rewrite loopback. Addresses entered on this
 * device retain their original host, port, query and fragment. */
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
