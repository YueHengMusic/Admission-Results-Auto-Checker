# 江西省高考录取结果自动查询工具

定时查询 [江西省教育考试院](https://jxcf.jxeea.cn/) 的高考录取结果，检测到录取信息时自动响铃提醒并保存截图。

---

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 编辑 config.json，填好你的准考证号和身份证后4位
#    （如果 config.json 不存在，会自动从 config.example.json 创建）

# 3.（可选）在 config.json 中配置 SMTP 邮件通知

# 4. 推荐：手动模式（打开浏览器，你只需输验证码，之后全自动）
npm run manual

# 5. 或：自动模式（OCR 识别验证码，完全无人值守）
npm start
```

> **前置条件**：需要系统已安装 Google Chrome 浏览器。
> **邮件通知**：可选功能，不配置也能正常使用（响铃 + 截图仍然有效）。

---

## 配置信息

所有配置在 `config.json` 中（首次运行会自动从 `config.example.json` 创建）：

- 每个配置项上方都有一个 `"_字段名"` 作为注释说明
- 以 `_` 开头的键是注释，可以删除，不会影响程序运行
- 分隔线 `"___________________"` 也仅用于视觉分区，可删除

```json
{
  "examNumber": "51078304618",
  "idLast4": "0056",
  "checkIntervalMinutes": 10,

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

## 两种运行模式

| 模式 | 命令 | 说明 |
|------|------|------|
| **手动模式（推荐）** | `npm run manual` | 打开可见浏览器，预填表单，你只需输验证码点击查询。之后工具接管，定时刷新页面 |
| **自动模式** | `npm start` | 完全无人值守，使用 tesseract.js OCR 自动识别验证码。会多次重试以保证成功率 |

### 手动模式流程

```
┌─────────────────────────────────────┐
│  浏览器打开 → 表单已预填好           │
│  你手动输入验证码 → 点击"查询"       │
│  工具检测到结果页 → 接管控制权        │
│  定时刷新查询 → 录取信息出现 → 响铃！ │
└─────────────────────────────────────┘
```

### 自动模式流程

```
┌──────────────────────────────────────────┐
│  访问查询页 → 提取验证码图片              │
│  多策略 OCR 识别 → 产生候选数字列表       │
│  逐个尝试候选 → 服务器反馈对/错           │
│  正确 → 解析结果 → 等待→下一轮            │
│  全部错误 → 刷新验证码 → 重新 OCR         │
│  检测到录取信息 → 响铃 + 截图 + 保存HTML + 发邮件 │
└──────────────────────────────────────────┘
```

---

## 📧 邮件通知（SMTP）

检测到录取结果后，程序可以自动发送邮件通知，附带录取详情和页面截图。



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
> 💡 首次配置 SMTP 并启动后，程序会自动发送一封测试邮件验证配置是否正确。如果收到测试邮件，说明配置成功。后续除非修改 SMTP 配置（服务器/账号/收件人），不会重复发送测试邮件。

---

## 所有命令

| 命令 | 说明 |
|------|------|
| `npm start` | 自动模式，每 10 分钟查一次 |
| `npm run manual` | 手动模式，持续轮询 |
| `npm run once` | 自动模式，只查一次 |
| `npm run once-manual` | 手动模式，只查一次 |
| `npm run interval:5` | 自动模式，每 5 分钟查一次 |
| `npm run interval:15` | 自动模式，每 15 分钟查一次 |
| `npm run interval:30` | 自动模式，每 30 分钟查一次 |

或直接使用命令行参数：

```bash
node auto-checker.js                     # 自动模式，10分钟间隔
node auto-checker.js --headed            # 手动模式
node auto-checker.js --once              # 只查一次
node auto-checker.js --interval=5        # 每5分钟
node auto-checker.js --headed --once     # 手动模式，只查一次
node auto-checker.js --email-on          # 启用邮件通知
node auto-checker.js --no-email          # 禁用邮件通知
node auto-checker.js --email-to=me@qq.com # 指定收件人
```

---

## 检测到录取信息时

程序会：

1. **🔔 响铃** — 连续 10 次系统蜂鸣，之后每 30 秒重复
2. **📧 发邮件** — 发送录取详情 + 页面截图到指定邮箱（需配置 SMTP）
3. **📸 截图** — 完整页面截图保存到 `results/admission_<时间>.png`
4. **📄 保存 HTML** — 原始页面保存到 `results/admission_<时间>.html`
5. **📋 终端输出** — 打印考生姓名、录取院校、专业等详情

---

## 文件说明

| 文件 | 说明 |
|------|------|
| `config.json` | **配置文件** — 准考证号、邮箱等（不会被 git 提交） |
| `config.example.json` | 配置模板 — 可提交到 git，供他人参考 |
| `auto-checker.js` | 主程序 |
| `package.json` | 依赖和 npm 脚本 |
| `auto-checker.log` | 运行日志（自动生成） |
| `session_cookies.json` | 浏览器会话（自动生成，用于恢复） |
| `results/` | 查询截图和 HTML（自动生成） |

---

## 常见问题

### Q: 自动模式 OCR 准确率怎么样？

验证码是 4 位纯数字，程序使用以下策略提高成功率：
- 对同一张验证码尝试 3 种不同放大倍数 × 3 种 OCR 模式 = 9 种预处理组合
- 再加 6 种二值化阈值 + 2 种归一化策略
- 共产生多个候选数字，按置信度和长度排序后逐个尝试
- 每次查询最多尝试 3×3 = 9 个候选，失败则刷新验证码重新来

### Q: 为什么提示"操作频繁，请稍后再试"？

服务器有频率限制。程序已在每次尝试间加了 4 秒延迟，每次刷新验证码间加了 6 秒延迟。如果仍然触发，可以增大 `candidateDelayMs` 和 `captchaRefetchDelayMs` 配置值。

### Q: 手动模式超时了怎么办？

手动模式有 120 秒的超时时间。如果超时，重新运行即可。也可以在代码中修改超时值（搜索 `120000`）。

### Q: 程序能在后台一直运行吗？

可以。程序设计为长期运行，每轮查询完会等待指定间隔后再查。使用 `Ctrl+C` 随时退出。

### Q: 如何确认邮件配置是否正确？

首次配置 SMTP 并启动程序后，会自动发送一封测试邮件。收到即说明配置成功。如果没收到，启动日志会显示失败原因。也可以修改 `config.json` 中的 SMTP 任意一项（如 `to` 收件人）后重新启动，程序检测到配置变更会重新发送测试邮件。

---

## 依赖

| 包 | 用途 |
|----|------|
| `playwright` | 浏览器自动化，操作 Chrome |
| `tesseract.js` | OCR 识别验证码（仅自动模式） |
| `sharp` | 验证码图片预处理（放大、灰度、二值化） |
| `nodemailer` | SMTP 邮件发送（仅邮件通知） |
| `lz-string` | 表单数据的 LZString 压缩编码 |
