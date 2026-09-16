# apply_mk16.ps1 -- run from the ATLAS_PRE_FILTER_DASH repo root AFTER extracting
# the mk16 drop flat into it.
#
#   powershell -ExecutionPolicy Bypass -File .\apply_mk16.ps1

$ErrorActionPreference = "Stop"

$expected = [ordered]@{
    "web\templates\login.html"        = "afbba6dbadf7c5ff97227689f0ba7901b9582f8b4374d8cb7a77199b779b4ce9"
    "web\static\public\css\gate.css"  = "17e97fe32ffcfd4847d463aad94f2381e6a9433a93fe1f1a647d863143198777"
    "web\static\public\js\gate.js"    = "cee1e6396796726e223c69cd106776d5d872189cdf142c6ce6995fe4707c7ef7"
    "docs\STAGE_A_SCOPE_mk2.md"       = "2b31aee9d9ef3a0434778fd9dd504a549afb56c7ee3fb29a3cd808235345ad3e"
}

Write-Host "ATLAS-Dashboard-mk_1 :: apply mk16" -ForegroundColor Cyan
Write-Host ("-" * 62)

$i = 0; $n = $expected.Count; $bad = @()
foreach ($path in $expected.Keys) {
    $i++
    Write-Progress -Activity "Verifying mk16" -Status $path -PercentComplete (100 * $i / $n)
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
Write-Progress -Activity "Verifying mk16" -Completed

Write-Host ("-" * 62)
if ($bad.Count) {
    Write-Host ("FAILED on {0} file(s). Re-extract the drop and re-run." -f $bad.Count) -ForegroundColor Red
    exit 1
}
Write-Host "mk16 verified." -ForegroundColor Cyan
Write-Host ""
Write-Host "Ctrl+F5, then try a WRONG password first -- the reset only shows on failure." -ForegroundColor Yellow
