# apply_mk25d.ps1 -- run from the ATLAS_PRE_FILTER_DASH repo root after extracting
# the mk25d zip into 0_ATLAS_DASHBORD (the zip carries the ATLAS_PRE_FILTER_DASH level).
#
#   powershell -ExecutionPolicy Bypass -File .\apply_mk25d.ps1
#
# mk25d: control box top-left, bigger deck, click effects on the control box,
# TV letterboxed (no crop) with RGB fringe + shear. Template + CSS + JS.

$ErrorActionPreference = "Stop"
$expected = [ordered]@{
    "web\templates\hub.html"               = "62057fdcdaa687e5a466d4c28ce255b67b9ebbb0fb39aad8a8bcac4a8d915122"
    "web\static\public\css\hub.css"        = "25e8c9598d66c417b1146d1dcd853a43ffe7f599967add53eb6b4709bbd64aac"
    "web\static\app\js\deck.js"            = "1040af291c8de946a440adcaa80b2840c22428f334c236e072b8d57e615f4816"
    "web\static\app\js\hub.js"             = "c75aa025d004e6f6a705552e176d40c6457baf43a9ec66b373e4f05a57bde3da"
    "docs\STAGE_A_SCOPE_mk2.md"            = "c27f434cac4f9a2a92ae45c5baf1eb6472d16b01b5f47a5495f70afaf249ba24"
}
Write-Host "ATLAS-Dashboard-mk_1 :: apply mk25d  (control box top-left, click fx, TV RGB shear)" -ForegroundColor Cyan
Write-Host ("-" * 70)
Write-Host "  unblocking every file under the repo (Zone.Identifier)" -ForegroundColor DarkGray
Get-ChildItem -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

$i = 0; $n = $expected.Count; $bad = @()
foreach ($path in $expected.Keys) {
    $i++
    Write-Progress -Activity "Verifying mk25d" -Status $path -PercentComplete (100 * $i / $n)
    if (-not (Test-Path $path)) { Write-Host ("  MISSING   {0}" -f $path) -ForegroundColor Red; $bad += $path; continue }
    $h = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLower()
    if ($h -eq $expected[$path]) { Write-Host ("  ok        {0}" -f $path) -ForegroundColor Green }
    else { Write-Host ("  MISMATCH  {0}" -f $path) -ForegroundColor Red; $bad += $path }
}
Write-Progress -Activity "Verifying mk25d" -Completed
Write-Host ("-" * 70)
if ($bad.Count) { Write-Host "FAILED. Re-extract and re-run." -ForegroundColor Red; exit 1 }
Write-Host "mk25d verified." -ForegroundColor Cyan
Write-Host "hub.html changed: -Mode dev picks templates up live; parity/live mode needs a server restart." -ForegroundColor Yellow
Write-Host "Then Ctrl+F5 on / . Check: TV shows whole images with a colour fringe; press a triangle for the ring." -ForegroundColor DarkGray
