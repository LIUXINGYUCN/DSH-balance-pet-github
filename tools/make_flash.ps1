# Build assets/flash.png: the flat-red hurt overlay the desktop widget builds at
# runtime in BuildRedLayer (R 255, G 48, B 34, alpha preserved). Shipping it as a
# file keeps the browser half free of per-pixel canvas work.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
[System.GC]::Collect()
[System.GC]::WaitForPendingFinalizers()

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'assets\sprite.png'
$dst = Join-Path $root 'assets\flash.png'

$bmp = New-Object System.Drawing.Bitmap($src)
$w = $bmp.Width
$h = $bmp.Height
$out = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$red = [System.Drawing.Color]::FromArgb(255, 255, 48, 34)

for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
        $a = $bmp.GetPixel($x, $y).A
        if ($a -eq 0) { continue }
        $out.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($a, $red))
    }
}
$bmp.Dispose()
[System.GC]::Collect()
[System.GC]::WaitForPendingFinalizers()
$out.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
$out.Dispose()
Write-Host ("wrote {0} ({1:N0} bytes)" -f $dst, (Get-Item $dst).Length)
