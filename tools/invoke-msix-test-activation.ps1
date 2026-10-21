[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$RequestPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$request = Get-Content -LiteralPath $RequestPath -Raw | ConvertFrom-Json
$resultPath = Join-Path ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($RequestPath))) 'activation-result.json'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$result = [ordered]@{
  requestId = $request.requestId; mode = $request.mode; helperPid = $PID; userSid = $identity.User.Value
  sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId; elevated = $null; appPid = 0
  shellStarted = $false; shellProcessId = $null; error = $null
}
$manager = $null
try {
  Add-Type -Path (Join-Path $PSScriptRoot 'msix-activation-interop.cs')
  $result.elevated = [MsixTrial.Native]::IsElevated([uint32]$PID)
  if ($result.userSid -ne $request.userSid -or $result.sessionId -ne $request.sessionId -or $result.elevated) {
    throw 'The activation task must use the requested non-elevated interactive test-user session.'
  }
  if ($request.mode -eq 'launch') {
    $manager = New-Object MsixTrial.ActivationManager
    $result.appPid = [MsixTrial.Native]::ActivateApplication($manager, $request.aumid, $request.arguments)
    if ($result.appPid -eq 0) { throw 'Package activation did not return an application process.' }
  } elseif ($request.mode -in @('file', 'protocol')) {
    $result.appPid = $null
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $request.item
    $start.Verb = 'open'
    $start.UseShellExecute = $true
    $process = [Diagnostics.Process]::Start($start)
    $result.shellStarted = $true
    # Shell may forward to the existing app without returning a process.
    if ($process) { try { $result.shellProcessId = $process.Id } finally { $process.Dispose() } }
  } else {
    throw 'Unknown MSIX activation trial operation.'
  }
} catch {
  $result.error = $_.Exception.Message
} finally {
  if ($manager) { $manager.Dispose() }
  $result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $resultPath -Encoding utf8
}
if ($result.error) { exit 1 }
