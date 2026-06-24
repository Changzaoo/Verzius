@echo off
REM Atalho clicavel: roda o setup do Cloudflare Tunnel do Verzius.
REM Basta dar duplo-clique neste arquivo (ou rodar no terminal).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-tunel.ps1"
pause
