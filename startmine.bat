@echo off
title HUSTL - P2P Mining Suite
color 07

:: --- CONFIG ---
set MY_ADDRESS=PASTE YOUR ADDRESS HERE
set SERVER_URL=http://localhost:3000

:: Force path to local folder
cd /d "%~dp0"

cls
echo  * STATUS      Starting P2P Network Node...
:: Start the node in a separate hidden/minimized window
start /min cmd /c "node p2p-node.js"

:: Wait for node to initialize
timeout /t 3 >nul

echo  * ABOUT        HUSTL Miner/2.0.0
echo  * CPU          Detected AES-NI
echo  * MODE         Decentralized P2P
echo  * DONATE       0%%
echo.
echo ^[[32m[%time%]^[[0m ^[[36mnet  ^[[0m use pool ^[[33m%SERVER_URL%^[[0m
echo ^[[32m[%time%]^[[0m ^[[34mcpu  ^[[0m ready threads ^[[32mMAX^[[0m
echo.
echo [+] Mining for: ^[[32m%MY_ADDRESS%^[[0m
echo -----------------------------------------------------------------------

:loop
node miner.js %MY_ADDRESS%

echo.
echo ^[[31m[!] Miner crashed. Restarting in 5s...^[[0m
timeout /t 5 >nul
goto loop