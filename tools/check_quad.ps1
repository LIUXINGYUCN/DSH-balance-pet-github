# Verify the tablet-screen quad is identical on every delivered expression sheet:
# for each sheet, find the longest near-black run per column and report the panel
# bounding band. A mismatch means the readout would land off the screen.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
[System.GC]::Collect()
[System.GC]::WaitForPendingFinalizers()
$root = Split-Path -Parent $PSScriptRoot
$names = @('sprite.png', 'expression_happy.png', 'expression_nervous.png', 'expression_aloof.png', 'expression_calm.png')

foreach ($name in $names) {
    $bmp = New-Object System.Drawing.Bitmap((Join-Path $root "assets\$name"))
    $topAt600 = -1; $botAt600 = -1; $topAt940 = -1; $botAt940 = -1
    foreach ($x in @(600, 940)) {
        $first = -1; $last = -1
        for ($y = 600; $y -lt 960; $y++) {
            $c = $bmp.GetPixel($x, $y)
            if ($c.A -lt 200) { continue }
            if (($c.R + $c.G + $c.B) -gt 120) { continue }
            if ($first -lt 0) { $first = $y }
            $last = $y
        }
        if ($x -eq 600) { $topAt600 = $first; $botAt600 = $last } else { $topAt940 = $first; $botAt940 = $last }
    }
    Write-Host ("{0,-24} left col 600: y {1}..{2}   right col 940: y {3}..{4}" -f $name, $topAt600, $botAt600, $topAt940, $botAt940)
    $bmp.Dispose()
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}
Write-Host 'client QUAD TL(600,699) TR(940,645) BR(940,867) BL(600,921)'
