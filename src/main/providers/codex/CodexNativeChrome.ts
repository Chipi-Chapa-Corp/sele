type InstalledPlugins = {
  marketplaces: Array<{
    name: string
    plugins: Array<{ name: string; installed: boolean }>
  }>
}

/** Reuse app-managed plugins; never install or replace the native messaging host. */
export function getCodexNativeChromeConfig(installed: InstalledPlugins): Record<string, boolean> {
  const plugins = new Set(
    installed.marketplaces
      .filter((marketplace) => marketplace.name === 'openai-bundled')
      .flatMap((marketplace) => marketplace.plugins.filter((plugin) => plugin.installed))
      .map((plugin) => plugin.name)
  )
  // Plugin names vary across runtime versions. A missing `chrome` catalog entry
  // does not disprove an existing native Chrome connection. Preserve the runtime's
  // configuration and let its browser tools report actual connection failures.
  return {
    ...(plugins.has('chrome') ? { 'plugins."chrome@openai-bundled".enabled': true } : {}),
    ...(plugins.has('unified-computer-use')
      ? { 'plugins."unified-computer-use@openai-bundled".enabled': true }
      : {})
  }
}
