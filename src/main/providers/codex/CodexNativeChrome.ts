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
  // The real app-server catalog distinguishes Chrome from the in-app Browser.
  // Browser plus its runtime does not establish a Chrome installation.
  if (!plugins.has('chrome'))
    throw new Error(
      'Set up Chrome in the ChatGPT or Codex desktop app first, then keep that app running. No official Chrome browser plugin is installed. You can also turn off official Chrome integration in Sele Settings → Browser & desktop.'
    )
  return {
    'plugins."chrome@openai-bundled".enabled': true,
    ...(plugins.has('unified-computer-use')
      ? { 'plugins."unified-computer-use@openai-bundled".enabled': true }
      : {})
  }
}
