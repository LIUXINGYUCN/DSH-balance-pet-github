# Fit the tablet frame: for a set of columns, report the first and last run of
# dark pixels in the lower half of the sheet. The frame is a parallelogram, so
# the first/last values over x give the top and bottom edges, and the outermost
# columns that have a dark run give the left and right edges.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
[System.GC]::Collect()
[System.GC]::WaitForPendingFinalizers()
$root = Split-Path -Parent $PSScriptRoot
$bmp = New-Object System.Drawing.Bitmap((Join-Path $root 'assets\expression_happy.png'))

function Dark([int]$x, [int]$y) {
    $c = $bmp.GetPixel($x, $y)
    if ($c.A -lt 200) { return $false }
    return (($c.R + $c.G + $c.B) -le 150)
}

foreach ($x in @(540, 560, 580, 600, 640, 700, 760, 820, 880, 920, 940, 952, 960)) {
    $first = -1; $last = -1; $runs = 0; $prev = $false
    for ($y = 560; $y -lt 1000; $y++) {
        $d = Dark $x $y
        if ($d) {
            if ($first -lt 0) { $first = $y }
            $last = $y
            if (-not $prev) { $runs++ }
        }
        $prev = $d
    }
    Write-Host ("x={0,4}  dark y {1,4}..{2,4}  runs={3}" -f $x, $first, $last, $runs)
}
$bmp.Dispose()
