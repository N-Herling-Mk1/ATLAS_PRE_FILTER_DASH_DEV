# apply_mk25b.ps1 -- run from the ATLAS_PRE_FILTER_DASH repo root after extracting
# the mk25b zip into 0_ATLAS_DASHBORD (the zip carries the ATLAS_PRE_FILTER_DASH level).
#
#   powershell -ExecutionPolicy Bypass -File .\apply_mk25b.ps1
#
# mk25b: controls left of the deck, hub fits the screen, deck returns from the
# dock full size, sound on by default, rounded panels, red underline on the
# selection. CSS + JS only -- no restart needed, Ctrl+F5.

$ErrorActionPreference = "Stop"
$expected = [ordered]@{
    "web\static\public\css\hub.css"        = "07da5378719f155d5b1a2a5f6517be486e7035f784395fa4b0bc334eefdf1f35"
    "web\static\app\js\deck.js"            = "0f0aeb937f2f71e693ab4674464378b68d6834aa40d92eab32b1a2b291a90662"
    "web\static\app\js\sfx.js"             = "762449f98810e194d53a2880741b404f113574dad246d8a10e88c797761d2a56"
    "docs\STAGE_A_SCOPE_mk2.md"            = "d6cc2a30e84cf76d2ef11130687840642d77bffea2da3a9041806cc2430d00b1"
}
Write-Host "ATLAS-Dashboard-mk_1 :: apply mk25b  (hub layout pass)" -ForegroundColor Cyan
Write-Host ("-" * 70)

# unblock the WHOLE tree, not just the files below -- mk25 only unblocked what
# it hashed, and run_local.ps1 then refused to start
Write-Host "  unblocking every file under the repo (Zone.Identifier)" -ForegroundColor DarkGray
Get-ChildItem -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

$i = 0; $n = $expected.Count; $bad = @()
foreach ($path in $expected.Keys) {
    $i++
    Write-Progress -Activity "Verifying mk25b" -Status $path -PercentComplete (100 * $i / $n)
    if (-not (Test-Path $path)) { Write-Host ("  MISSING   {0}" -f $path) -ForegroundColor Red; $bad += $path; continue }
    $h = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLower()
    if ($h -eq $expected[$path]) { Write-Host ("  ok        {0}" -f $path) -ForegroundColor Green }
    else { Write-Host ("  MISMATCH  {0}" -f $path) -ForegroundColor Red; $bad += $path }
}
Write-Progress -Activity "Verifying mk25b" -Completed
Write-Host ("-" * 70)
if ($bad.Count) { Write-Host "FAILED. Re-extract and re-run." -ForegroundColor Red; exit 1 }
Write-Host "mk25b verified. Ctrl+F5 on / (no restart: CSS and JS only)." -ForegroundColor Cyan
Write-Host "Sound is now ON by default -- unless you switched it off before; one click on the speaker resets that." -ForegroundColor DarkGray
