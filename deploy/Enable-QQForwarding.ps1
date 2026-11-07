$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-Object Security.Principal.WindowsPrincipal($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Run this script from Administrator PowerShell.'}
$file='C:\ProgramData\ssh\sshd_config'
$service=Get-CimInstance Win32_Service -Filter "Name='sshd'"
$binary=[regex]::Match($service.PathName,'^"?(.+?sshd\.exe)"?').Groups[1].Value
if(-not(Test-Path -LiteralPath $binary)){throw 'Cannot locate installed sshd.exe'}
& $binary -t -f $file
if($LASTEXITCODE -ne 0){throw 'Existing SSH configuration is invalid; no change was made'}
$text=[IO.File]::ReadAllText($file)
$block=[regex]::Match($text,'(?ms)^Match User admin\s*\r?\n(?:(?!^Match ).)*')
if(-not $block.Success){throw 'Expected Match User admin block was not found'}
if($block.Value -notmatch '(?m)^\s*AllowTcpForwarding\s+(remote|yes)\s*$'){throw 'Unexpected forwarding setting; no change was made'}
$replacement=[regex]::Replace($block.Value,'(?m)^(\s*AllowTcpForwarding\s+)remote(\s*)$','${1}yes${2}')
if($replacement -eq $block.Value){Write-Host 'Forwarding is already enabled.';exit 0}
$backup=$file+'.dafeiyu-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.bak'
Copy-Item -LiteralPath $file -Destination $backup
$next=$text.Substring(0,$block.Index)+$replacement+$text.Substring($block.Index+$block.Length)
[IO.File]::WriteAllText($file,$next,(New-Object Text.UTF8Encoding($false)))
& $binary -t -f $file
if($LASTEXITCODE -ne 0){Copy-Item -LiteralPath $backup -Destination $file -Force;throw 'Validation failed; original configuration restored'}
Restart-Service sshd
Write-Host 'QQ proxy forwarding enabled. SSH configuration tested; backup created.'
