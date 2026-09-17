@echo off
chcp 65001 >nul
title Reativa Conquistas - Abre o Site
cd /d "%~dp0"

REM  Inicia o site em segundo plano (janela minimizada) e abre o navegador.
REM  Se o site ja estiver rodando, apenas abre o navegador.
REM  Uso:  AbrirSite.bat          (porta 8080)
REM        AbrirSite.bat 9000     (porta personalizada)

set "PORT=8080"
if not "%~1"=="" set "PORT=%~1"
set "SCRIPT=%~dp0reativar_conquistas.py"

where py >nul 2>nul
if not errorlevel 1 (
  start "" /min py -3 "%SCRIPT%" --server %PORT% --open
) else (
  start "" /min python "%SCRIPT%" --server %PORT% --open
)

exit /b 0