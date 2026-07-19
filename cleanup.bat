@echo off
setlocal enabledelayedexpansion

REM 定位到脚本所在目录
cd /d "%~dp0"

echo.
echo ============================================
echo   清理项目垃圾（还原始项目状态）
echo ============================================
echo.

set DELETED=0

REM ---- 运行时临时文件 ----
if exist auto-checker.log      (del /q auto-checker.log      && echo [OK] auto-checker.log      && set /a DELETED+=1) else (echo [--] auto-checker.log)
if exist session_cookies.json  (del /q session_cookies.json  && echo [OK] session_cookies.json  && set /a DELETED+=1) else (echo [--] session_cookies.json)
if exist .email_tested         (del /q .email_tested         && echo [OK] .email_tested         && set /a DELETED+=1) else (echo [--] .email_tested)
if exist eng.traineddata       (del /q eng.traineddata       && echo [OK] eng.traineddata       && set /a DELETED+=1) else (echo [--] eng.traineddata)
if exist temp_captcha.png      (del /q temp_captcha.png      && echo [OK] temp_captcha.png      && set /a DELETED+=1) else (echo [--] temp_captcha.png)
if exist captcha*.png          (del /q captcha*.png 2>nul)
if exist test_captcha.jpg      (del /q test_captcha.jpg      && set /a DELETED+=1)
if exist results               (rmdir /s /q results          && echo [OK] results\              && set /a DELETED+=1) else (echo [--] results\)
if exist config.json           (del /q config.json           && echo [OK] config.json           && set /a DELETED+=1) else (echo [--] config.json)

REM Chromium 删除会影响其他 Playwright 项目，如需清理请手动删除
REM   %USERPROFILE%\AppData\Local\ms-playwright

REM ---- setup.bat 安装的依赖 ----
if exist node_modules (
    rmdir /s /q node_modules
    echo [OK] node_modules\ （已删除，下次运行 setup.bat 会重新安装）
    set /a DELETED+=1
) else (
    echo [--] node_modules\
)

echo.
echo ============================================
echo   清理完成！共删除 !DELETED! 个文件/目录
echo ============================================
echo.
echo   温馨提示：
echo     ddddocr 安装在系统 Python 中，不会自动卸载。
echo     如需卸载，请手动执行: pip uninstall ddddocr -y
echo.
if !DELETED! GTR 0 (
    echo   下次使用前请运行 setup.bat 重新安装依赖
)
echo.
pause
