@echo off
cd /d "%~dp0..\.."

echo ============================================
echo  katazuku - credential registration
echo  Password is encrypted at once (DPAPI).
echo  No plaintext is stored anywhere.
echo ============================================
echo.

echo [1/2] LabBase   ( compass.labbase.jp )
echo       ID = okuyama.kotaro.career@gmail.com
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\local-login\store-credential.ps1" -PortalId labbase -AllowedOrigin https://compass.labbase.jp -OutputPath "credential-store\labbase.json"
echo.

echo [2/2] Gaishishukatsu   ( gaishishukatsu.com )
echo       ID = okuyama.kotaro.career@gmail.com
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\local-login\store-credential.ps1" -PortalId gaishishukatsu -AllowedOrigin https://gaishishukatsu.com -OutputPath "credential-store\gaishishukatsu.json"
echo.

echo ============================================
echo  OK if both printed:  "status": "stored"
echo  Close this window and tell the agent.
echo ============================================
pause
