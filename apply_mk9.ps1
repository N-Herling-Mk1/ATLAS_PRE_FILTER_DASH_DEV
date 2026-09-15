# apply_mk9.ps1 -- run from the ATLAS_PRE_FILTER_DASH repo root AFTER extracting
# the drop flat into it. Unblocks the dropped files, verifies each landed by
# marker string (not size or timestamp -- OneDrive reverts silently), retires the
# old web/static/public/img folder, and reports.
#
#   powershell -ExecutionPolicy Bypass -File .\apply_mk9.ps1

$ErrorActionPreference = "Stop"

$checks = [ordered]@{
    "web\templates\login.html"                        = "ATLAS-Dashboard-mk_1"
    "web\templates\base.html"                         = "brand-mark"
    "web\static\public\css\gate.css"                  = ".seg7"
    "web\static\public\css\pfd.css"                   = "brand-mark"
    "web\static\public\js\gate.js"                    = "idPixels"
    "web\static\public\js\seg7.js"                    = "SEG7"
    "web\static\public\js\arrive.js"                  = "login=1"
    "web\static\public\assets\images\proton_2.png"    = $null
    "web\static\public\assets\images\proton_2_256.png"= $null
    "web\static\public\assets\images\favicon.svg"     = $null
    "server\app.py"                                   = '"assets", "images"'
    "docs\STAGE_A_SCOPE_mk2.md"                       = "mk9."
}

Write-Host "ATLAS-Dashboard-mk_1 :: apply mk9" -ForegroundColor Cyan
Write-Host ("-" * 52)

$i = 0; $n = $checks.Count; $bad = @()
foreach ($path in $checks.Keys) {
    $i++
    Write-Progress -Activity "Verifying drop" -Status $path -PercentComplete (100 * $i / $n)
    if (-not (Test-Path $path)) {
        Write-Host ("  MISSING  {0}" -f $path) -ForegroundColor Red
        $bad += $path
        continue
    }
    Unblock-File -Path $path -ErrorAction SilentlyContinue
    $marker = $checks[$path]
    if ($marker) {
        if (Select-String -Path $path -SimpleMatch -Pattern $marker -Quiet) {
            Write-Host ("  ok       {0}" -f $path) -ForegroundColor Green
        } else {
            Write-Host ("  STALE    {0}  (marker '{1}' not found)" -f $path, $marker) -ForegroundColor Red
            $bad += $path
        }
    } else {
        $kb = [math]::Round((Get-Item $path).Length / 1KB, 1)
        Write-Host ("  ok       {0}  ({1} KB)" -f $path, $kb) -ForegroundColor Green
    }
}
Write-Progress -Activity "Verifying drop" -Completed

# the old image folder is retired: favicon now served from assets\images
$old = "web\static\public\img"
if (Test-Path $old) {
    Write-Host ""
    Write-Host "Retiring $old (favicon moved to assets\images)" -ForegroundColor Yellow
    Remove-Item -Recurse -Force $old
    Write-Host "  removed" -ForegroundColor Green
}

Write-Host ("-" * 52)
if ($bad.Count) {
    Write-Host ("FAILED on {0} file(s). Re-extract the drop, then re-run." -f $bad.Count) -ForegroundColor Red
    exit 1
}
Write-Host "All files verified. Start the server and open /login." -ForegroundColor Cyan
