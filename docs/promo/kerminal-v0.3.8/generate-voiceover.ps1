# @author kongweiguang
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$rawOutput = Join-Path $root "assets/audio/voiceover-raw.wav"
$finalOutput = Join-Path $root "assets/audio/voiceover.wav"

$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
$voice = $synth.GetInstalledVoices() |
  Where-Object { $_.VoiceInfo.Culture.Name -eq "zh-CN" } |
  Select-Object -First 1
if (-not $voice) { throw "没有找到可用的 zh-CN 系统语音。" }

$synth.SelectVoice($voice.VoiceInfo.Name)
$synth.Rate = 0
$synth.Volume = 100
$synth.SetOutputToWaveFile($rawOutput)
$ssml = @"
<speak version="1.0" xml:lang="zh-CN">
  <p><s>终端，不该只是一块黑色窗口。</s><break time="280ms"/></p>
  <p><s>Kerminal，把本机、远程服务器和容器，带进同一个桌面工作台。</s><break time="180ms"/></p>
  <p><s>多标签与分屏处理任务，Codex 和 Claude 直接绑定当前目标。</s><break time="180ms"/></p>
  <p><s>传文件、管容器、看资源、开端口转发，无需来回切换。</s><break time="180ms"/></p>
  <p><s>每一步操作，都知道自己正在连接哪里。</s><break time="180ms"/></p>
  <p><s>Kerminal 零点三点八，让终端、服务器与 Agent，在同一个上下文里协作。</s></p>
</speak>
"@
$synth.SpeakSsml($ssml)
$synth.Dispose()

# 系统语音原始时长约 40 秒，按 30 秒成片节奏加速并从 0.25 秒开始。
# 最终统一为 48kHz 双声道，便于后续混音。
& ffmpeg -y -loglevel error -i $rawOutput -af "atempo=1.37,adelay=250|250,apad=pad_dur=30" -t 30 -ar 48000 -ac 2 $finalOutput
if ($LASTEXITCODE -ne 0) { throw "ffmpeg 处理配音失败。" }
Write-Output "voice=$($voice.VoiceInfo.Name)"
Write-Output "output=$finalOutput"
