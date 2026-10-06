# Build the four expression variants out of the delivered sprite sheet.
#
# sprite.png is a 1024x1024 sheet. Its face geometry was read off a labelled
# crop (tools/face_grid.ps1) and then verified on tools/expressions-preview.png:
#
#   left eye   ellipse about x 630..690, centred (660, 448)
#   right eye  ellipse about x 735..800, centred (768, 468)
#   mouth      open smile, about x 650..710, centred (680, 563)
#
# Each variant copies the sheet and repaints just those features, so the tablet
# panel (x 600..940, y 645..921) stays pixel-identical on every sheet and the
# balance readout keeps landing on the screen:
#
#   expression_happy.png    eyes redrawn as delivered (the resting smile)
#   expression_nervous.png  eyes squeezed shut, blush, a sweat drop
#   expression_aloof.png    eyes narrowed, mouth replaced by a wavy pout
#   expression_calm.png     flat eyes, straight mouth
#
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
[System.GC]::Collect()
[System.GC]::WaitForPendingFinalizers()

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'assets\sprite.png'
$out = Join-Path $root 'assets'

$EYES = @(
    @{ CX = 592; CY = 434; RX = 30; RY = 34 },
    @{ CX = 704; CY = 452; RX = 32; RY = 30 }
)
$MOUTH = @{ CX = 660; CY = 566 }

$INK = [System.Drawing.Color]::FromArgb(255, 26, 26, 34)
$IRIS = [System.Drawing.Color]::FromArgb(255, 58, 92, 150)
$BLUSH = [System.Drawing.Color]::FromArgb(84, 236, 122, 152)
$SWEAT = [System.Drawing.Color]::FromArgb(168, 122, 198, 255)

function New-Graphics([System.Drawing.Bitmap]$bmp) {
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    return $g
}

function New-Pen([int]$width, [System.Drawing.Color]$color) {
    $pen = New-Object System.Drawing.Pen($color, $width)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    return $pen
}

# Replace one ellipse with a blurred copy of its own neighbourhood, so an eye
# can be redrawn without leaving a flat colour patch on shaded skin. Painting
# the ellipse row by row (widest in the middle) blurs and rounds at once.
function Blur-Ellipse([System.Drawing.Bitmap]$bmp, [int]$cx, [int]$cy, [int]$rx, [int]$ry, [int]$blur) {
    $w = $rx * 2 + 1
    $h = $ry * 2 + 1
    $patch = New-Object 'System.Drawing.Color[,]' $w, $h
    for ($j = 0; $j -lt $h; $j++) {
        for ($i = 0; $i -lt $w; $i++) {
            $r = 0; $g2 = 0; $b = 0; $n = 0
            for ($dy = -$blur; $dy -le $blur; $dy++) {
                for ($dx = -$blur; $dx -le $blur; $dx++) {
                    $sx = $cx - $rx + $i + $dx
                    $sy = $cy - $ry + $j + $dy
                    if ($sx -lt 0 -or $sy -lt 0 -or $sx -ge $bmp.Width -or $sy -ge $bmp.Height) { continue }
                    $c = $bmp.GetPixel($sx, $sy)
                    $r += $c.R; $g2 += $c.G; $b += $c.B; $n++
                }
            }
            if ($n -eq 0) { $patch[$i, $j] = [System.Drawing.Color]::Transparent; continue }
            $patch[$i, $j] = [System.Drawing.Color]::FromArgb(255, [int]($r / $n), [int]($g2 / $n), [int]($b / $n))
        }
    }
    $g = New-Graphics $bmp
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    for ($j = 0; $j -lt $h; $j++) {
        $v = ($j - $ry) / [double]$ry
        if ([math]::Abs($v) -ge 1) { continue }
        $half = [int]([math]::Sqrt(1 - $v * $v) * $rx)
        for ($i = -$half; $i -le $half; $i++) {
            $color = $patch[($i + $rx), $j]
            if ($color.A -eq 0) { continue }
            $brush.Color = $color
            $g.FillRectangle($brush, [single]($cx + $i), [single]($cy - $ry + $j), 1, 1)
        }
    }
    $g.Dispose(); $brush.Dispose()
}

function Cover-Eye([System.Drawing.Bitmap]$bmp, $eye) {
    Blur-Ellipse $bmp ([int]$eye.CX) ([int]$eye.CY) ([int]($eye.RX * 1.15) + 10) ([int]($eye.RY * 1.15) + 10) 10
}

