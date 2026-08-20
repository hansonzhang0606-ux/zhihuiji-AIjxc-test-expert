@echo off
REM =========================================
REM   zhihuiji-aijxc-test-expert - Register Script
REM   All Chinese output is handled by the .ps1 file
REM =========================================

set "PS1_FILE=%~dp0register_expert.ps1"

REM Check if ps1 file exists
if not exist "%PS1_FILE%" (
    echo [ERROR] register_expert.ps1 not found in current directory.
    echo Please make sure register_expert.bat and register_expert.ps1 are in the same folder.
    pause
    exit /b 1
)

REM Try PowerShell 7 (pwsh.exe) first, then Windows PowerShell (powershell.exe)
where pwsh.exe >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [INFO] Using PowerShell 7 ^(pwsh.exe^)...
    echo.
    pwsh.exe -ExecutionPolicy Bypass -File "%PS1_FILE%"
    goto :DONE
)

where powershell.exe >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [INFO] Using Windows PowerShell ^(powershell.exe^)...
    echo.
    powershell.exe -ExecutionPolicy Bypass -File "%PS1_FILE%"
    goto :DONE
)

REM Neither found
echo.
echo [ERROR] PowerShell not found on this system.
echo.
echo Please try one of the following:
echo   1. Right-click register_expert.ps1 -^> "Run with PowerShell"
echo   2. Install PowerShell 7 from https://github.com/PowerShell/PowerShell
echo   3. Manual registration - see docs for instructions
echo.

:DONE
echo.
pause
