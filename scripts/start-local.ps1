param([switch]$NoOpen)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$url = 'http://127.0.0.1:5173/'

function Test-HousePreview {
    try {
        $page = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
        return $page.StatusCode -eq 200 -and $page.Content.Contains('/src/main.jsx')
    } catch {
        return $false
    }
}

if (-not (Test-HousePreview)) {
    if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) {
        throw 'Port 5173 is in use by another application. Close it before starting the house.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $project 'node_modules'))) {
        throw 'Dependencies are missing. Run npm install in the yimiao-house folder first.'
    }
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    $runtime = Join-Path $project '.wrangler'
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    $arguments = '/d /s /c ""{0}" run dev"' -f $npm
    Start-Process -FilePath $env:ComSpec -ArgumentList $arguments -WorkingDirectory $project -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'preview-out.log') -RedirectStandardError (Join-Path $runtime 'preview-error.log') | Out-Null
}

$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if (Test-HousePreview) {
        try {
            $api = Invoke-WebRequest -Uri ($url + 'api/session') -UseBasicParsing -TimeoutSec 2
            if ($api.StatusCode -eq 200) { $ready = $true; break }
        } catch {}
    }
    Start-Sleep -Seconds 1
}
if (-not $ready) {
    throw 'The house did not start. Check .wrangler/preview-error.log in the project folder.'
}
if (-not $NoOpen) { Start-Process $url }
