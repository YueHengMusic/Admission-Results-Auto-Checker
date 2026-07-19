#!/usr/bin/env bash
# 彻底清理（还原到 clone 状态，含 config.json 和 node_modules）

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo
echo "============================================"
echo "  清理项目（还原到 clone 状态）"
echo "============================================"
echo

DELETED=0

[ -f auto-checker.log ]      && { rm -f auto-checker.log;      echo "[OK] auto-checker.log";      ((DELETED++)); } || echo "[--] auto-checker.log"
[ -f session_cookies.json ]  && { rm -f session_cookies.json;  echo "[OK] session_cookies.json";  ((DELETED++)); } || echo "[--] session_cookies.json"
[ -f .email_tested ]         && { rm -f .email_tested;         echo "[OK] .email_tested";         ((DELETED++)); } || echo "[--] .email_tested"
[ -f eng.traineddata ]       && { rm -f eng.traineddata;       echo "[OK] eng.traineddata";       ((DELETED++)); } || echo "[--] eng.traineddata"
[ -f temp_captcha.png ]      && { rm -f temp_captcha.png;      echo "[OK] temp_captcha.png";      ((DELETED++)); } || echo "[--] temp_captcha.png"
for f in captcha*.png test_captcha.jpg; do [ -f "$f" ] && { rm -f "$f"; echo "[OK] $f"; ((DELETED++)); }; done
[ -d results ]               && { rm -rf results;              echo "[OK] results/";              ((DELETED++)); } || echo "[--] results/"
[ -f config.json ]           && { rm -f config.json;           echo "[OK] config.json";           ((DELETED++)); } || echo "[--] config.json"

# Chromium 提示不自动删（可能影响其他 Playwright 项目）
echo "[--] Playwright Chromium (可能影响其他项目，未自动删除)"
echo "     如需清理: rm -rf ~/Library/Caches/ms-playwright  # macOS"
echo "               rm -rf ~/.cache/ms-playwright          # Linux"
echo "               rmdir /s /q %LOCALAPPDATA%\\ms-playwright  # Windows"

# node_modules
if [ -d node_modules ]; then
    rm -rf node_modules
    echo "[OK] node_modules/（下次运行 setup 会重新安装）"
    ((DELETED++))
else
    echo "[--] node_modules/"
fi

echo
echo "============================================"
echo "  清理完成！共删除 ${DELETED} 个文件/目录"
echo "============================================"
echo
echo "  ddddocr 安装在系统 Python 中，未自动卸载。"
echo "  如需卸载: pip uninstall ddddocr -y"
echo
echo "  下次使用前请运行 setup.sh 重新部署"
echo
