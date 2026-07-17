# @author kongweiguang
param(
  [Parameter(Mandatory = $true)][string]$InputVideo,
  [Parameter(Mandatory = $true)][string]$OutputVideo
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$audio = Join-Path $root "assets/audio"
$inputPath = (Resolve-Path $InputVideo).Path
$outputPath = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputVideo))

$args = @(
  "-y", "-loglevel", "error",
  "-i", $inputPath,
  "-stream_loop", "-1", "-i", (Join-Path $audio "bgm-ad.mp3"),
  "-i", (Join-Path $audio "voiceover.wav"),
  "-i", (Join-Path $audio "logo-reveal-v2.mp3"),
  "-i", (Join-Path $audio "whoosh-fast.mp3"),
  "-i", (Join-Path $audio "focus.mp3"),
  "-i", (Join-Path $audio "whoosh-fast.mp3"),
  "-i", (Join-Path $audio "command-execute.mp3"),
  "-i", (Join-Path $audio "focus.mp3"),
  "-i", (Join-Path $audio "complete-done.mp3")
)

$filter = @"
[1:a]atrim=0:30,asetpts=PTS-STARTPTS,volume=0.075,afade=t=in:st=0:d=0.45,afade=t=out:st=28.7:d=1.3[bgm];
[2:a]volume=1.18[voice];
[3:a]volume=0.24,adelay=100|100[s0];
[4:a]volume=0.22,adelay=2750|2750[s1];
[5:a]volume=0.24,adelay=7650|7650[s2];
[6:a]volume=0.20,adelay=13050|13050[s3];
[7:a]volume=0.23,adelay=18050|18050[s4];
[8:a]volume=0.22,adelay=22450|22450[s5];
[9:a]volume=0.24,adelay=26200|26200[s6];
[bgm][voice][s0][s1][s2][s3][s4][s5][s6]amix=inputs=9:duration=first:normalize=0,alimiter=limit=0.94,loudnorm=I=-16:TP=-1.5:LRA=7[outa]
"@ -replace "`r?`n", ""

$args += @(
  "-filter_complex", $filter,
  "-map", "0:v:0", "-map", "[outa]",
  "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
  "-t", "30", "-movflags", "+faststart", $outputPath
)

& ffmpeg @args
if ($LASTEXITCODE -ne 0) { throw "音频混合失败：$InputVideo" }
Write-Output $outputPath
