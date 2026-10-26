$ErrorActionPreference = 'Stop'
$voiceRoot = Join-Path $PSScriptRoot 'data\tts'
$archive = Join-Path $voiceRoot 'chaowen.tar.bz2'
New-Item -ItemType Directory -Force $voiceRoot | Out-Null
$expectedHash = 'F5F7C8628427FBB259EA4B7EC1A9A822A0C04E3F267071F0ABFA0610371D9E0C'
if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-zh_CN-chaowen-medium-int8.tar.bz2' -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expectedHash) {
    throw 'Model archive checksum mismatch; installation stopped.'
}
& tar -xjf $archive -C $voiceRoot
if ($LASTEXITCODE -ne 0) { throw 'Unable to extract voice archive.' }
Write-Host 'chaowen voice installed. Run npm install to install the engine, then restart the bot.'
