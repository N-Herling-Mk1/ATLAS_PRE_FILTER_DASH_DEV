# apply_mk46.ps1 -- run from the ATLAS_PRE_FILTER_DASH repo root AFTER mk45,
# once the drop's files have been copied over the repo.
#
#   powershell -ExecutionPolicy Bypass -File .\apply_mk46.ps1
#
# mk46: section view (top bar, full-width section) + MaxEnt fits (case identity,
# constraint ladders) + EDA search and the enlarged feature view.
# New Python module -> RESTART the server.

$ErrorActionPreference = "Stop"

$expected = [ordered]@{
    "docs\EDA_PLAN_mk1.md"                          = "abe644874848b5b82e78059009f271ae7a0f96c40ca1d08ff7f12bee170819cc"
    "docs\STAGE_A_SCOPE_mk2.md"                     = "73c1dff2b9a8105453b0f7a02328fe8ae52ddfc21f52717914950d6e1c63eb26"
    "engine\eda.py"                                 = "9586b415fc8d2c6380f435abf8e67c7807d4b442e941b7ca7ebf1abc8fd87a8a"
    "engine\maxent.py"                              = "91b105746076671fe1315bf712e9d209da6f0c64d8b220e30ba9c97805c0fd02"
    "server\eda_api.py"                             = "b8954106278d595fc9335e91853a383e7b03d45e53757ff9986031bbb1e178e3"
    "tests\test_eda.py"                             = "faf1debae4206262bceb9c3b6fa371a090f2448b4f07862f901b17ffb5ea5bfd"
    "web\static\app\js\eda.js"                      = "3581091ddd35bcabb45fcb7df6e3aabb0571a31deae5c932250179a3496a8006"
    "web\static\app\js\hub.js"                      = "8841b7cdf6f10181f29f371364eda500bbe3389f7fb68c7809eef99930af6b9e"
    "web\static\public\css\eda.css"                 = "eeba073aa162d6717dd2c467835c96858d748c58c307c469363cecb3d0e79544"
    "web\static\public\css\hub.css"                 = "e9a179562ff632642ca8123011c0ae661adbcb81a89da10ac287326efe383d57"
    "web\templates\hub.html"                        = "eb56deaa733614c075256712c3ffba1b75c87ff5d5cd6e5eb02043d33d03baad"
    "web\templates\sections\eda.html"               = "f85de1bb1590655aa1df0a5df5f469fd7feb9a827ece3e0fa08a939b029209a8"
}

Write-Host "ATLAS-Dashboard-mk_1 :: apply mk46  (section view + MaxEnt fits)" -ForegroundColor Cyan
Write-Host ("-" * 70)
$bad = @()
$i = 0
foreach ($path in $expected.Keys) {
    $i++
    Write-Progress -Activity "mk46: verifying files" -Status $path -PercentComplete (100 * $i / $expected.Count)
    if (-not (Test-Path $path)) { Write-Host ("  MISSING   {0}" -f $path) -ForegroundColor Red; $bad += $path; continue }
    Unblock-File -Path $path -ErrorAction SilentlyContinue
    $h = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLower()
    if ($h -eq $expected[$path]) { Write-Host ("  ok        {0}" -f $path) -ForegroundColor Green }
    else { Write-Host ("  MISMATCH  {0}" -f $path) -ForegroundColor Red; $bad += $path }
}
Write-Progress -Activity "mk46: verifying files" -Completed

Write-Host ""
$checks = [ordered]@{
    "MaxEnt engine wired into EDA ....." = @("engine\eda.py", "maxent\.analyse\(")
    "feature route present ............" = @("server\eda_api.py", '@bp\.get\("/<region>/feature"\)')
    "section view layout .............." = @("web\static\public\css\hub.css", 'grid-template-areas: "tv band nav"')
    "no deck glide into the dock ......" = @("web\static\app\js\hub.js", "function showFace\(\)")
    "enlarged view in the sheet ......." = @("web\templates\sections\eda.html", 'id="eda-focus"')
}
foreach ($k in $checks.Keys) {
    $ok = Select-String -Path $checks[$k][0] -Pattern $checks[$k][1] -Quiet
    Write-Host ("  {0} {1}" -f $k, $(if ($ok) {"yes"} else {"NO"})) -ForegroundColor $(if ($ok) {"Green"} else {"Red"})
    if (-not $ok) { $bad += $k }
}

Write-Host ("-" * 70)
if ($bad.Count) { Write-Host ("FAILED on {0} item(s)." -f $bad.Count) -ForegroundColor Red; exit 1 }
Write-Host "mk46 verified. Restart the server, then: .\run_tests.ps1 -Data home" -ForegroundColor Cyan
Write-Host "Hub -> EDA Dashboard -> Generate (the eda version changed, so it recomputes once)." -ForegroundColor Cyan
