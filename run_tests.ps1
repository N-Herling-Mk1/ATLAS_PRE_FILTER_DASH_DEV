# Runs the test suite. Real-data tests run only when a locations file is found
# (-Data home|office|<path>); otherwise they skip with a named reason.
param([string]$Data = "")
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$py = "C:\venvs\atlas_pfd\Scripts\python.exe"
if ($Data -eq "home") { $env:PFD_TEST_DATA = "home" }
elseif ($Data -eq "office") { $env:PFD_TEST_DATA = "office" }
elseif ($Data) { $env:PFD_TEST_DATA = $Data }
& $py -m pytest -q -rs tests
