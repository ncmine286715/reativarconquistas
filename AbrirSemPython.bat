@echo off
chcp 65001 >nul
title ReativaConquistas - Site local (sem Python)
cd /d "%~dp0"

REM  Abre o site 100%% local direto no navegador, SEM Python e SEM servidor.
REM  Tudo roda no PC da pessoa: conversao (converter.js), conta e Premium
REM  (auth.js + Worker AbacatePay). Requer internet p/ o JSZip na 1a vez
REM  que ja vem em site\vendor\ (offline depois do 1o uso, via cache).
REM  Uso: duplo-clique em AbrirSemPython.bat

start "" "%~dp0site\index.html"
exit /b 0
