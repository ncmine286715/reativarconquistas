@echo off
chcp 65001 >nul
title ReativaConquistas - Servidor local
cd /d "%~dp0"

REM Carrega o .env se existir (linhas CHAVE=VALOR, ignora #comentarios).
if exist ".env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)
if "%PORT%"=="" set "PORT=8080"
set "SCRIPT=%~dp0reativar_conquistas.py"

echo ============================================
echo  ReativaConquistas - teste local
echo  Site: http://localhost:%PORT%/
echo  (Ctrl+C nesta janela para parar)
echo ============================================

where py >nul 2>nul
if not errorlevel 1 (
  if "%NO_BROWSER%"=="1" (
    py -3 "%SCRIPT%" --server %PORT%
  ) else (
    py -3 "%SCRIPT%" --server %PORT% --open
  )
) else (
  if "%NO_BROWSER%"=="1" (
    python "%SCRIPT%" --server %PORT%
  ) else (
    python "%SCRIPT%" --server %PORT% --open
  )
)
