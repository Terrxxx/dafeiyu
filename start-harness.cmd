@echo off
cd /d "%~dp0harness-runtime"
set "DSH_HOME=%~dp0harness-runtime\home"
if not exist "%~dp0harness-runtime\node_modules\@deepseek-ai\dsh\lib\bin.js" (
  echo DeepSeek Harness is not installed in harness-runtime.
  pause
  exit /b 1
)
node "%~dp0harness-runtime\node_modules\@deepseek-ai\dsh\lib\bin.js" web --host 127.0.0.1 --port 3080
pause
