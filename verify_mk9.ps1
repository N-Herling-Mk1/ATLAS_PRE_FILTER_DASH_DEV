# verify_mk9.ps1 -- run from the ATLAS_PRE_FILTER_DASH repo root.
#
#   powershell -ExecutionPolicy Bypass -File .\verify_mk9.ps1
#
# Compares every file in the mk9 drop against the SHA256 it had when it was cut.
# Size and timestamp are not evidence (OneDrive reverts silently, and both can
# survive a revert); the hash is. Then checks the two things a partial extract
# leaves behind: the retired public\img folder, and stale references to the old
# name or the old image path.

$ErrorActionPreference = "Stop"

$expected = [ordered]@{
    "web\templates\login.html"                         = "34e45abbcb7f6e0ef9f7b2aa1ab2030e693670cd091fada0e6441fe324fdd125"
    "web\templates\base.html"                          = "2c1d55e5a21cd54a43946a15d944c8ac5eeb8185e81869b2b031fcdf80108c1e"
    "web\static\public\css\gate.css"                   = "5b62c41a15845f50898a8c0ccc5d1f1ed3be7f0cd9b0617db20ff2735e8c8220"
    "web\static\public\css\pfd.css"                    = "4dc54e5e7d9e4f8ae7090531ea8c19e4cab517a2af30ce745c7494231db2299a"
    "web\static\public\js\gate.js"                     = "726ac89a3fa967d7e3c175268aefe370a438a95d91360394c976fca7d4ff83dd"
    "web\static\public\js\seg7.js"                     = "6bf08cd28d2a41f1c9757b34ed9f746f2a57d76ddcbe91323adceb974b463dfd"
    "web\static\public\js\arrive.js"                   = "8388f7bf086ef5bde7e0df617650b1b2d0d31a8e7d24e32c38ada2dff3076d7c"
    "web\static\public\assets\images\proton_2.png"     = "66556937a98fd98919d4c810277937d5c2a281221a3cbd71c61a2314f8628a41"
    "web\static\public\assets\images\proton_2_256.png" = "6b434da28c5a7016ad3e06bc5256622c217f9ca3b80b76a146db969520f724fa"
    "web\static\public\assets\images\favicon.svg"      = "a8452f0c8ccf9bc501d9026180c02ca46cdbc5ac9a8a1632a4fe3b0e64fb38ad"
    "server\app.py"                                    = "6f8cc023f0b353b7dd4084eedf4c7586f7af1df2ee704f76ccd3665545872688"
    "docs\STAGE_A_SCOPE_mk2.md"                        = "80b8ec1ae4a3032267fe557442d82751c5c620f21d4021b5f38bde1c9101a77c"
    "apply_mk9.ps1"                                    = "d1d32e3e48484c3ca780039a0bba04c0af7030aae58a9e4fccc517345f1ce828"
    "DROP_NOTES_mk9.md"                                = "56fd316f897d569464f653e5bdfea8dd2fd49c1289540147ec7ecddb34e61178"
}

Write-Host "ATLAS-Dashboard-mk_1 :: verify mk9 by SHA256" -ForegroundColor Cyan
Write-Host ("-" * 72)

$i = 0; $n = $expected.Count
$missing = @(); $mismatch = @()

foreach ($path in $expected.Keys) {
    $i++
    Write-Progress -Activity "Hashing drop files" -Status $path -PercentComplete (100 * $i / $n)
    if (-not (Test-Path $path)) {
        Write-Host ("  MISSING   {0}" -f $path) -ForegroundColor Red
        $missing += $path
        continue
    }
    $h = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLower()
    if ($h -eq $expected[$path]) {
        Write-Host ("  ok        {0}" -f $path) -ForegroundColor Green
    } else {
        Write-Host ("  MISMATCH  {0}" -f $path) -ForegroundColor Red
        Write-Host ("            want {0}" -f $expected[$path]) -ForegroundColor DarkGray
        Write-Host ("            have {0}" -f $h) -ForegroundColor DarkGray
        $mismatch += $path
    }
}
Write-Progress -Activity "Hashing drop files" -Completed

Write-Host ""
Write-Host "Leftovers" -ForegroundColor Cyan

$old = "web\static\public\img"
if (Test-Path $old) {
    Write-Host ("  STILL THERE  {0}  (apply_mk9.ps1 removes it)" -f $old) -ForegroundColor Yellow
} else {
    Write-Host ("  gone         {0}" -f $old) -ForegroundColor Green
}

# stale references: old site name, old image path, old brand line
$patterns = @("Sig/Bg", "public/img", "PRE-FILTER<span>", "ATLAS pre-filter")
$scan = Get-ChildItem -Recurse -File -Include *.html, *.css, *.js, *.py `
        -Path web, server -ErrorAction SilentlyContinue
$stale = 0
foreach ($p in $patterns) {
    $hits = $scan | Select-String -SimpleMatch -Pattern $p
    foreach ($hit in $hits) {
        Write-Host ("  STALE        {0}:{1}  '{2}'" -f `
            (Resolve-Path -Relative $hit.Path), $hit.LineNumber, $p) -ForegroundColor Yellow
        $stale++
    }
}
if ($stale -eq 0) { Write-Host "  none         no stale name or path references" -ForegroundColor Green }

Write-Host ""
Write-Host ("-" * 72)
if ($missing.Count -or $mismatch.Count) {
    Write-Host ("FAILED: {0} missing, {1} mismatched. Re-extract the drop flat into this folder and re-run." -f `
        $missing.Count, $mismatch.Count) -ForegroundColor Red
    exit 1
}
Write-Host "All 14 files byte-exact." -ForegroundColor Cyan
if ($stale -or (Test-Path $old)) {
    Write-Host "Leftovers above are warnings, not failures." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Cross-check with git if the repo is clean otherwise:" -ForegroundColor DarkGray
Write-Host "  git status --short" -ForegroundColor DarkGray
Write-Host "  git diff --stat" -ForegroundColor DarkGray
