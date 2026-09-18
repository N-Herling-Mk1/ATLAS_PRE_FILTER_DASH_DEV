# apply_mk25.ps1 -- run from the ATLAS_PRE_FILTER_DASH repo root AFTER extracting
# the mk25 zip flat over it.
#
#   powershell -ExecutionPolicy Bypass -File .\apply_mk25.ps1
#
# mk25 rebuilds the hub to the nathanherling.com deck: raked placard carousel,
# gimbal control box, Navigate + dock in the rail, bigger cards with a glare
# edge, synth sound with a real mute. Templates, CSS, JS, one test.

$ErrorActionPreference = "Stop"

$expected = [ordered]@{
    "web\templates\hub.html"                 = "5622b1fcf3b56a17d271f71451c967831711ee65f3b3f9e2b7aa27b004bbac4f"
    "web\static\public\css\hub.css"          = "ed2c5b3d2431ebf22dd54df8b5a7d57f246f030a3deefd2b60a085b0ac170b98"
    "web\static\app\js\deck.js"              = "f0e83b6422984242d94fe4760711d297b0d15e2232e53ee6276e40d2a04e65c0"
    "web\static\app\js\hub.js"               = "f5726fd797900f7588a77fc49d9deb9e27b0bb4d1cf0b1097921c6b8dd4a74c0"
    "web\static\app\js\sfx.js"               = "8b6ecab3cb21c0123a77311bfd1645884574aaacbeb9b1153a05e161196f6d1d"
    "tests\test_lock.py"                     = "d1f4dc9a833d65564ccb7ebe89e017a768f1e7567c229649f476aaa165b16dea"
    "docs\STAGE_A_SCOPE_mk2.md"              = "c2398b57790bff8a9431ecaea5476526a0edeaf0ab672a1ce905470ef9452f90"
    "DROP_NOTES_mk25.md"                     = "9259a2b5c0f042ec6f86fbf5948907a07d55be32e22ab62ddcc468835c69812f"
}

Write-Host "ATLAS-Dashboard-mk_1 :: apply mk25  (hub rebuilt to the site deck)" -ForegroundColor Cyan
Write-Host ("-" * 70)

$i = 0; $n = $expected.Count; $bad = @()
foreach ($path in $expected.Keys) {
    $i++
    Write-Progress -Activity "Verifying mk25" -Status $path -PercentComplete (100 * $i / $n)
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
Write-Progress -Activity "Verifying mk25" -Completed

# hub.html must load sfx.js BEFORE hub.js, or the speaker and every cue go dead
$t = Get-Content "web\templates\hub.html" -Raw
$a = $t.IndexOf("js/sfx.js"); $b = $t.IndexOf("js/hub.js")
Write-Host ""
if ($a -ge 0 -and $b -gt $a) {
    Write-Host "  ok        hub.html loads sfx.js -> deck.js -> hub.js" -ForegroundColor Green
} else {
    Write-Host "  WARNING   hub.html script order is wrong: sfx.js must precede hub.js" -ForegroundColor Yellow
    $bad += "script order"
}

Write-Host ("-" * 70)
if ($bad.Count) {
    Write-Host ("FAILED on {0} check(s). Re-extract the zip and re-run." -f $bad.Count) -ForegroundColor Red
    exit 1
}

$py = "C:\venvs\atlas_pfd\Scripts\python.exe"
if (Test-Path $py) {
    Write-Host "[tests] running the suite (real-data tests skip unless configured)" -ForegroundColor Cyan
    & $py -m pytest -q
    if ($LASTEXITCODE -ne 0) { Write-Host "Tests FAILED -- see above." -ForegroundColor Red; exit 1 }
} else {
    Write-Host "[tests] venv not found at $py -- skipped. Run .\run_tests.ps1 yourself." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "mk25 verified. Ctrl+F5 on / ." -ForegroundColor Cyan
Write-Host "Try: drag the gimbal knob round, open a section (deck docks bottom-left), click the dock to return." -ForegroundColor DarkGray
