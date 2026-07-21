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
[ -f state.json ]            && { rm -f state.json;            echo "[OK] state.json";            ((DELETED++)); } || echo "[--] state.json"
[ -f eng.traineddata ]       && { rm -f eng.traineddata;       echo "[OK] eng.traineddata";       ((DELETED++)); } || echo "[--] eng.traineddata"
[ -f temp_captcha.png ]      && { rm -f temp_captcha.png;      echo "[OK] temp_captcha.png";      ((DELETED++)); } || echo "[--] temp_captcha.png"
for f in captcha*.png test_captcha.jpg; do [ -f "$f" ] && { rm -f "$f"; echo "[OK] $f"; ((DELETED++)); }; done
[ -d results ]               && { rm -rf results;              echo "[OK] results/";              ((DELETED++)); } || echo "[--] results/"
[ -f config.json ]           && { rm -f config.json;           echo "[OK] config.json";           ((DELETED++)); } || echo "[--] config.json"

# node_modules
if [ -d node_modules ]; then
    rm -rf node_modules
    echo "[OK] node_modules/（下次运行 setup 会重新部署）"
    ((DELETED++))
else
    echo "[--] node_modules/"
fi

echo
echo "============================================"
echo "  清理完成！共删除 ${DELETED} 个文件/目录"
echo "============================================"
echo
echo "  以下项目未自动删除，请选择："
echo "    [1] 全部删除（ddddocr + Chromium）"
echo "    [2] 仅删除 ddddocr"
echo "    [3] 仅删除 Chromium"
echo "    [4] 都不删除"
echo
printf "  输入序号 (1-4): "; read clean_choice

CHROMIUM_DIR=""
if [ "$(uname)" = "Darwin" ]; then
    CHROMIUM_DIR="$HOME/Library/Caches/ms-playwright"
else
    CHROMIUM_DIR="$HOME/.cache/ms-playwright"
fi

case "$clean_choice" in
    1)
        echo "[..] 卸载 ddddocr..."
        python3 -m pip uninstall ddddocr -y 2>/dev/null && echo "[OK] ddddocr 已卸载" || echo "[WARN] ddddocr 卸载失败"
        if [ -d "$CHROMIUM_DIR" ]; then
            echo "[..] 删除 Chromium..."
            rm -rf "$CHROMIUM_DIR" && echo "[OK] Chromium 已删除" || echo "[WARN] Chromium 删除失败"
        else
            echo "[--] Chromium（未找到）"
        fi
        ;;
    2)
        echo "[..] 卸载 ddddocr..."
        python3 -m pip uninstall ddddocr -y 2>/dev/null && echo "[OK] ddddocr 已卸载" || echo "[WARN] ddddocr 卸载失败"
        ;;
    3)
        if [ -d "$CHROMIUM_DIR" ]; then
            echo "[..] 删除 Chromium..."
            rm -rf "$CHROMIUM_DIR" && echo "[OK] Chromium 已删除" || echo "[WARN] Chromium 删除失败"
        else
            echo "[--] Chromium（未找到）"
        fi
        ;;
esac
echo
echo "  下次使用前请运行 setup.sh 重新部署"
echo
