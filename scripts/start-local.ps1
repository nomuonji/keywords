$ErrorActionPreference = 'Stop'
$keywordsRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$bundledNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
$keywordsNode = if ($env:KEYWORDS_NODE) { $env:KEYWORDS_NODE } elseif (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node -ErrorAction Stop).Source }
$major = [int]((& $keywordsNode --version).TrimStart('v').Split('.')[0])
if ($major -lt 22) { throw 'Node.js 22以上をKEYWORDS_NODEに指定してください。' }
$env:PATH = (Split-Path $keywordsNode) + ';' + $env:PATH
Push-Location $keywordsRoot
try { npm run dev } finally { Pop-Location }
