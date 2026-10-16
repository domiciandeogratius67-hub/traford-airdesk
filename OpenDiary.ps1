$ErrorActionPreference = "Stop"
$siteUrl = "http://127.0.0.1:8765/"
$root = $PSScriptRoot

function Test-HerLittleBook {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $siteUrl -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content.Contains("For you, always")
    } catch {
        return $false
    }
}

if (-not (Test-HerLittleBook)) {
    $pythonLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    $pythonPath = $null
    $pythonArguments = $null
    if ($pythonLauncher) {
        & $pythonLauncher.Source -3 --version 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $pythonPath = $pythonLauncher.Source
            $pythonArguments = "-3 -u `"$root\companion\server.py`""
        }
    }
    if (-not $pythonPath -and $python) {
        & $python.Source --version 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $pythonPath = $python.Source
            $pythonArguments = "-u `"$root\companion\server.py`""
        }
    }
    if ($pythonPath) {
        Start-Process -FilePath $pythonPath -ArgumentList $pythonArguments -WindowStyle Minimized
    } else {
        $serverPath = Join-Path $root "companion\static_server.ps1"
        $arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$serverPath`""
        Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WindowStyle Minimized
    }

    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 500
        if (Test-HerLittleBook) {
            $ready = $true
            break
        }
    }
    if (-not $ready -and $pythonPath) {
        $serverPath = Join-Path $root "companion\static_server.ps1"
        $arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$serverPath`""
        Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WindowStyle Minimized
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Milliseconds 500
            if (Test-HerLittleBook) {
                $ready = $true
                break
            }
        }
    }
    if (-not $ready) {
        Write-Host "Her Little Book could not start its local web server." -ForegroundColor Red
        Write-Host "Make sure this folder is extracted, then try Open Her Little Book.bat again."
        Write-Host "If port 8765 is already in use, close that program and retry."
        Read-Host "Press Enter to close"
        exit 1
    }
}

Start-Process $siteUrl
