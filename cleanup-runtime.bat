@echo off
setlocal enabledelayedexpansion

REM 定位到脚本所在目录
cd /d "%~dp0"

echo.
echo ============================================
echo   清理运行时垃圾（保留配置和依赖）
echo ============================================
echo.

set DELETED=0

if exist auto-checker.log (
    del /q auto-checker.log
    echo [OK] auto-checker.log
    set /a DELETED+=1
) else (
    echo [--] auto-checker.log
)
if exist session_cookies.json (
    del /q session_cookies.json
    echo [OK] session_cookies.json
    set /a DELETED+=1
) else (
    echo [--] session_cookies.json
)
if exist .email_tested (
    del /q .email_tested
    echo [OK] .email_tested
    set /a DELETED+=1
) else (
    echo [--] .email_tested
)
if exist state.json (
    del /q state.json
    echo [OK] state.json
    set /a DELETED+=1
) else (
    echo [--] state.json
)
if exist eng.traineddata (
    del /q eng.traineddata
    echo [OK] eng.traineddata
    set /a DELETED+=1
) else (
    echo [--] eng.traineddata
)
if exist temp_captcha.png (
    del /q temp_captcha.png
    echo [OK] temp_captcha.png
    set /a DELETED+=1
) else (
    echo [--] temp_captcha.png
)
dir /b captcha*.png 2>nul >nul
if not errorlevel 1 (
    for %%f in (captcha*.png) do (
        del /q "%%f" 2>nul
        echo [OK] %%f
        set /a DELETED+=1
    )
)
if exist test_captcha.jpg (
    del /q test_captcha.jpg
    echo [OK] test_captcha.jpg
    set /a DELETED+=1
) else (
    echo [--] test_captcha.jpg
)
if exist results (
    rmdir /s /q results
    echo [OK] results\
    set /a DELETED+=1
) else (
    echo [--] results\
)

echo.
echo ============================================
echo   清理完成！共删除 !DELETED! 个文件/目录
echo ============================================
echo.
echo   已保留: config.json、node_modules\
echo.
pause
