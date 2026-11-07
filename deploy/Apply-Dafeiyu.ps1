$ErrorActionPreference = "Stop"
$nginxRoot = "C:\Users\Administrator\Desktop\yrxs.net\nginx-1.25.4"
$nginx = Join-Path $nginxRoot "nginx.exe"
$main = Join-Path $nginxRoot "conf\nginx.conf"
$candidate = Join-Path $nginxRoot "conf\nginx-dafeiyu-candidate.conf"
$prefix = "C:/Users/Administrator/Desktop/yrxs.net/nginx-1.25.4/"
if ((Get-FileHash -LiteralPath $main -Algorithm SHA256).Hash -ne "3E348C2167A06EA7485D95DDAEC395C5E7FCCE08E883ABC74B4915EDD3C65DE9") { throw "Current Nginx configuration changed. Ask Shinoa to regenerate the candidate." }
& $nginx -t -p $prefix -c "conf/nginx-dafeiyu-candidate.conf"
if ($LASTEXITCODE -ne 0) { throw "Candidate validation failed. Current configuration has not been modified." }
$backup = Join-Path $nginxRoot ("conf\nginx.conf.before-dafeiyu-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
Copy-Item -LiteralPath $main -Destination $backup
Copy-Item -LiteralPath $candidate -Destination $main -Force
& $nginx -s reload -p $prefix -c "conf/nginx.conf"
if ($LASTEXITCODE -ne 0) {
 Copy-Item -LiteralPath $backup -Destination $main -Force
 throw "Nginx reload failed. Previous configuration restored."
}
Write-Host "Dafeiyu HTTPS site enabled: https://dafeiyu.yrxs.net/"
