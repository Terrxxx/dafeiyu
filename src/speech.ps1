$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
$speechJob = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.Speech
$speechSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $speechSynth.SelectVoice([string]$speechJob.voice)
    $speechFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $speechSynth.SetOutputToWaveFile([string]$speechJob.file, $speechFormat)
    $speechSynth.Speak([string]$speechJob.text)
} finally { $speechSynth.Dispose() }
