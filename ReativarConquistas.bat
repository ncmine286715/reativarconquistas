@echo off
chcp 65001 >nul
title Reativar Conquistas - Minecraft Bedrock
cd /d "%~dp0"

if "%~1"=="" (
  echo ============================================================
  echo   Reativar Conquistas - Minecraft Bedrock
  echo ============================================================
  echo.
  echo   Arraste um ou mais arquivos .mcworld para cima deste .bat
  echo   e um novo arquivo "...-conquistas.mcworld" sera gerado.
  echo.
  echo   Para rodar como site local ^(upload/download^):
  echo       reativar_conquistas.py --server 8080
  echo.
  pause
  exit /b 1
)

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%~dp0reativar_conquistas.py" %*
) else (
  python "%~dp0reativar_conquistas.py" %*
)

echo.
pause
