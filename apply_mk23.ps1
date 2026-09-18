# apply_mk23.ps1 -- run from the ATLAS_PRE_FILTER_DASH repo root AFTER extracting
# the mk23 drop flat into it.
#
#   powershell -ExecutionPolicy Bypass -File .\apply_mk23.ps1
#
# mk23: hub relaid into three sets, small cards, and a rotating deck in the main
# area. Templates and static only -- no Python, so no server restart needed.

$ErrorActionPreference = "Stop"

$expected = [ordered]@{
    "web\templates\hub.html"                           = "0064d325fa4e81274d4f409f8001012f18db8204af09313eb882ad25281feb35"
    "web\static\public\css\hub.css"                    = "09a8159c6f5ee1d31369bd11cb1b1230433ed008d3d4baa5cf807d621d251dfc"
    "web\static\app\js\hub.js"                         = "900fe165a425c987d254229f82428a5b3c33617e77c3ba51f14a34b117f8a595"
    "web\static\app\js\deck.js"                        = "f43e1d67560871fcd69abd8c7ec232d71377bd33373adc526abe24c48d2060e3"
    "web\static\public\assets\images\proton_2_256.png" = "9ef633fcdfbe624578f9fc97912ec5f48ce5710ab9ecee1d65b7ccfcd40649d8"
    "docs\STAGE_A_SCOPE_mk2.md"                        = "466dd75caf6a176f6c9ab7767eb6c13502c7672c2666a67ef3254536f2bf739a"
}

Write-Host "ATLAS-Dashboard-mk_1 :: apply mk23  (hub layout + deck)" -ForegroundColor Cyan
Write-Host ("-" * 70)

$i = 0; $n = $expected.Count; $bad = @()
foreach ($path in $expected.Keys) {
    $i++
    Write-Progress -Activity "Verifying mk23" -Status $path -PercentComplete (100 * $i / $n)
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
Write-Progress -Activity "Verifying mk23" -Completed

# every image the gate and the nav actually reference must exist
Write-Host ""
Write-Host "Referenced marks" -ForegroundColor Cyan
$imgDir = "web\static\public\assets\images"
foreach ($f in @("proton_2_256.png", "proton_crt_64.png", "favicon.svg")) {
    if (Test-Path (Join-Path $imgDir $f)) { Write-Host ("  present   {0}" -f $f) -ForegroundColor Green }
    else { Write-Host ("  MISSING   {0}  <- a page references this" -f $f) -ForegroundColor Red; $bad += $f }
}

$skip = @("favicon.svg", "proton_2.png", "proton_2_256.png", "proton_crt_64.png")
$tv = Get-ChildItem $imgDir -File |
      Where-Object { $skip -notcontains $_.Name -and $_.Extension -match '^\.(png|jpg|jpeg|gif|webp|avif)$' }
Write-Host ""
Write-Host ("TV sources: {0}" -f $tv.Count) -ForegroundColor Cyan
$tv | ForEach-Object { Write-Host ("  {0}" -f $_.Name) -ForegroundColor DarkGray }

Write-Host ("-" * 70)
if ($bad.Count) {
    Write-Host ("FAILED on {0} item(s)." -f $bad.Count) -ForegroundColor Red
    exit 1
}
Write-Host "mk23 verified. No server restart needed -- Ctrl+F5 on / ." -ForegroundColor Cyan
