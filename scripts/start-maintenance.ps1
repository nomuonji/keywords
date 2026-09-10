param([string]$NodePath = $env:KEYWORDS_NODE)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot 'autopilot-runner.ts'
$existing = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'node.exe' -and $_.CommandLine -match 'autopilot-runner\.ts' -and $_.CommandLine -match '--maintenance-only'
}
if ($existing) {
  @{ started = $false; processIds = @($existing.ProcessId); reason = 'Maintenance worker is already running' } | ConvertTo-Json -Compress
  exit 0
}
if (-not $NodePath) {
  $bundled = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
  $NodePath = if (Test-Path -LiteralPath $bundled) { $bundled } else { (Get-Command node -ErrorAction Stop).Source }
}
$nodeVersion = & $NodePath --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) { throw 'Maintenance requires Node.js 22 or newer. Set KEYWORDS_NODE or pass -NodePath.' }
$env:PATH = (Split-Path -Parent $NodePath) + ';' + $env:PATH
$env:KEYWORDS_AGENT_ID = 'codex-maintenance'
$logDirectory = Join-Path $workspace 'data/maintenance-logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdout = Join-Path $logDirectory "$stamp.stdout.log"
$stderr = Join-Path $logDirectory "$stamp.stderr.log"
$tsx = Join-Path $workspace 'node_modules/tsx/dist/cli.mjs'
$arguments = @(('"{0}"' -f $tsx), ('"{0}"' -f $runner), '--maintenance-only')
$worker = Start-Process -FilePath $NodePath -ArgumentList $arguments -WorkingDirectory $workspace -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
if ($worker.WaitForExit(1000)) { throw "Maintenance worker exited during startup. Inspect $stderr" }
@{ started = $true; processId = $worker.Id; stdout = $stdout; stderr = $stderr } | ConvertTo-Json -Compress
