#!/usr/bin/env bash
# 清理运行时垃圾（保留 config.json 和 node_modules）

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo
echo "============================================"
echo "  清理运行时垃圾（保留配置和依赖）"
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

echo
echo "============================================"
echo "  清理完成！共删除 ${DELETED} 个文件/目录"
echo "============================================"
echo
echo "  已保留: config.json、node_modules/"
echo