function Cover-Mouth([System.Drawing.Bitmap]$bmp, $mouth) {
    Blur-Ellipse $bmp ([int]$mouth.CX) ([int]$mouth.CY) 26 20 7
}

function Draw-Line([System.Drawing.Bitmap]$bmp, [double]$x0, [double]$y0, [double]$x1, [double]$y1, [int]$width, $color) {
    if ($null -eq $color) { $color = $INK }
    $pen = New-Pen $width $color
    $g = New-Graphics $bmp
    $g.DrawLine($pen, [single]$x0, [single]$y0, [single]$x1, [single]$y1)
    $g.Dispose(); $pen.Dispose()
}

function Draw-Blush([System.Drawing.Bitmap]$bmp, $eye) {
    $g = New-Graphics $bmp
    $brush = New-Object System.Drawing.SolidBrush($BLUSH)
    $g.FillEllipse($brush, [single]($eye.CX - 24), [single]($eye.CY + 22), 48, 17)
    $g.Dispose(); $brush.Dispose()
}

function Save-Variant([System.Drawing.Bitmap]$bmp, [string]$name) {
    $target = Join-Path $out $name
    # GDI+ keeps the previous image handle alive until finalization, and saving
    # onto that path then fails with a generic GDI+ error, so collect first.
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
    $bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host ("wrote {0}" -f $target)
}

# --- happy: untouched, so the resting face is exactly the delivered artwork --
$delivered = New-Object System.Drawing.Bitmap($src)
Save-Variant $delivered 'expression_happy.png'

# --- nervous: eyes squeezed shut, blush, sweat ---------------------------
$bmp = New-Object System.Drawing.Bitmap($src)
foreach ($eye in $EYES) {
    Cover-Eye $bmp $eye
    $half = $eye.RX * 0.9
    Draw-Line $bmp ($eye.CX - $half) ($eye.CY + 8) $eye.CX ($eye.CY - 8) 6
    Draw-Line $bmp $eye.CX ($eye.CY - 8) ($eye.CX + $half) ($eye.CY + 8) 6
    Draw-Blush $bmp $eye
}
$g = New-Graphics $bmp
$sweat = New-Object System.Drawing.SolidBrush($SWEAT)
$g.FillEllipse($sweat, [single]($EYES[1].CX + 30), [single]($EYES[1].CY - 42), 16, 23)
$g.Dispose(); $sweat.Dispose()
Save-Variant $bmp 'expression_nervous.png'

# --- aloof: narrowed eyes and a wavy pout --------------------------------
$bmp = New-Object System.Drawing.Bitmap($src)
foreach ($eye in $EYES) {
    Cover-Eye $bmp $eye
    $half = $eye.RX * 1.25
    # A spark of iris under a heavy upper lid reads as "unimpressed".
    $g = New-Graphics $bmp
    $irisBrush = New-Object System.Drawing.SolidBrush($IRIS)
    $g.FillEllipse($irisBrush, [single]($eye.CX - 10), [single]($eye.CY - 4), 21, 15)
    $g.Dispose(); $irisBrush.Dispose()
    Draw-Line $bmp ($eye.CX - $half) ($eye.CY - 5) ($eye.CX + $half) ($eye.CY - 3) 8
    Draw-Blush $bmp $eye
}
Cover-Mouth $bmp $MOUTH
for ($i = 0; $i -lt 4; $i++) {
    $x0 = $MOUTH.CX - 26 + $i * 13
    $x1 = $x0 + 13
    $dy = if ($i % 2 -eq 0) { -6 } else { 6 }
    Draw-Line $bmp $x0 ($MOUTH.CY - $dy) $x1 ($MOUTH.CY + $dy) 4
}
Save-Variant $bmp 'expression_aloof.png'

# --- calm: flat eyes and a straight mouth --------------------------------
$bmp = New-Object System.Drawing.Bitmap($src)
foreach ($eye in $EYES) {
    Cover-Eye $bmp $eye
    $half = $eye.RX * 0.95
    Draw-Line $bmp ($eye.CX - $half) $eye.CY ($eye.CX + $half) $eye.CY 7
}
Cover-Mouth $bmp $MOUTH
Draw-Line $bmp ($MOUTH.CX - 22) $MOUTH.CY ($MOUTH.CX + 22) $MOUTH.CY 5
Save-Variant $bmp 'expression_calm.png'

Write-Host 'done'

