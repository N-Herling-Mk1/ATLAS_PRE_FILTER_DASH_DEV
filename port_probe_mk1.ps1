# port_probe_mk1.ps1 -- find which local port ATLAS-Dashboard-mk_1 is actually on.
#
#   powershell -ExecutionPolicy Bypass -File .\port_probe_mk1.ps1
#
# Leave the server running in its own terminal and run this in a second one.
# /health is public (no login) and returns the plain text "ok", so whichever
# port answers it is the live app. Also lists every listener in the range with
# its owning process, so a stale run from an earlier session is visible by name.

$ErrorActionPreference = "Continue"
$ports = 5700..5715 + 8700..8715

Write-Host "ATLAS-Dashboard-mk_1 :: port probe" -ForegroundColor Cyan
Write-Host ("-" * 68)

# ---- 1. who is listening -------------------------------------------------
Write-Host "Listeners in range" -ForegroundColor Cyan
$listening = @()
try {
    $listening = Get-NetTCPConnection -State Listen -ErrorAction Stop |
                 Where-Object { $ports -contains $_.LocalPort }
} catch {
    Write-Host "  Get-NetTCPConnection unavailable; falling back to netstat" -ForegroundColor Yellow
    $listening = @()
}

if ($listening) {
    foreach ($c in ($listening | Sort-Object LocalPort)) {
        $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        $name = if ($p) { $p.ProcessName } else { "?" }
        $started = if ($p -and $p.StartTime) { $p.StartTime.ToString("HH:mm:ss") } else { "?" }
        Write-Host ("  {0,-6} pid {1,-7} {2,-12} started {3}" -f `
            $c.LocalPort, $c.OwningProcess, $name, $started)
    }
} else {
    Write-Host "  nothing listening in 5700-5715 or 8700-8715" -ForegroundColor Yellow
    Write-Host "  -> the server is not running, or it bound somewhere else entirely" -ForegroundColor Yellow
}

# ---- 2. which one answers /health ----------------------------------------
Write-Host ""
Write-Host "Probing /health" -ForegroundColor Cyan
$live = @()
$i = 0
foreach ($port in $ports) {
    $i++
    Write-Progress -Activity "Probing" -Status "port $port" -PercentComplete (100 * $i / $ports.Count)

    # cheap TCP check first so closed ports do not each cost a web timeout
    $sock = New-Object System.Net.Sockets.TcpClient
    $open = $false
    try {
        $iar = $sock.BeginConnect("127.0.0.1", $port, $null, $null)
        $open = $iar.AsyncWaitHandle.WaitOne(120, $false) -and $sock.Connected
    } catch { $open = $false } finally { $sock.Close() }
    if (-not $open) { continue }

    $url = "http://127.0.0.1:$port/health"
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3
        $body = ($r.Content | Out-String).Trim()
        if ($body -eq "ok") {
            Write-Host ("  {0,-6} HTTP {1}  '{2}'   <- the dashboard" -f $port, $r.StatusCode, $body) -ForegroundColor Green
            $live += $port
        } else {
            Write-Host ("  {0,-6} HTTP {1}  '{2}'   (something else answers here)" -f `
                $port, $r.StatusCode, $body) -ForegroundColor Yellow
        }
    } catch {
        Write-Host ("  {0,-6} open, but /health failed: {1}" -f $port, $_.Exception.Message) -ForegroundColor Yellow
    }
}
Write-Progress -Activity "Probing" -Completed

# ---- 3. verdict -----------------------------------------------------------
Write-Host ""
Write-Host ("-" * 68)
if ($live.Count -eq 1) {
    $u = "http://127.0.0.1:$($live[0])/login"
    Write-Host "Open this:" -ForegroundColor Cyan
    Write-Host "  $u" -ForegroundColor White
    Write-Host ""
    Write-Host "Hard-reload once it opens (Ctrl+F5): /static/public/* is cacheable." -ForegroundColor DarkGray
    Write-Host "  Start-Process msedge `"$u`"" -ForegroundColor DarkGray
} elseif ($live.Count -gt 1) {
    Write-Host ("{0} ports answer /health: {1}" -f $live.Count, ($live -join ", ")) -ForegroundColor Yellow
    Write-Host "That means an older run is still up. Use the HIGHEST one (the newest" -ForegroundColor Yellow
    Write-Host "reloader child), or stop everything and start clean:" -ForegroundColor Yellow
    Write-Host '  Get-Process python | Where-Object { $_.Path -like "C:\venvs\atlas_pfd\*" } | Stop-Process -Force' -ForegroundColor DarkGray
} else {
    Write-Host "Nothing answered /health." -ForegroundColor Red
    Write-Host "The Flask reloader recomputes the port in the child process, so the" -ForegroundColor Red
    Write-Host "banner can name a port nothing is bound to. Try parity mode, which uses" -ForegroundColor Red
    Write-Host "waitress with no reloader:" -ForegroundColor Red
    Write-Host "  .\run_local.ps1 -Data home -Mode parity" -ForegroundColor DarkGray
}
