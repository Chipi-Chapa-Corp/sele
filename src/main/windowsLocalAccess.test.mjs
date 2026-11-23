import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import test from 'node:test'
import { windowsLocalAccessRuleScript } from './windowsLocalAccess.ts'

test('Windows Firewall updates Sele rules scoped to its executable, ports and private local subnet', () => {
  const path = "C:\\Program Files\\User's Apps\\Sele\\sele.exe"
  const rules = windowsLocalAccessRuleScript(path, 4590)
  assert.equal(
    Buffer.from(/FromBase64String\('([^']+)'\)/.exec(rules)[1], 'base64').toString('utf8'),
    path
  )
  assert.match(rules, /Profile = 'Private'; RemoteAddress = 'LocalSubnet'/)
  assert.match(rules, /Program = \$program/)
  assert.match(rules, /Set-SeleRule 'UDP' 5353/)
  assert.match(rules, /Set-SeleRule 'TCP' 4590/)
  assert.match(rules, /Set-NetFirewallRule -Name \$name @scope/)
  assert.throws(
    () => windowsLocalAccessRuleScript(path, '4590; exit'),
    /Invalid local network port/
  )

  if (process.platform === 'win32') {
    const powershell = join(
      process.env.SystemRoot,
      'System32/WindowsPowerShell/v1.0/powershell.exe'
    )
    // Parse the elevated command on Windows without changing the runner's firewall.
    execFileSync(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$errors = $null; $tokens = $null; [void][System.Management.Automation.Language.Parser]::ParseInput([Console]::In.ReadToEnd(), [ref]$tokens, [ref]$errors); if ($errors) { Write-Error ($errors | Out-String); exit 1 }'
      ],
      { input: rules, timeout: 10000, windowsHide: true }
    )
  }
})
