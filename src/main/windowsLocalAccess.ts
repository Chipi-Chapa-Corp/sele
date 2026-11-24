import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { localAccessDefaultPort } from '../shared/localAccess.ts'

const exec = promisify(execFile)

export function windowsLocalAccessRuleScript(executable: string, port: number): string {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Invalid local network port.')
  const identity = createHash('sha256').update(executable.toLowerCase()).digest('hex').slice(0, 16)
  const program = Buffer.from(executable, 'utf8').toString('base64')
  // The elevated command contains its own code and encoded values. It never
  // executes a script from the user profile or accepts commands from the renderer.
  return `
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/NetSecurity/NetSecurity.psd1')
$program = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${program}'))
$rulePrefix = 'SeleLocalAccess-${identity}-'
function Set-SeleRule([string]$Protocol, [int]$Port, [string]$Purpose) {
  $name = $rulePrefix + $Protocol
  if ($Purpose -eq 'broadcast discovery') { $name += 'Broadcast' }
  $scope = @{
    Program = $program; Profile = 'Private'; RemoteAddress = 'LocalSubnet';
    Direction = 'Inbound'; Action = 'Allow'; Enabled = 'True';
    Protocol = $Protocol; LocalPort = $Port; PolicyStore = 'PersistentStore';
  }
  if (Get-NetFirewallRule -Name $name -PolicyStore PersistentStore -ErrorAction SilentlyContinue) {
    Set-NetFirewallRule -Name $name @scope
  } else {
    New-NetFirewallRule -Name $name -DisplayName ('Sele Local Network (' + $Purpose + ')') @scope | Out-Null
  }
}
Set-SeleRule 'UDP' 5353 'discovery'
Set-SeleRule 'UDP' ${localAccessDefaultPort} 'broadcast discovery'
Set-SeleRule 'TCP' ${port} 'pairing'
$active = @(Get-NetFirewallRule -Name ($rulePrefix + 'UDP'), ($rulePrefix + 'UDPBroadcast'), ($rulePrefix + 'TCP') -PolicyStore ActiveStore -ErrorAction SilentlyContinue)
if ($active.Count -ne 3) { exit 3 }
$blocks = Get-NetFirewallRule -PolicyStore ActiveStore -Enabled True -Direction Inbound -Action Block |
  Where-Object { $_.Profile -match 'Any|Private' } | Get-NetFirewallApplicationFilter |
  Where-Object { $_.Program -and [Environment]::ExpandEnvironmentVariables($_.Program) -eq $program }
if ($blocks) { exit 4 }
`
}

export async function allowWindowsLocalAccess(executable: string, port: number): Promise<boolean> {
  const windowsDirectory = process.env.SystemRoot
  if (process.platform !== 'win32' || !windowsDirectory || !isAbsolute(windowsDirectory))
    throw new Error('Windows Firewall settings are unavailable.')
  const powershell = join(
    windowsDirectory,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  const elevated = Buffer.from(windowsLocalAccessRuleScript(executable, port), 'utf16le').toString(
    'base64'
  )
  const launch = `
$ErrorActionPreference = 'Stop'
try {
  $process = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -WorkingDirectory $PSHOME -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile -NonInteractive -EncodedCommand ${elevated}'
  exit $process.ExitCode
} catch {
  for ($cause = $_.Exception; $null -ne $cause; $cause = $cause.InnerException) {
    if ($cause -is [ComponentModel.Win32Exception] -and $cause.NativeErrorCode -eq 1223) { exit 1223 }
  }
  throw
}
`
  try {
    await exec(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(launch, 'utf16le').toString('base64')
      ],
      { windowsHide: true }
    )
    return true
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === 1223) return false
    if (code === 3)
      throw new Error(
        'Windows saved the rules, but your firewall policy did not activate them. Check Windows Firewall or ask your administrator.'
      )
    if (code === 4)
      throw new Error(
        'An existing Windows Firewall rule blocks Sele. Open Windows Firewall to review the existing rule.'
      )
    throw new Error(
      'Windows Firewall could not add the rules for Sele. Check the firewall settings or ask your administrator.',
      { cause: error }
    )
  }
}
