# 江西省高考录取结果自动查询工具

定时查询 [江西省教育考试院](https://jxcf.jxeea.cn/) 的高考录取结果，全程追踪状态变化（投档→阅档→预录取→录取/退档），自动弹窗、发邮件、保存截图。

---

## 快速开始

```bash
# 方式一：一键部署（推荐）
#  Windows: 双击 setup.bat
#  macOS/Linux: bash setup.sh

# 方式二：手动安装
npm install
pip install ddddocr
# Linux 用户还需安装系统依赖：
#   npx playwright install-deps chromium

# 1. 编辑 config.json，填好你的准考证号和身份证后4位
#    （如果 config.json 不存在，会自动从 config.example.json 创建）

# 2.（可选）在 config.json 中配置 SMTP 邮件通知

# 3. 启动！完全无人值守
npm start
```

> **前置条件**：需要系统已安装 Node.js 和 Python 3。Chrome 可选（程序会自动回退 Playwright 内置 Chromium）。
> **Linux 用户**：`setup.sh` 会自动安装系统依赖和 pip（需要 sudo 权限）。
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
  "queryWindowEnabled": false,
  "queryStartHour": "8:00",
  "queryEndHour": "17:00",
  "maxCaptchaRefetches": 5,
  "maxCandidatesPerCaptcha": 4,
  "candidateDelayMs": 3000,
  "captchaRefetchDelayMs": 5000,
  "headless": true,
  "browserRestartQueries": 50,
  "browserRestartHours": 6,
  "failureAlertThreshold": 6,

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
    "to": "your-email@qq.com",
    "firstTimeEmail": true
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
| `npm run interval:15` | 每 15 分钟查一次 |
| `npm run interval:30` | 每 30 分钟查一次 |

流程：

```
┌──────────────────────────────────────────┐
│  访问查询页 → ddddocr识别验证码（~1秒）    │
│  提交查询 → 服务器返回结果                 │
│  暂无录取 → 等待间隔 → 下一轮               │
│  检测到录取信息 → 弹窗 + 截图 + 发邮件     │
│  ddddocr 不可用时自动懒加载 tesseract 备选  │
└──────────────────────────────────────────┘
```

---

## 📧 邮件通知（SMTP）

追踪录取状态变化，自动弹窗、发邮件、保存截图。

### 三种邮件

| 邮件 | 触发时机 | 内容 |
|------|---------|------|
| **测试邮件** | 首次查询成功后 | 考生姓名、准考证号、当前状态、运行配置 |
| **状态变化** | 首次查到数据 / 状态跳变 | 旧状态→新状态 + 详情字段 |
| **录取通知** | 检测到正式录取 | 全部9个录取字段 + 页面截图附件 |

> 💡 测试邮件和首次检测邮件可通过 `smtp.firstTimeEmail: false` 关闭。

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
> 💡 首次查询成功后会自动发送测试邮件（可通过 `smtp.firstTimeEmail: false` 关闭），包含考生姓名、当前状态和运行配置，一次性验证 SMTP + 查询 + 考生信息。修改 SMTP 配置后重新查询会再次发送。

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

## 检测到状态变化时

程序会追踪完整的录取状态链路：

| 状态类型 | 示例 | 行为 |
|---------|------|------|
| 正常状态 | 投档、院校阅档、预录取 | 📋 记录日志 + 发状态邮件 |
| 危险状态 | 退档、自由可投、未录取 | ⚠️ 警告通知 + 发状态邮件，继续轮询 |
| 最终录取 | 录取（排除预/拟） | 🎉 弹窗3次 + 发录取邮件（含截图），**停止** |

录取时程序会：

1. **💬 桌面弹窗** — 桌面通知弹出，之后 10/20/30 分钟各提醒一次
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
| `setup.bat` / `setup.sh` | 一键部署脚本（Windows / macOS+Linux） |
| `cleanup.bat` / `cleanup.sh` | 一键清理（包括配置和依赖，还原到 clone 状态） |
| `cleanup-runtime.bat` / `cleanup-runtime.sh` | 只清理运行时垃圾（保留 config.json 和 node_modules） |
| `auto-checker.js` | 主程序 |
| `ocr_server.py` | ddddocr 验证码识别脚本 |
| `ARCHITECTURE.md` | 项目架构与设计思路 |
| `package.json` | 依赖和 npm 脚本 |
| `auto-checker.log` | 运行日志（自动生成） |
| `session_cookies.json` | 浏览器会话（自动生成，用于恢复） |
| `state.json` | 录取状态持久化（自动生成，用于重启后恢复） |
| `results/` | 查询截图和 HTML（自动生成） |

---

## 常见问题

### Q: OCR 准确率怎么样？怎么知道用的哪个引擎？

使用 **ddddocr**（Python 库，专门为中国网站验证码训练），经实测准确率接近 100%。ddddocr 返回 1~3 位时自动换验证码重试，仅 Python 崩溃或空输出才回退 tesseract.js。运行时日志会标注引擎：
```
→ OCR(ddddocr): "Nhjv"(100%)        ← ddddocr 一把命中
→ ddddocr 未命中，尝试 tesseract...
→ OCR(tesseract): "5EW"(40%), ...    ← 回退 tesseract
```
安装方式：`pip install ddddocr`。

### Q: 日志输出了哪些信息？

每轮查询输出：标题行、OCR 引擎和识别结果、验证码验证状态、当前录取状态（含横幅和详情字段）、考生姓名、查询耗时。启动时显示 OCR 引擎可用性。每 10 轮追加 OCR 命中率和内存占用。开启查询时间段时还会显示窗口剩余时间。

### Q: 为什么提示"操作频繁，请稍后再试"？

服务器有频率限制。程序已在每次尝试间加了 3 秒延迟，每次刷新验证码间加了 5 秒延迟。如果仍然触发，可以增大 `candidateDelayMs` 和 `captchaRefetchDelayMs` 配置值。

### Q: 程序能在后台一直运行吗？关闭 SSH 终端会停吗？

可以长期运行。但如果直接 `npm start`，关闭 SSH 终端程序就会退出。推荐使用 nohup 后台运行：
```bash
nohup npm start > /dev/null 2>&1 &
```
或使用 screen/tmux 随时回来看进度：
```bash
screen -S admission
npm start
# 按 Ctrl+A, D 分离；下次 ssh 上来 screen -r admission
```
程序每 50 次查询或 6 小时自动重启浏览器释放内存，连续 6 次失败会发送告警邮件。这些阈值可在 `config.json` 中调整。

### Q: Linux 上报 libnspr4.so 缺失等错误？

Playwright 的 Chromium 需要系统共享库。运行 `npx playwright install-deps chromium` 即可一键安装（`setup.sh` 已自动执行此步骤）。

### Q: Python 提示 "externally-managed-environment" 或 No module named pip？

**pip 未安装**：`setup.sh` 会自动执行 `apt-get install python3-pip`。
**PEP 668 限制**：`setup.sh` 检测到后会自动加 `--break-system-packages` 重试。

### Q: 如何配置只在特定时间段查询？

在 `config.json` 中设置：
```json
"queryWindowEnabled": true,
"queryStartHour": "8:00",
"queryEndHour": "17:00"
```
开启后仅在 8:00 至 17:00 之间查询，到点完成当次后自动停止。支持 `"8:30"`、`8.5`、跨夜（如 `"22:00"` 至 `"6:00"`）等格式。

### Q: 如何关闭首次查询时的邮件通知？

设置 `smtp.firstTimeEmail: false`，关掉后只有状态变化时才发邮件，首次查不到数据和首次查到数据都不会发。

### Q: 程序出问题了怎么办？

先试试双击 `cleanup-runtime.bat`（Windows）或运行 `bash cleanup-runtime.sh`（macOS/Linux）清理运行时垃圾，然后重新 `npm start`。如果还不行，用 `cleanup.bat` / `cleanup.sh` 彻底还原后再运行 `setup.bat` / `setup.sh` 重新部署。

### Q: 如何确认邮件配置是否正确？

首次查询成功后会自动发送测试邮件（可通过 `smtp.firstTimeEmail: false` 关闭），包含考生姓名、状态和配置。收到即说明一切正常。修改 SMTP 配置后重新查询会再次发送。

---

## 依赖

| 包 | 用途 |
|----|------|
| `playwright` | 浏览器自动化，操作 Chrome |
| `ddddocr` (Python) | 验证码识别引擎（核心，准确率~100%） |
| `tesseract.js` | OCR 备选方案（ddddocr 不可用时按需懒加载，不额外消耗启动时间） |
| `sharp` | 验证码图片预处理 |
| `node-notifier` | 桌面通知弹窗（跨平台） |
| `nodemailer` | SMTP 邮件发送 |
