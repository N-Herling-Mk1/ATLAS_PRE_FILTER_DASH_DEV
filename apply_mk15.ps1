# apply_mk15.ps1 -- run from the ATLAS_PRE_FILTER_DASH repo root AFTER extracting
# the mk15 drop flat into it.
#
#   powershell -ExecutionPolicy Bypass -File .\apply_mk15.ps1
#
# mk15: slower console mark loop, the jiggle removed, title band nudged down.

$ErrorActionPreference = "Stop"

$expected = [ordered]@{
    "web\static\public\css\gate.css"    = "4a7177b4c74c4362cc4ebd1238f0729adc7389ff5c5f2488cb17baff7aa3b8f6"
    "web\static\public\js\crt_mark.js"  = "1c2f3345ebb403211729bfb37fd287aef3fd14dd3465c740e49ba217115274ca"
    "docs\STAGE_A_SCOPE_mk2.md"         = "2df0dd21fec3ec67d226fda18a291ecd8279bc28b73eb7fbf5fbe141eb57816c"
}

Write-Host "ATLAS-Dashboard-mk_1 :: apply mk15" -ForegroundColor Cyan
Write-Host ("-" * 62)

$i = 0; $n = $expected.Count; $bad = @()
foreach ($path in $expected.Keys) {
    $i++
    Write-Progress -Activity "Verifying mk15" -Status $path -PercentComplete (100 * $i / $n)
    if (-not (Test-Path $path)) {
        Write-Host ("  MISSING   {0}" -f $path) -ForegroundColor Red
        $bad += $path; continue
    }
    Unblock-File -Path $path -ErrorAction SilentlyContinue
    $h = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLower()
    if ($h -eq $expected[$path]) {
        Write-Host ("  ok        {0}" -f $path) -ForegroundColor Green
    } else {
        Write-Host ("  MISMATCH  {0}" -f $path) -ForegroundColor Red
        Write-Host ("            want {0}" -f $expected[$path]) -ForegroundColor DarkGray
        Write-Host ("            have {0}" -f $h) -ForegroundColor DarkGray
        $bad += $path
    }
}
Write-Progress -Activity "Verifying mk15" -Completed

# the jiggle should be gone from the stylesheet entirely
if (Select-String -Path "web\static\public\css\gate.css" -SimpleMatch -Pattern "crt-hold" -Quiet) {
    Write-Host ""
    Write-Host "  STALE     crt-hold still present in gate.css -- old copy applied" -ForegroundColor Yellow
}

Write-Host ("-" * 62)
if ($bad.Count) {
    Write-Host ("FAILED on {0} file(s). Re-extract the drop and re-run." -f $bad.Count) -ForegroundColor Red
    exit 1
}
Write-Host "mk15 verified." -ForegroundColor Cyan
Write-Host ""
Write-Host "Ctrl+F5. The mark loop is 18.6 s now, so give it half a minute to see both" -ForegroundColor Yellow
Write-Host "states and a scramble in each direction." -ForegroundColor Yellow
