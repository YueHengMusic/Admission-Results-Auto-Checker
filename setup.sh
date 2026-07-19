#!/usr/bin/env bash
set -e

echo
echo "============================================"
echo "  江西省高考录取结果自动查询工具 — 一键部署"
echo "============================================"
echo

# ---- 检测 Node.js ----
if ! command -v node >/dev/null 2>&1; then
    echo "[X] 未检测到 Node.js"
    echo "    请先安装: https://nodejs.org/"
    exit 1
fi
echo "[OK] Node.js $(node -v)"

# ---- 检测 Python ----
PYTHON_CMD=""
command -v python3 >/dev/null 2>&1 && PYTHON_CMD="python3"
[ -z "$PYTHON_CMD" ] && command -v python >/dev/null 2>&1 && PYTHON_CMD="python"
if [ -z "$PYTHON_CMD" ]; then
    echo "[X] 未检测到 Python"
    echo "    请安装 Python 3: https://www.python.org/downloads/"
    exit 1
fi
echo "[OK] Python ($PYTHON_CMD) $($PYTHON_CMD --version 2>&1)"

# ---- 检测浏览器 ----
BROWSER=""
if [ "$(uname)" = "Darwin" ]; then
    [ -d "/Applications/Google Chrome.app" ] && BROWSER="Chrome"
    [ -z "$BROWSER" ] && [ -d "/Applications/Microsoft Edge.app" ] && BROWSER="Edge"
else
    command -v google-chrome >/dev/null 2>&1 && BROWSER="Chrome"
    [ -z "$BROWSER" ] && command -v google-chrome-stable >/dev/null 2>&1 && BROWSER="Chrome"
    [ -z "$BROWSER" ] && command -v microsoft-edge >/dev/null 2>&1 && BROWSER="Edge"
fi

if [ -n "$BROWSER" ]; then
    echo "[OK] 浏览器: $BROWSER"
else
    echo "[WARN] 未检测到系统浏览器"
    echo "[..] 正在安装 Playwright 内置 Chromium..."
    npx playwright install chromium || echo "[X] Chromium 安装失败"
fi

echo
echo "============================================"
echo "  安装依赖"
echo "============================================"

echo "[..] npm install..."
npm install || { echo "[X] npm install 失败"; exit 1; }
echo "[OK] npm 安装完成"

echo "[..] pip install ddddocr..."
$PYTHON_CMD -m pip install ddddocr -q && echo "[OK] ddddocr 安装完成" || echo "[X] ddddocr 安装失败，请手动: pip install ddddocr"

echo
echo "============================================"
echo "  配置文件"
echo "============================================"

if [ ! -f config.json ]; then
    echo "[..] 未找到 config.json，从模板创建..."
    cp config.example.json config.json
    echo "[OK] 已创建 config.json"
    echo
    echo "[!] 请编辑 config.json:"
    echo '    "examNumber" : 你的准考证号'
    echo '    "idLast4"    : 身份证后4位'
    echo
    echo '修改保存后按回车继续...'
    read -r
fi

echo
echo "============================================"
echo "  部署完成！"
echo "============================================"
echo
echo "  请选择："
echo "    [1] 开始自动查询（后台静默，定时轮询）"
echo "    [2] 先测试一下（只查一次，确认信息正确）"
echo "    [3] 显示浏览器窗口（可看到验证码识别过程）"
echo "    [4] 退出，我稍后自己运行"
echo
printf "  输入序号 (1-4): "; read choice

case "$choice" in
    1) echo; echo "开始自动查询...（按 Ctrl+C 可随时停止）"; echo; npm start ;;
    2) echo; echo "测试查询中..."; echo; npm run once ;;
    3) echo; echo "显示浏览器窗口..."; echo; npm run headed ;;
    4) echo; echo "你可以随时运行: npm start" ;;
    *) echo "无效选择，请重新输入 (1-4)"; exec "$0" ;;
esac
