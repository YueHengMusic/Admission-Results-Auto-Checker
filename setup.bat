@echo off
setlocal enabledelayedexpansion

echo.
echo ============================================
echo   江西省高考录取结果自动查询工具 — 一键部署
echo ============================================
echo.

REM ---- 检测 Node.js ----
where node >nul 2>&1
if !errorlevel! neq 0 (
    echo [X] 未检测到 Node.js
    echo     请先安装: https://nodejs.org/
    pause
    exit /b 1
)
for /f "delims=" %%i in ('node -v 2^>nul') do set NODE_V=%%i
echo [OK] Node.js !NODE_V!

REM 让 Node 自己检查版本（避免 for/f+中文+延迟展开的兼容性问题）
node -e "process.exit(process.versions.node.split('.')[0] >= 18 ? 0 : 1)" >nul 2>&1
if !errorlevel! neq 0 (
    echo [X] Node.js 版本过低 ^(当前 !NODE_V!，需要 ^>= 18^)
    echo     请升级: https://nodejs.org/
    pause
    exit /b 1
)

REM ---- 检测 Python ----
set "PYTHON_CMD="
where py >nul 2>&1 && set "PYTHON_CMD=py"
if "!PYTHON_CMD!"=="" where python >nul 2>&1 && set "PYTHON_CMD=python"
if "!PYTHON_CMD!"=="" (
    echo [X] 未检测到 Python
    echo     请安装 Python 3: https://www.python.org/downloads/
    echo     安装时勾选 Add Python to PATH
    pause
    exit /b 1
)
for /f "delims=" %%i in ('!PYTHON_CMD! --version 2^>^&1') do echo [OK] Python (!PYTHON_CMD!) %%i

REM ---- 确保 pip 可用 ----
!PYTHON_CMD! -m pip --version >nul 2>&1
if !errorlevel! neq 0 (
    echo [WARN] Python pip 未安装
    echo [..] 尝试 python -m ensurepip...
    !PYTHON_CMD! -m ensurepip --default-pip >nul 2>&1
    if !errorlevel! neq 0 (
        echo [X] pip 安装失败，请重新运行 Python 安装程序并勾选 pip 选项
        echo     https://www.python.org/downloads/
        pause
        exit /b 1
    )
    echo [OK] pip 安装完成
)

echo.
echo ============================================
echo   安装依赖
echo ============================================

echo [..] npm install...
call npm install
if !errorlevel! neq 0 (
    echo [X] npm install 失败
    pause
    exit /b 1
)
echo [OK] npm 安装完成

echo [..] pip install ddddocr...
!PYTHON_CMD! -m pip install ddddocr -q
if !errorlevel! neq 0 (
    echo [X] ddddocr 安装失败，请手动执行: pip install ddddocr
) else (
    echo [OK] ddddocr 安装完成
)

REM ---- 检测浏览器（npm install 之后，playwright 已可用） ----
set "BROWSER_OK="
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" >nul 2>&1 && set BROWSER_OK=Chrome
if "!BROWSER_OK!"=="" reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" >nul 2>&1 && set BROWSER_OK=Chrome
if "!BROWSER_OK!"=="" where chrome >nul 2>&1 && set BROWSER_OK=Chrome
if "!BROWSER_OK!"=="" reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" >nul 2>&1 && set BROWSER_OK=Edge
if "!BROWSER_OK!"=="" reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" >nul 2>&1 && set BROWSER_OK=Edge
if "!BROWSER_OK!"=="" where msedge >nul 2>&1 && set BROWSER_OK=Edge

if not "!BROWSER_OK!"=="" (
    echo [OK] 浏览器: !BROWSER_OK!
) else (
    echo [WARN] 未检测到系统浏览器
    echo [..] 检查 Playwright 内置 Chromium（npmmirror 镜像源）...
    set PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright/
    call npx playwright install chromium
    if !errorlevel! neq 0 (
        echo [X] Chromium 安装失败，请手动执行: set PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright/ ^&^& npx playwright install chromium
    ) else (
        echo [OK] Chromium 已就绪
    )
)

echo.
echo ============================================
echo   配置文件
echo ============================================

if not exist config.json (
    echo [..] 未找到 config.json，从模板创建...
    copy config.example.json config.json >nul
    echo [OK] 已创建 config.json
    echo.
    echo [!] 请修改 config.json:
    echo     "examNumber" : 你的准考证号
    echo     "idLast4"    : 身份证后4位
    echo.
    start notepad config.json
    echo 修改保存后按任意键继续...
    pause >nul
)

echo.
echo ============================================
echo   部署完成！
echo ============================================
echo.
:menu
echo   请选择：
echo     [1] 开始自动查询（后台静默，定时轮询）
echo     [2] 先测试一下（只查一次，确认信息正确）
echo     [3] 显示浏览器窗口（可看到验证码识别过程）
echo     [4] 退出，我稍后自己运行
echo.
set /p choice="   输入序号 (1-4): "

if "%choice%"=="1" (
    echo.
    echo 开始自动查询...（按 Ctrl+C 可随时停止）
    echo.
    npm start
) else if "%choice%"=="2" (
    echo.
    echo 测试查询中...
    echo.
    npm run once
) else if "%choice%"=="3" (
    echo.
    echo 显示浏览器窗口...
    echo.
    npm run headed
) else if "%choice%"=="4" (
    echo.
    echo 你可以随时运行: npm start
    pause >nul
) else (
    echo 无效选择，请重新输入
    goto menu
)
