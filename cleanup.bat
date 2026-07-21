@echo off
setlocal enabledelayedexpansion

REM 定位到脚本所在目录
cd /d "%~dp0"

echo.
echo ============================================
echo   清理项目（还原到 clone 状态）
echo ============================================
echo.

set DELETED=0

REM ---- 运行时临时文件 ----
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
if exist config.json (
    del /q config.json
    echo [OK] config.json
    set /a DELETED+=1
) else (
    echo [--] config.json
)

REM ---- setup.bat 安装的依赖 ----
if exist node_modules (
    rmdir /s /q node_modules
    echo [OK] node_modules\ （已删除，下次运行 setup.bat 会重新部署）
    set /a DELETED+=1
) else (
    echo [--] node_modules\
)

echo.
echo ============================================
echo   清理完成！共删除 !DELETED! 个文件/目录
echo ============================================
echo.
echo   以下项目未自动删除，请选择：
echo     [1] 全部删除（ddddocr + Chromium）
echo     [2] 仅删除 ddddocr
echo     [3] 仅删除 Chromium
echo     [4] 都不删除
echo.
set /p clean_choice="   输入序号 (1-4): "

if "!clean_choice!"=="1" (
    echo [..] 卸载 ddddocr...
    !PYTHON_CMD! -m pip uninstall ddddocr -y >nul 2>&1 && echo [OK] ddddocr 已卸载 || echo [WARN] ddddocr 卸载失败
    if exist "%USERPROFILE%\AppData\Local\ms-playwright" (
        echo [..] 删除 Chromium...
        rmdir /s /q "%USERPROFILE%\AppData\Local\ms-playwright" && echo [OK] Chromium 已删除 || echo [WARN] Chromium 删除失败
    ) else (
        echo [--] Chromium（未找到）
    )
) else if "!clean_choice!"=="2" (
    echo [..] 卸载 ddddocr...
    !PYTHON_CMD! -m pip uninstall ddddocr -y >nul 2>&1 && echo [OK] ddddocr 已卸载 || echo [WARN] ddddocr 卸载失败
) else if "!clean_choice!"=="3" (
    if exist "%USERPROFILE%\AppData\Local\ms-playwright" (
        echo [..] 删除 Chromium...
        rmdir /s /q "%USERPROFILE%\AppData\Local\ms-playwright" && echo [OK] Chromium 已删除 || echo [WARN] Chromium 删除失败
    ) else (
        echo [--] Chromium（未找到）
    )
)
echo.
echo   下次使用前请运行 setup.bat 重新部署
echo.
pause
