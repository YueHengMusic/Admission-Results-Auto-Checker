# 江西省高考录取结果自动查询工具

定时查询 [江西省教育考试院](https://jxcf.jxeea.cn/) 的高考录取结果，检测到录取信息时自动弹窗、发邮件、保存截图。

---

## 快速开始

```bash
# 方式一：一键部署（推荐）
#  Windows: 双击 setup.bat
#  macOS/Linux: bash setup.sh

# 方式二：手动安装
npm install

# 2. 安装 Python 验证码识别引擎（必须！）
pip install ddddocr

# 3. 编辑 config.json，填好你的准考证号和身份证后4位
#    （如果 config.json 不存在，会自动从 config.example.json 创建）

# 4.（可选）在 config.json 中配置 SMTP 邮件通知

# 5. 启动！完全无人值守
npm start
```

> **前置条件**：需要系统已安装 Node.js 和 Python 3。Chrome 可选（程序会自动回退 Playwright 内置 Chromium）。
> **邮件通知**：可选功能，不配置也能正常使用（弹窗 + 截图仍然有效）。

---

## 配置信息

所有配置在 `config.json` 中（首次运行会自动从 `config.example.json` 创建）：

- 每个配置项上方都有一个 `"_字段名"` 作为注释说明
- 以 `_` 开头的键是注释，可以删除，不会影响程序运行
- 分隔线 `"___________________"` 也仅用于视觉分区，可删除

```json
{
  "examNumber": "12345678901",
  "idLast4": "1234",
  "checkIntervalMinutes": 10,
  "maxCaptchaRefetches": 5,
  "maxCandidatesPerCaptcha": 4,
  "candidateDelayMs": 3000,
  "captchaRefetchDelayMs": 5000,
  "headless": true,

  "smtp": {
    "enabled": false,
    "host": "smtp.qq.com",
    "port": 465,
    "secure": true,
    "auth": {
      "user": "your-email@qq.com",
      "pass": "your-auth-code"
    },
    "from": "录取查询 <your-email@qq.com>",
    "to": "your-email@qq.com"
  }
}
```

> `config.json` 已被 `.gitignore` 忽略，不会提交到 git，保护你的隐私。

## 运行方式

| 命令 | 说明 |
|------|------|
| `npm start` | 后台静默运行，每 10 分钟查一次（推荐） |
| `npm run headed` | 显示浏览器窗口，方便观察/调试 |
| `npm run once` | 只查一次 |
| `npm run interval:5` | 每 5 分钟查一次 |

流程：

```
┌──────────────────────────────────────────┐
│  访问查询页 → ddddocr识别验证码（~1秒）  │
│  提交查询 → 服务器返回结果               │
│  暂无录取 → 等待间隔 → 下一轮             │
│  检测到录取信息 → 弹窗 + 截图 + 发邮件   │
└──────────────────────────────────────────┘
```

---

## 📧 邮件通知（SMTP）

检测到录取结果后自动发送邮件，附带录取详情和页面截图。

### 两种邮件

| 邮件 | 触发时机 | 内容 |
|------|---------|------|
| **测试邮件** | 首次查询成功后 | 考生姓名、准考证号、当前状态、运行配置 |
| **录取通知** | 检测到录取结果 | 考生状态、院校名称、专业名称、批次、科类等 **全部9个录取字段** + 页面截图附件 |

录取通知邮件示例：

```
🎉 高考录取结果已出！

  考生状态    已录取
  院校代号    10422
  院校名称    山东大学
  专业组名称  不限选考科目
  专业代号    01
  专业名称    计算机科学与技术
  批次名称    本科一批
  科类名称    理工
  计划性质    非定向

  [页面截图附件]
```

### 配置步骤

1. 打开 `config.json`，找到 `"smtp"` 配置块
2. 把 `"enabled"` 改为 `true`
3. 填写你的邮箱和授权码：

```json
"smtp": {
  "enabled": true,
  "host": "smtp.qq.com",
  "port": 465,
  "secure": true,
  "auth": {
    "user": "123456789@qq.com",
    "pass": "你的授权码"
  },
  "from": "录取查询 <123456789@qq.com>",
  "to": "receiver@example.com"
}
```

### 常用邮箱 SMTP 配置

| 邮箱 | host | port | secure | 授权码获取方式 |
|------|------|------|--------|--------------|
| QQ邮箱 | smtp.qq.com | 465 | true | 设置 → 账户 → POP3/SMTP → 生成授权码 |
| 163邮箱 | smtp.163.com | 465 | true | 设置 → POP3/SMTP/IMAP → 新增授权码 |
| Gmail | smtp.gmail.com | 587 | false | 需开启两步验证 + 应用专用密码 |
| Outlook | smtp-mail.outlook.com | 587 | false | 安全设置中生成 |

### 命令行控制

```bash
node auto-checker.js --email-on                     # 强制启用邮件
node auto-checker.js --no-email                     # 禁用邮件
node auto-checker.js --email-to=me@example.com       # 覆盖收件人
```

> ⚠️ 授权码不是邮箱登录密码！QQ/163 等需要在邮箱设置中单独生成。
>
> 💡 首次查询成功后会自动发送测试邮件，包含考生姓名、当前状态和运行配置，一次性验证 SMTP + 查询 + 考生信息。修改 SMTP 配置后重新查询会再次发送。

---

## 所有命令

| 命令 | 说明 |
|------|------|
| `npm start` | 后台静默，每 10 分钟查一次 |
| `npm run headed` | 显示浏览器窗口，方便调试 |
| `npm run once` | 只查一次 |
| `npm run once-headed` | 显示浏览器，只查一次 |
| `npm run interval:5` | 每 5 分钟查一次 |
| `npm run interval:15` | 每 15 分钟查一次 |
| `npm run interval:30` | 每 30 分钟查一次 |

或直接使用命令行参数：

```bash
node auto-checker.js                     # 后台静默，10分钟间隔
node auto-checker.js --headed            # 显示浏览器窗口
node auto-checker.js --once              # 只查一次
node auto-checker.js --interval=5        # 每5分钟
node auto-checker.js --email-on          # 启用邮件通知
node auto-checker.js --no-email          # 禁用邮件通知
node auto-checker.js --email-to=me@qq.com # 指定收件人
```

---

## 检测到录取信息时

程序会：

1. **💬 桌面弹窗** — Windows 通知弹出，之后 10/20/30 分钟各提醒一次
2. **📧 发邮件** — 全部9个录取字段 + 页面截图附件（需配置 SMTP）
3. **📸 截图** — 完整页面保存到 `results/admission_<时间>.png`
4. **📄 HTML** — 原始页面保存到 `results/admission_<时间>.html`
5. **📋 终端** — 打印录取详情

---

## 文件说明

| 文件 | 说明 |
|------|------|
| `config.json` | **配置文件** — 准考证号、邮箱等（不会被 git 提交） |
| `config.example.json` | 配置模板 — 可提交到 git，供他人参考 |
| `setup.bat` | 一键部署脚本（Windows） |

| `setup.sh` | 一键部署脚本（macOS/Linux） |
| `cleanup.bat` | 一键清理（包括配置和依赖，还原到 clone 状态） |
| `cleanup-runtime.bat` | 只清理运行时垃圾（保留 config.json 和 node_modules） |
| `auto-checker.js` | 主程序 |
| `ocr_server.py` | ddddocr 验证码识别脚本 |
| `package.json` | 依赖和 npm 脚本 |
| `auto-checker.log` | 运行日志（自动生成） |
| `session_cookies.json` | 浏览器会话（自动生成，用于恢复） |
| `results/` | 查询截图和 HTML（自动生成） |

---

## 常见问题

### Q: OCR 准确率怎么样？怎么知道用的哪个引擎？

使用 **ddddocr**（Python 库，专门为中国网站验证码训练），经实测准确率接近 100%。ddddocr 不可用时自动回退到 tesseract.js。运行时日志会标注引擎：
```
→ OCR(ddddocr): "Nhjv"(100%)        ← ddddocr 一把命中
→ ddddocr 未命中，尝试 tesseract...
→ OCR(tesseract): "5EW"(40%), ...    ← 回退 tesseract
```
安装方式：`pip install ddddocr`。

### Q: 为什么提示"操作频繁，请稍后再试"？

服务器有频率限制。程序已在每次尝试间加了 3 秒延迟，每次刷新验证码间加了 5 秒延迟。如果仍然触发，可以增大 `candidateDelayMs` 和 `captchaRefetchDelayMs` 配置值。

### Q: 程序能在后台一直运行吗？

可以。程序设计为长期运行，每轮查询完会等待指定间隔后再查。使用 `Ctrl+C` 随时退出。

### Q: 程序出问题了怎么办？

先试试双击 `cleanup-runtime.bat` 清理运行时垃圾（保留配置和依赖），然后重新 `npm start`。如果还不行，用 `cleanup.bat` 彻底还原后再运行 `setup.bat` 重新部署。

### Q: 如何确认邮件配置是否正确？

首次查询成功后会自动发送测试邮件，包含考生姓名、状态和配置。收到即说明一切正常。修改 SMTP 配置后重新查询会再次发送。

---

## 依赖

| 包 | 用途 |
|----|------|
| `playwright` | 浏览器自动化，操作 Chrome |
| `ddddocr` (Python) | 验证码识别引擎（核心，准确率~100%） |
| `tesseract.js` | OCR 备选方案（ddddocr 不可用时回退） |
| `sharp` | 验证码图片预处理 |
| `node-notifier` | 桌面通知弹窗（跨平台） |
| `nodemailer` | SMTP 邮件发送 |
