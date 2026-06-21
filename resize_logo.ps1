Add-Type -AssemblyName System.Drawing

$sourcePath = "C:\Users\Abhijeet Nardele\.gemini\antigravity\brain\7470edab-0a6f-4f38-8e5c-bc77f402a449\diagram_weaver_icon_1782047094510.png"
$targetPath = "C:\Users\Abhijeet Nardele\OneDrive\Desktop\vs code extension\media\icon.png"

# Load the original 4K image
$img = [System.Drawing.Image]::FromFile($sourcePath)

# Create a new blank 128x128 image
$bmp = New-Object System.Drawing.Bitmap 128, 128
$graph = [System.Drawing.Graphics]::FromImage($bmp)

# High quality resize
$graph.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graph.DrawImage($img, 0, 0, 128, 128)

# Save to the media folder
$bmp.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)

# Cleanup memory
$graph.Dispose()
$bmp.Dispose()
$img.Dispose()

Write-Host "=========================================="
Write-Host "SUCCESS! The exact 128x128 icon has been created!"
Write-Host "You can now upload media\icon.png to Microsoft!"
Write-Host "=========================================="
