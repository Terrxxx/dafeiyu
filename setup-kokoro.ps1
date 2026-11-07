$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$voiceRoot = Join-Path $PSScriptRoot 'data\tts'
$archive = Join-Path $voiceRoot 'kokoro-int8-multi-lang-v1_1.tar.bz2'
$expectedHash = '259C9C8BC906D6078E4E0570421885DABB68B539C2F970FCBB890A58EEAF3E9C'
New-Item -ItemType Directory -Force $voiceRoot | Out-Null
if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 180 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2' -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Kokoro checksum mismatch; installation stopped.' }
$entries = & tar -tjf $archive
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect model archive.' }
foreach ($entry in $entries) {
    if ($entry -notmatch '^kokoro-int8-multi-lang-v1_1/' -or $entry -match '(^|/)\.\.(/|$)|^[A-Za-z]:|^/') { throw 'Unexpected model archive path.' }
}
& tar -xjf $archive -C $voiceRoot
if ($LASTEXITCODE -ne 0) { throw 'Unable to extract Kokoro model archive.' }
Write-Host 'Kokoro int8 v1.1 installed and checksum verified.'
