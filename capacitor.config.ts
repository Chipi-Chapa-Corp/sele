import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.chipichapa.sele.android',
  appName: 'Sele',
  webDir: 'out/mobile',
  // The packaged UI stays on the app's own origin. Only the authenticated
  // WebSocket connects to the computer selected by the user.
  server: {
    hostname: 'sele.localhost',
    androidScheme: 'http',
    cleartext: true
  },
  plugins: { SystemBars: { insetsHandling: 'native' } }
}

module.exports = config
