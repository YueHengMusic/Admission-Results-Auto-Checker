"""验证码OCR脚本 — 供Node.js调用

依赖: pip install ddddocr
用法: py ocr_server.py <image_path>
输出: 4位字母数字验证码结果（如 "fu94"）

被 auto-checker.js 通过 child_process.execSync 调用
"""
import sys
import ddddocr

def main():
    ocr = ddddocr.DdddOcr(show_ad=False)

    if len(sys.argv) < 2:
        print("USAGE: py ocr_server.py <image_path>")
        sys.exit(1)

    image_path = sys.argv[1]
    with open(image_path, "rb") as f:
        image_bytes = f.read()

    result = ocr.classification(image_bytes)
    print(result)  # stdout → Node.js 接收

if __name__ == "__main__":
    main()
