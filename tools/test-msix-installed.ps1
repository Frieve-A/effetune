[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Package,
  [Parameter(Mandatory = $true)][string]$Metadata,
  [string]$PreviousPackage,
  [string]$ReportDirectory = 'out/msix/installed-test',
  [string]$ValidatedPackageDirectory = "$env:LOCALAPPDATA\EffeTuneMsixValidation\validated",
  [string]$SdkDirectory,
  [string]$WackPath = "${env:ProgramFiles(x86)}\Windows Kits\10\App Certification Kit\appcert.exe",
  [switch]$DedicatedTestVm,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$packagePath = (Resolve-Path -LiteralPath $Package).Path
$metadataPath = (Resolve-Path -LiteralPath $Metadata).Path
$previousPath = if ($PreviousPackage) { (Resolve-Path -LiteralPath $PreviousPackage).Path } else { $null }
$sourceMetadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
$baselineMetadataPath = Join-Path $ValidatedPackageDirectory 'last-validated.json'
if (-not $previousPath -and (Test-Path -LiteralPath $baselineMetadataPath)) {
  $baselineMetadata = Get-Content -LiteralPath $baselineMetadataPath -Raw | ConvertFrom-Json
  if ([version]$baselineMetadata.version -lt [version]$sourceMetadata.version) {
    $previousPath = Join-Path $ValidatedPackageDirectory 'last-validated.msix'
    if ((Get-FileHash -LiteralPath $previousPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $baselineMetadata.sha256) {
      throw 'The saved previous validated package does not match its hash.'
    }
  }
}
$originalHash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($originalHash -ne $sourceMetadata.sha256) { throw 'MSIX hash does not match store-package.json.' }
if ($packagePath -eq $previousPath) { throw 'PreviousPackage must be a distinct, older package of the same Identity.' }
if (-not $SdkDirectory) {
  $sdkBin = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
  $sdk = Get-ChildItem -LiteralPath $sdkBin -Directory |
    Where-Object { $_.Name -match '^10\.0\.\d+\.0$' } |
    Sort-Object { [version]$_.Name } -Descending |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'x64\makeappx.exe') } |
    Select-Object -First 1
  if (-not $sdk) { throw 'Install the Windows SDK before using the installed-package runner.' }
  $SdkDirectory = Join-Path $sdk.FullName 'x64'
}
$makeAppx = Join-Path $SdkDirectory 'makeappx.exe'
$signTool = Join-Path $SdkDirectory 'signtool.exe'
$activationInterop = Join-Path $PSScriptRoot 'msix-activation-interop.cs'
$activationHelper = Join-Path $PSScriptRoot 'invoke-msix-test-activation.ps1'
foreach ($tool in @($makeAppx, $signTool, $WackPath, $activationInterop, $activationHelper)) {
  if (-not (Test-Path -LiteralPath $tool)) { throw "Required Windows test tool is missing: $tool" }
}
if ($DryRun) {
  Write-Output 'Static preflight passed. No certificate, package, application, or WACK was started. Dedicated Windows 11 VM execution is still required.'
  return
}
if (-not $DedicatedTestVm) { throw 'This runner changes package/certificate registration. Run only in a dedicated Windows 11 test VM and pass -DedicatedTestVm.' }
if (-not [Environment]::UserInteractive -or [Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0) {
  throw 'WACK requires an active interactive test-user session; Session 0 is unsupported.'
}
if ([Environment]::OSVersion.Version.Build -lt 22000) { throw 'The routine installed-package runner requires a Windows 11 test VM.' }
$testPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $testPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Use the prepared administrative interactive test-user session. Application activation runs in a limited task for that same user and session.'
}
$testUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$testSessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
$reportPath = [IO.Path]::GetFullPath($ReportDirectory)
New-Item -ItemType Directory -Force -Path $reportPath | Out-Null
$workPath = Join-Path $reportPath ('trial-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workPath | Out-Null
$report = [ordered]@{
  schemaVersion = 1; sha256 = $originalHash; tag = $sourceMetadata.tag; commit = $sourceMetadata.commit
  packageVersion = $sourceMetadata.packageVersion; passed = $false; checks = @(); error = $null; cleanupErrors = @(); activations = @()
}
$certificate = $null
$trustedCertificate = $null
$installedPackage = $null
$ownedProcessIds = New-Object 'System.Collections.Generic.HashSet[int]'
$testApplicationProcessId = 0
$activationTask = $null
$runningActivation = $null
$activationTaskFolder = $null
$activationTaskName = $null
$marker = 'msix-test-' + [guid]::NewGuid().ToString('N')
$directStoreData = Join-Path $env:APPDATA 'EffeTune Store'

function Invoke-TestTool([string]$Executable, [string[]]$Arguments) {
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE." }
}
function Get-WackEvaluation([xml]$Document) {
  $overall = $Document.DocumentElement.GetAttribute('OVERALL_RESULT')
  $tests = @($Document.SelectNodes('/REPORT/REQUIREMENTS/REQUIREMENT/TEST'))
  $errors = @()
  $nonPass = @()
  if ($overall -notin @('PASS', 'PASSED', 'WARNING')) { $errors += "Unsuccessful or unknown WACK overall result: $overall" }
  if ($Document.DocumentElement.GetAttribute('PARTIAL_RUN') -ne 'FALSE' -or $tests.Count -eq 0) {
    $errors += 'WACK did not provide a complete test report.'
  }
  foreach ($test in $tests) {
    $resultNode = $test.SelectSingleNode('RESULT')
    $result = if ($resultNode) { $resultNode.InnerText.Trim() } else { '' }
    $optional = $test.GetAttribute('OPTIONAL')
    if ($optional -notin @('TRUE', 'FALSE') -or $result -notin @('PASS', 'PASSED', 'WARNING', 'FAIL', 'FAILED')) {
      $errors += "Unknown or unfinished WACK test: $($test.GetAttribute('INDEX'))"
    } elseif ($optional -ne 'TRUE' -and $result -in @('FAIL', 'FAILED')) {
      $errors += "Required WACK test failed: $($test.GetAttribute('INDEX'))"
    }
    if ($result -notin @('PASS', 'PASSED')) {
      $nonPass += [pscustomobject]@{ index = $test.GetAttribute('INDEX'); name = $test.GetAttribute('NAME')
        optional = $optional; result = $result; messages = @($test.SelectNodes('MESSAGES/MESSAGE') | ForEach-Object { $_.GetAttribute('TEXT') }) }
    }
  }
  # WACK itself displays WARNING as PASSED WITH WARNINGS. Optional failures remain informational.
  $status = if ($errors.Count) { 'failed' } elseif ($overall -eq 'WARNING' -or $nonPass.Count) { 'passed-with-warnings' } else { 'passed' }
  return [pscustomobject]@{ accepted = $errors.Count -eq 0; status = $status; overallResult = $overall; nonPassTests = $nonPass; errors = $errors }
}
function Initialize-ActivationTask {
  # The same test user's limited interactive token must be able to read requests and write results.
  $acl = Get-Acl -LiteralPath $workPath
  $sid = New-Object Security.Principal.SecurityIdentifier($testUserSid)
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  Set-Acl -LiteralPath $workPath -AclObject $acl
  $service = New-Object -ComObject 'Schedule.Service'
  $service.Connect()
  $script:activationTaskFolder = $service.GetFolder('\')
  $definition = $service.NewTask(0)
  $definition.Principal.UserId = $testUserSid
  $definition.Principal.LogonType = 3 # TASK_LOGON_INTERACTIVE_TOKEN: no password is stored.
  $definition.Principal.RunLevel = 0 # TASK_RUNLEVEL_LUA: never inherit the orchestrator's elevation.
  $definition.Settings.ExecutionTimeLimit = 'PT2M'
  $action = $definition.Actions.Create(0)
  $action.Path = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $action.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -RequestPath "{1}"' -f $activationHelper, (Join-Path $workPath 'activation-request.json')
  $action.WorkingDirectory = $workPath
  $script:activationTaskName = 'EffeTuneMsixTrial-' + [guid]::NewGuid().ToString('N')
  $script:activationTask = $activationTaskFolder.RegisterTaskDefinition($activationTaskName, $definition, 2, $testUserSid, $null, 3, $null)
}
function Invoke-PackageActivation([string]$Mode, [string]$Arguments = '', [string]$Item = '') {
  $requestPath = Join-Path $workPath 'activation-request.json'
  $resultPath = Join-Path $workPath 'activation-result.json'
  $requestId = [guid]::NewGuid().ToString('N')
  Remove-Item -LiteralPath $resultPath -Force -ErrorAction SilentlyContinue
  @{ requestId = $requestId; userSid = $testUserSid; sessionId = $testSessionId; mode = $Mode
    aumid = $installedPackage.PackageFamilyName + '!EffeTune'; arguments = $Arguments; item = $Item } |
    ConvertTo-Json | Set-Content -LiteralPath $requestPath -Encoding utf8
  # TASK_RUN_USE_SESSION_ID keeps activation in this exact QA desktop, including when the user has multiple sessions.
  $script:runningActivation = $activationTask.RunEx($null, 4, $testSessionId, $null)
  $deadline = [DateTime]::UtcNow.AddSeconds(125)
  do {
    # The registration survives completion; IRunningTask.State/Refresh no longer do.
    if ((Test-Path -LiteralPath $resultPath) -and $activationTask.State -eq 3) { break }
    if ([DateTime]::UtcNow -ge $deadline) { throw "The limited activation task did not return a completed result; Task Scheduler result: $($activationTask.LastTaskResult)." }
    Start-Sleep -Milliseconds 100
  } while ($true)
  $script:runningActivation = $null
  $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
  $result | Add-Member -NotePropertyName taskLastResult -NotePropertyValue $activationTask.LastTaskResult
  $script:report.activations += $result
  if ($result.requestId -ne $requestId -or $result.userSid -ne $testUserSid -or $result.sessionId -ne $testSessionId -or $result.elevated -ne $false) {
    throw 'The activation result did not come from the expected non-elevated test-user session.'
  }
  if ($result.error) { throw "Registered package activation failed: $($result.error)" }
  if ($result.taskLastResult -ne 0) { throw "The activation helper exited with Task Scheduler result $($result.taskLastResult)." }
  if ($Mode -ne 'launch') {
    if ($result.shellStarted -ne $true) { throw 'The registered Shell open did not start.' }
    return
  }
  if ($result.appPid -le 0) { throw 'Package activation did not return an application process.' }
  $result | Add-Member -NotePropertyMembers @{ expectedPathPrefix = $installedPackage.InstallLocation + '\'; expectedSessionId = $testSessionId
    actualPath = $null; actualSessionId = $null; hasExited = $null }
  $pathDeadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    $process = Get-Process -Id $result.appPid -ErrorAction Stop
    try {
      $result.actualSessionId = $process.SessionId
      $result.actualPath = $process.Path
      $result.hasExited = $process.HasExited
    } finally { $process.Dispose() }
    if ($result.hasExited -or $result.actualSessionId -ne $testSessionId -or
        ($result.actualPath -and -not $result.actualPath.StartsWith($result.expectedPathPrefix, [StringComparison]::OrdinalIgnoreCase))) {
      throw 'Package activation returned a process outside the running test package/session.'
    }
    if ($result.actualPath) { break }
    # Startup can return a live PID before its image metadata is available.
    if ([DateTime]::UtcNow -ge $pathDeadline) { throw 'The package process image path did not become available.' }
    Start-Sleep -Milliseconds 100
  } while ($true)
  $ownedProcessIds.Add([int]$result.appPid) | Out-Null
  $result | Add-Member -NotePropertyName appElevated -NotePropertyValue ([MsixTrial.Native]::IsElevated([uint32]$result.appPid))
  if ($result.appElevated) { throw 'The packaged application is running elevated.' }
  return [uint32]$result.appPid
}
function Stop-TestApplication {
  if (-not $installedPackage) { return }
  $allProcesses = @(Get-CimInstance Win32_Process)
  do {
    $added = $false
    foreach ($candidate in $allProcesses) {
      if ($ownedProcessIds.Contains([int]$candidate.ParentProcessId) -and -not $ownedProcessIds.Contains([int]$candidate.ProcessId)) {
        $added = $ownedProcessIds.Add([int]$candidate.ProcessId) -or $added
      }
    }
  } while ($added)
  $stoppedProcesses = @()
  try {
    foreach ($candidate in $allProcesses) {
      if ($ownedProcessIds.Contains([int]$candidate.ProcessId) -and $candidate.ExecutablePath -and
          $candidate.ExecutablePath.StartsWith($installedPackage.InstallLocation + '\', [StringComparison]::OrdinalIgnoreCase)) {
        try {
          $stoppedProcesses += @(Stop-Process -Id $candidate.ProcessId -Force -PassThru -ErrorAction Stop)
        } catch {
          if (Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue) { throw }
        }
      }
    }
    $stopDeadline = [DateTime]::UtcNow.AddSeconds(10)
    foreach ($process in $stoppedProcesses) {
      $remaining = [Math]::Max(0, [int]($stopDeadline - [DateTime]::UtcNow).TotalMilliseconds)
      if (-not $process.WaitForExit($remaining)) { throw 'An owned package process did not finish stopping.' }
    }
  } finally { foreach ($process in $stoppedProcesses) { $process.Dispose() } }
  $ownedProcessIds.Clear()
}
function Start-TestApplication {
  $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = $listener.LocalEndpoint.Port
  $listener.Stop()
  $arguments = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=$port"
  $applicationProcessId = Invoke-PackageActivation 'launch' $arguments
  $script:testApplicationProcessId = [int]$applicationProcessId
  return $port
}
function Invoke-AppProbe([int]$Port, [string]$Mode, [string]$Name) {
  $probeReport = Join-Path $reportPath ($Name + '.json')
  Invoke-TestTool 'node' @((Join-Path $PSScriptRoot 'probe-msix-installed.mjs'), '--port', "$Port", '--mode', $Mode,
    '--state', (Join-Path $workPath 'probe-state.json'), '--report', $probeReport)
  $probe = Get-Content -LiteralPath $probeReport -Raw | ConvertFrom-Json
  if (-not $probe.passed) { throw "Installed app probe failed: $Name" }
  $script:report.checks += $Name
}
function Remove-TestDirectData {
  if (Test-Path -LiteralPath $directStoreData) {
    $configPath = Join-Path $directStoreData 'config.json'
    $testConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ($testConfig.msixInstalledTestMarker -ne $marker) { throw 'Preserving unexpected Store data after the trial.' }
    $expectedStoreData = [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'EffeTune Store'))
    if ([IO.Path]::GetFullPath($directStoreData) -ne $expectedStoreData) { throw 'Unexpected test data cleanup path.' }
    Remove-Item -LiteralPath $directStoreData -Recurse -Force
  }
}
try {
  foreach ($directory in @($directStoreData)) {
    if (Test-Path -LiteralPath $directory) { throw "Existing Store user data must be preserved; use a clean dedicated test account: $directory" }
  }
  Invoke-TestTool $makeAppx @('unpack', '/p', $packagePath, '/d', (Join-Path $workPath 'candidate'), '/o')
  $candidateManifestPath = Join-Path $workPath 'candidate\AppxManifest.xml'
  $candidateManifestText = Get-Content -LiteralPath $candidateManifestPath -Raw
  [xml]$manifest = $candidateManifestText
  $identity = $manifest.Package.Identity
  if ($previousPath) {
    Invoke-TestTool $makeAppx @('unpack', '/p', $previousPath, '/d', (Join-Path $workPath 'previous'), '/o')
    [xml]$oldManifest = Get-Content -LiteralPath (Join-Path $workPath 'previous\AppxManifest.xml') -Raw
  } else {
    # First-run update trial: lower only the manifest version in a disposable copy.
    [xml]$oldManifest = $candidateManifestText
    $parts = @(([version]$identity.Version).Major, ([version]$identity.Version).Minor, ([version]$identity.Version).Build)
    $index = 2
    while ($index -gt 0 -and $parts[$index] -eq 0) { $parts[$index] = 65535; $index-- }
    if ($parts[$index] -le 0 -or ($index -eq 0 -and $parts[0] -le 1)) { throw 'Cannot synthesize an older Store version; supply -PreviousPackage.' }
    $parts[$index]--
    $oldManifest.Package.Identity.SetAttribute('Version', (($parts -join '.') + '.0'))
    $oldManifest.Save($candidateManifestPath)
    foreach ($generatedName in @('AppxBlockMap.xml', 'AppxSignature.p7x', '[Content_Types].xml')) {
      $generatedPath = Join-Path $workPath ('candidate\' + $generatedName)
      if (Test-Path -LiteralPath $generatedPath) { Remove-Item -LiteralPath $generatedPath }
    }
    $previousPath = Join-Path $workPath 'synthetic-previous.msix'
    Invoke-TestTool $makeAppx @('pack', '/d', (Join-Path $workPath 'candidate'), '/p', $previousPath, '/o')
    [IO.File]::WriteAllText($candidateManifestPath, $candidateManifestText)
    $report.checks += 'synthetic-previous-version'
  }
  if ($oldManifest.Package.Identity.Name -ne $identity.Name -or $oldManifest.Package.Identity.Publisher -ne $identity.Publisher -or
      [version]$oldManifest.Package.Identity.Version -ge [version]$identity.Version) { throw 'The update trial requires the same package Identity and a strictly older previous version.' }
  if ($identity.Name -ne $sourceMetadata.identity.name -or $identity.Publisher -ne $sourceMetadata.identity.publisher -or
      $identity.Version -ne $sourceMetadata.version) { throw 'MSIX manifest does not match store-package.json.' }
  if (Get-AppxPackage -Name $identity.Name) { throw 'This package is already registered. Use a clean dedicated test account.' }
  $packageDataRoot = Join-Path $env:LOCALAPPDATA 'Packages'
  if (Test-Path -LiteralPath $packageDataRoot) {
    if ([IO.Directory]::GetDirectories($packageDataRoot, $identity.Name + '_*').Count -gt 0) {
      throw 'Previous package data exists. Preserve it and use a clean dedicated test account.'
    }
  }
  $certificate = New-SelfSignedCertificate -Type Custom -Subject $identity.Publisher -KeyUsage DigitalSignature -KeyExportPolicy Exportable `
    -CertStoreLocation 'Cert:\CurrentUser\My' -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
  $cerPath = Join-Path $workPath 'test.cer'
  Export-Certificate -Cert $certificate -FilePath $cerPath | Out-Null
  $trustedCertificate = Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople'
  $previousSigned = Join-Path $workPath 'previous-signed.msix'
  $candidateSigned = Join-Path $workPath 'candidate-signed.msix'
  Copy-Item -LiteralPath $previousPath -Destination $previousSigned
  Copy-Item -LiteralPath $packagePath -Destination $candidateSigned
  foreach ($signedCopy in @($previousSigned, $candidateSigned)) {
    Invoke-TestTool $signTool @('sign', '/fd', 'SHA256', '/sha1', $certificate.Thumbprint, $signedCopy)
    Invoke-TestTool $signTool @('verify', '/pa', '/v', $signedCopy)
  }
  Add-Type -Path $activationInterop
  Initialize-ActivationTask
  $baselineVolume = -12.5
  $activationVolume = -37.25
  @{ marker = $marker; baselineVolume = $baselineVolume; activationVolume = $activationVolume } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $workPath 'probe-state.json') -Encoding utf8
  Add-AppxPackage -Path $candidateSigned
  $installedPackage = Get-AppxPackage -Name $identity.Name
  $port = Start-TestApplication
  Invoke-AppProbe $port 'seed' 'clean-install'
  Stop-TestApplication
  $port = Start-TestApplication
  Invoke-AppProbe $port 'check' 'restart'
  Stop-TestApplication
  Remove-AppxPackage -Package $installedPackage.PackageFullName
  $installedPackage = $null
  Remove-TestDirectData
  Add-AppxPackage -Path $previousSigned
  $installedPackage = Get-AppxPackage -Name $identity.Name
  $port = Start-TestApplication
  Invoke-AppProbe $port 'seed' 'upgrade-baseline'
  Stop-TestApplication
  Add-AppxPackage -Path $candidateSigned
  $installedPackage = Get-AppxPackage -Name $identity.Name
  $port = Start-TestApplication
  Invoke-AppProbe $port 'check' 'update'
  $activationFile = Join-Path $workPath 'activation.effetune_preset'
  $activationPreset = @{ pipeline = @(@{ name = 'Volume'; enabled = $true; parameters = @{ vl = $activationVolume } }) }
  [IO.File]::WriteAllText($activationFile, ($activationPreset | ConvertTo-Json -Depth 8))
  Invoke-AppProbe $port 'file-prepare' 'file-activation-baseline'
  Invoke-PackageActivation 'file' '' $activationFile
  Invoke-AppProbe $port 'file-check' 'file-activation'
  # Require the registered protocol to restore this known app; foreground focus is an observation.
  $applicationWindow = (Get-Process -Id $testApplicationProcessId).MainWindowHandle
  if ($applicationWindow -eq [IntPtr]::Zero) { throw 'The package main window is unavailable for the protocol activation trial.' }
  [MsixTrial.Native]::ShowWindow($applicationWindow, 6) | Out-Null
  if (-not [MsixTrial.Native]::IsIconic($applicationWindow)) { throw 'Could not minimize the application before testing protocol activation.' }
  Invoke-PackageActivation 'protocol' '' 'effetune://'
  $activationDeadline = [DateTime]::UtcNow.AddSeconds(15)
  while ([MsixTrial.Native]::IsIconic($applicationWindow)) {
    if ([DateTime]::UtcNow -ge $activationDeadline) { throw 'Protocol activation did not restore the minimized application.' }
    Start-Sleep -Milliseconds 100
  }
  $report['protocolWindow'] = @{ appPid = $testApplicationProcessId; windowHandle = $applicationWindow.ToInt64()
    minimized = [MsixTrial.Native]::IsIconic($applicationWindow); foregroundMatches = [MsixTrial.Native]::GetForegroundWindow() -eq $applicationWindow }
  $report.checks += 'protocol-activation-restores-window'
  Invoke-AppProbe $port 'check' 'protocol-activation'
  $registeredManifest = Get-AppxPackageManifest -Package $installedPackage.PackageFullName
  $startup = $registeredManifest.SelectSingleNode('//*[local-name()="StartupTask" and @TaskId="EffeTuneStartup"]')
  if (-not $startup -or $startup.Enabled -ne 'false') { throw 'The disabled-by-default StartupTask is missing from the registered manifest.' }
  $report.checks += 'startup-task-registration'
  Stop-TestApplication
  $wackReport = Join-Path $reportPath 'wack.xml'
  Invoke-TestTool $WackPath @('test', '-packagefullname', $installedPackage.PackageFullName, '-reportoutputpath', $wackReport)
  [xml]$wack = Get-Content -LiteralPath $wackReport -Raw
  $report['wack'] = Get-WackEvaluation $wack
  foreach ($item in $report.wack.nonPassTests) {
    Write-Output "WACK $($item.result): $($item.index) $($item.name) (optional=$($item.optional))"
    foreach ($message in $item.messages) { Write-Output "  $message" }
  }
  if (-not $report.wack.accepted) { throw "WACK validation failed: $($report.wack.errors -join '; '); inspect wack.xml." }
  $report.checks += 'wack'
  $report.passed = $true
} catch {
  $report.error = $_.Exception.Message
  throw
} finally {
  if ($runningActivation) {
    try {
      $activationTask.Stop(0)
      $taskStopDeadline = [DateTime]::UtcNow.AddSeconds(10)
      do {
        if ($activationTask.State -eq 3) { break }
        if ([DateTime]::UtcNow -ge $taskStopDeadline) { throw 'The owned activation task did not stop.' }
        Start-Sleep -Milliseconds 100
      } while ($true)
    } catch {
      $report.passed = $false
      $report.cleanupErrors += $_.Exception.Message
      if (-not $report.error) { $report.error = $_.Exception.Message }
    }
  }
  if ($installedPackage) {
    # WACK also launches this test-only package; capture those processes before cleanup.
    try {
      foreach ($candidate in @(Get-CimInstance Win32_Process)) {
        if ($candidate.ExecutablePath -and $candidate.ExecutablePath.StartsWith($installedPackage.InstallLocation + '\', [StringComparison]::OrdinalIgnoreCase)) {
          $ownedProcessIds.Add([int]$candidate.ProcessId) | Out-Null
        }
      }
    } catch {
      $report.passed = $false
      $report.cleanupErrors += $_.Exception.Message
      if (-not $report.error) { $report.error = $_.Exception.Message }
    }
  }
  foreach ($cleanup in @(
    { Stop-TestApplication },
    { if ($installedPackage) { Remove-AppxPackage -Package $installedPackage.PackageFullName } },
    { if ($activationTask) { $activationTaskFolder.DeleteTask($activationTaskName, 0) } },
    { if ($trustedCertificate) { Remove-Item -LiteralPath ('Cert:\LocalMachine\TrustedPeople\' + $trustedCertificate.Thumbprint) } },
    { if ($certificate) { Remove-Item -LiteralPath ('Cert:\CurrentUser\My\' + $certificate.Thumbprint) } },
    { Remove-TestDirectData },
    { if ((Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $originalHash) { throw 'The unsigned submission original was modified.' } }
  )) {
    try { & $cleanup } catch {
      $report.passed = $false
      $cleanupError = 'Cleanup or original-package integrity failed: ' + $_.Exception.Message
      $report.cleanupErrors += $cleanupError
      if (-not $report.error) { $report.error = $cleanupError }
      Write-Error $cleanupError -ErrorAction Continue
    }
  }
  if ($report.passed) {
    try {
      New-Item -ItemType Directory -Force -Path $ValidatedPackageDirectory | Out-Null
      Copy-Item -LiteralPath $packagePath -Destination (Join-Path $ValidatedPackageDirectory 'last-validated.msix') -Force
      Copy-Item -LiteralPath $metadataPath -Destination $baselineMetadataPath -Force
    } catch {
      $report.passed = $false
      $report.error = 'Could not preserve the validated original for the next update trial: ' + $_.Exception.Message
    }
  }
  # Only this invocation's scratch folder is removed. Reports and screenshots remain.
  if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($workPath)) -eq $reportPath) {
    for ($attempt = 0; $attempt -lt 5; $attempt++) {
      try { Remove-Item -LiteralPath $workPath -Recurse -Force; break } catch {
        if ($attempt -eq 4) {
          $report.passed = $false
          $report.cleanupErrors += $_.Exception.Message
          if (-not $report.error) { $report.error = $_.Exception.Message }
          break
        }
        Start-Sleep -Milliseconds 500
      }
    }
  }
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $reportPath 'installed-test.json') -Encoding utf8
}
if (-not $report.passed) { throw 'The installed-package trial failed; inspect installed-test.json.' }
