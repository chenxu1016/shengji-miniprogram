@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==================================================
echo  Shengji WebSocket server (local, port 8888)
echo ==================================================
if not exist "backend\dist\server.js" (
  echo [build] dist not found, compiling TypeScript...
  pushd backend
  call npm run build
  popd
)
echo.
echo Keep this window OPEN while testing in WeChat DevTools.
echo Mini program default server: ws://localhost:8888
echo For real devices use: ws://YOUR-LAN-IP:8888 (set it on the home page)
echo.
node "backend\dist\server.js"
echo.
echo Server stopped. Press any key to close.
pause >nul
