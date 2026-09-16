# apply_mk17.ps1 -- run from the ATLAS_PRE_FILTER_DASH repo root AFTER extracting
# the mk17 drop flat into it.
#
#   powershell -ExecutionPolicy Bypass -File .\apply_mk17.ps1

$ErrorActionPreference = "Stop"

$expected = [ordered]@{
    "web\static\public\css\gate.css"  = "5920db4daf72e90b7b38275b2291ec603ed433442e70ee4e93ad27ea8f11bb90"
    "web\static\public\js\gate.js"    = "50addefdecf436e31ea3cdc6b0e67336360d0f69894a487d58831e83b3b2cab3"
    "docs\STAGE_A_SCOPE_mk2.md"       = "0585b77af81b8af63214268c627755de3f42591629e5bb739a6df457f892894a"
}

Write-Host "ATLAS-Dashboard-mk_1 :: apply mk17" -ForegroundColor Cyan
Write-Host ("-" * 62)

$i = 0; $n = $expected.Count; $bad = @()
foreach ($path in $expected.Keys) {
    $i++
    Write-Progress -Activity "Verifying mk17" -Status $path -PercentComplete (100 * $i / $n)
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
Write-Progress -Activity "Verifying mk17" -Completed

Write-Host ("-" * 62)
if ($bad.Count) {
    Write-Host ("FAILED on {0} file(s). Re-extract the drop and re-run." -f $bad.Count) -ForegroundColor Red
    exit 1
}
Write-Host "mk17 verified." -ForegroundColor Cyan
Write-Host ""
Write-Host "Ctrl+F5. Sign in CORRECTLY to see the green -- it is the success state only." -ForegroundColor Yellow
