param([ValidateRange(1024, 65535)][int]$Port = 8765)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$files = @{
    "/" = @("index.html", "text/html; charset=utf-8")
    "/index.html" = @("index.html", "text/html; charset=utf-8")
    "/styles.css" = @("styles.css", "text/css; charset=utf-8")
    "/app.js" = @("app.js", "text/javascript; charset=utf-8")
    "/diary.js" = @("diary.js", "text/javascript; charset=utf-8")
    "/LICENSE" = @("LICENSE", "text/plain; charset=utf-8")
}
$csp = "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"

function Send-Response($stream, [int]$status, [string]$contentType, [byte[]]$body) {
    $statusText = if ($status -eq 200) { "OK" } elseif ($status -eq 404) { "Not Found" } else { "Service Unavailable" }
    $header = "HTTP/1.1 $status $statusText`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nConnection: close`r`nCache-Control: no-cache`r`nX-Content-Type-Options: nosniff`r`nReferrer-Policy: no-referrer`r`nContent-Security-Policy: $csp`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
}

try {
    $listener.Start()
    $host.UI.RawUI.WindowTitle = "Her Little Book local server - close this window to stop"
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
            $requestLine = $reader.ReadLine()
            while ($true) {
                $line = $reader.ReadLine()
                if ($null -eq $line -or $line.Length -eq 0) { break }
            }
            $parts = @($requestLine -split " ")
            $method = if ($parts.Length -gt 0) { $parts[0] } else { "" }
            $path = if ($parts.Length -gt 1) { ($parts[1] -split "\?", 2)[0] } else { "" }

            if ($method -eq "GET" -and $files.ContainsKey($path)) {
                $file = Join-Path $root $files[$path][0]
                $body = [System.IO.File]::ReadAllBytes($file)
                Send-Response $stream 200 $files[$path][1] $body
            } elseif ($method -eq "GET" -and $path -eq "/api/status") {
                $body = [System.Text.Encoding]::UTF8.GetBytes('{"ok":true,"ollama":false,"models":[],"detail":"Python and Ollama are optional. The diary works offline."}')
                Send-Response $stream 200 "application/json; charset=utf-8" $body
            } elseif ($method -eq "GET" -and $path -eq "/api/models") {
                $body = [System.Text.Encoding]::UTF8.GetBytes('{"models":[]}')
                Send-Response $stream 200 "application/json; charset=utf-8" $body
            } else {
                $status = if ($path -like "/api/*") { 503 } else { 404 }
                $message = if ($status -eq 503) { "AI chat needs Python and Ollama. Your diary still works offline." } else { "Not found." }
                $body = [System.Text.Encoding]::UTF8.GetBytes((@{ error = $message } | ConvertTo-Json -Compress))
                Send-Response $stream $status "application/json; charset=utf-8" $body
            }
            $stream.Flush()
        } catch {
            Write-Host "A local browser request could not be served: $($_.Exception.Message)"
        } finally {
            if ($client) { $client.Close() }
        }
    }
} finally {
    $listener.Stop()
}
