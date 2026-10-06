# Contact sheet of the four expression sheets: one frame per variant, cropped to
# the face, so the variants can be compared without opening four 1024px images.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
[System.GC]::Collect()
[System.GC]::WaitForPendingFinalizers()
$root = Split-Path -Parent $PSScriptRoot
$names = @('expression_happy.png', 'expression_nervous.png', 'expression_aloof.png', 'expression_calm.png')
$X0 = 540; $Y0 = 360; $W = 400; $H = 280
$S = 1
$sheet = New-Object System.Drawing.Bitmap(($W * $S * 2), ($H * $S * 2))
$g = [System.Drawing.Graphics]::FromImage($sheet)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
for ($i = 0; $i -lt 4; $i++) {
    $bmp = New-Object System.Drawing.Bitmap((Join-Path $root ("assets\" + $names[$i])))
    $col = $i % 2
    $row = [int]($i / 2)
    $target = New-Object System.Drawing.Rectangle(($col * $W), ($row * $H), $W, $H)
    $g.DrawImage($bmp, $target, (New-Object System.Drawing.Rectangle($X0, $Y0, $W, $H)), [System.Drawing.GraphicsUnit]::Pixel)
    $bmp.Dispose()
}
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 255, 0, 255), 1)
$g.DrawLine($pen, $W, 0, $W, ($H * 2))
$g.DrawLine($pen, 0, $H, ($W * 2), $H)
$g.Dispose(); $pen.Dispose()
$out = Join-Path $root 'tools\expressions-preview.png'
$sheet.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$sheet.Dispose()
Write-Host "wrote $out"
