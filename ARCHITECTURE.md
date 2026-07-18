# 项目构建思路

## 一、需求分析

用户需要在 [江西省教育考试院](https://jxcf.jxeea.cn/) 查询高考录取结果。核心需求：

1. 录取结果尚未公布时，网站显示"暂无录取信息"
2. 录取公布后，页面会出现录取表格（院校名称、专业名称等）
3. 需要有人 **自动、定时** 去查询，一旦查到录取信息就立刻通知用户

技术挑战：该网站有 **4位数字验证码**，必须正确输入才能查询。

---

## 二、网站逆向分析

### 2.1 页面结构

访问 `https://jxcf.jxeea.cn/`，是一个标准的表单页：

```
┌──────────────────────────────────────┐
│  江西省2026年普通高考成绩及录取查询    │
│                                      │
│  考生号/准考证号：[_______________]   │
│  证件号码后4位：  [_______________]   │
│  验证码：         [____] [图片]       │
│            [查询]                     │
└──────────────────────────────────────┘
```

### 2.2 验证码机制

从页面 JS（`query.js`）分析出验证码的获取方式：

```javascript
// 点击验证码图片触发
var url = "/captcha/getcode?t=" + new Date().getTime();
$.getJSON(url, {}, function (res) {
    if (res.Code === 1) {
        // 将 base64 图片设置到 img 标签
        $(".img-verifycode").attr("src", "data:image/png;base64," + res.Data.Img);
    }
});
```

关键发现：
- 验证码接口：`GET /captcha/getcode?t=<时间戳>`
- 返回 JSON：`{ Code: 1, Data: { Img: "<base64 JPEG>" } }`
- 验证码图片实际是 **64×30 像素的 JPEG**（不是 PNG，虽然 MIME 写成 png）
- 验证码是 **4 位纯数字**（用户确认）
- 验证码绑定到服务端 Session（通过 `_cap_id` Cookie）

### 2.3 表单提交

```javascript
function submitForm() {
    var key1 = $("#key1").val();  // 考生号
    var key2 = $("#key2").val();  // 证件后4位
    var key3 = $(".code").val();  // 验证码

    // 关键：三个字段都用 LZString 压缩成 Base64 再提交
    $("#key1_target").val(LZString.compressToBase64(key1));
    $("#key2_target").val(LZString.compressToBase64(key2));
    $("#key3_target").val(LZString.compressToBase64(key3));

    return true; // 表单以 POST 方式提交到当前 URL
}
```

- 表单 `method="post"`，无 `action` 属性 → 提交到当前 URL
- 三个字段 `key1`, `key2`, `key3` 都经过 **LZString.compressToBase64** 压缩
- 验证码验证完全在服务端，客户端 JS 中没有本地校验逻辑

### 2.4 结果页面结构

查询成功后的返回页面有两种状态：

**状态 A — 暂无录取信息：**
```
title: "江西省2026年普通高考成绩及录取查询结果"
├── Tab: 录取结果
│   └── "暂无录取信息"
└── Tab: 成绩
    ├── 姓名：袁畅
    ├── 准考证号：51078304618
    ├── 考生号：26360783150795
    ├── 语文：104  数学：68  英语：132
    ├── 物理：47   化学：73  生物：90
    └── 总分：514
```

**状态 B — 已录取（推测）：**
```
├── 考生状态：已录取（或其他状态）
├── 院校代号：xxxx
├── 院校名称：xxxx大学
├── 专业组名称：xxx
├── 专业代号：xx
└── 专业名称：xxx专业
```

检测关键：页面中是否包含 `院校名称` / `专业名称` 等表格表头，且同时不包含 `暂无录取`。

---

## 三、方案选型

### 3.1 方案对比

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **纯 HTTP 请求** | 轻量，无需浏览器 | 需要手动处理 LZString 压缩、Cookie 管理；验证码 OCR 困难 | ❌ 验证码是瓶颈 |
| **Playwright + OCR** | 浏览器自动处理所有 JS/Cookie/表单；可截图 | 需要 Chrome；OCR 准确率取决于验证码难度 | ✅ 选用 |
| **Playwright + 手动输入** | 100% 准确 | 需要人参与 | ✅ 作为备选模式 |
| **Puppeteer** | 类似 Playwright | Playwright API 更现代 | - |

### 3.2 为什么选 Playwright 而非纯 HTTP

1. **LZString 压缩**：虽然 Node.js 有 `lz-string` 包，但服务端可能校验其他 header（如 Referer、Origin）
2. **Cookie 管理**：验证码绑定 Session，Playwright 自动管理 Cookie 生命周期
3. **弹窗处理**：错误时页面弹出"验证码错误"弹窗，需要点击"知道了"关闭，Playwright 可以自动化这些交互
4. **调试友好**：`--headed` 模式可以直观看到浏览器操作

### 3.3 为什么用系统 Chrome 而非 Playwright 内置 Chromium

内置 Chromium 需要额外下载 ~180MB，容易超时。系统已安装 Chrome，通过 `channel: "chrome"` 直接复用。

---

## 四、OCR 方案设计

### 4.1 挑战

验证码图片只有 **64×30 像素**，且是 JPEG 格式（4:2:0 色度子采样导致颜色渗漏）。标准 OCR 引擎对此类极小图片识别率很低。

### 4.2 多策略预处理流水线

```
原始图片 (64×30 JPEG)
    │
    ├── 策略1: 彩色放大 4x/6x/8x → PSM 6/7/8 → OCR
    │
    ├── 策略2: 灰度 → 放大 6x → 6种阈值(100~150) → OCR
    │
    └── 策略3: 灰度 → 放大 6x → 归一化 → PSM 7/8 → OCR
                │
                ▼
        候选数字列表（去重、排序）
        优先选4位数、confidence 最高的
```

关键参数：
- `tessedit_char_whitelist`: `"0123456789"` — 只识别数字，排除字母干扰
- `tessedit_pageseg_mode`: `"7"`（单行文本）/ `"8"`（单个词）/ `"6"`（均匀块）
- `sharp` 缩放：`kernel: "nearest"` 最近邻插值，保持像素锐利
- 二值化阈值遍历 100~150，覆盖不同对比度的验证码

### 4.3 候选尝试机制

同一张验证码图片，OCR 可能产生多个不同的候选结果（如 "3782", "3780", "372"）。程序的做法是：

1. 对候选按评分排序（4 位数优先，置信度高优先）
2. 取前 3 个候选，逐一提交给服务器
3. 服务器返回"验证码错误"→ 尝试下一个候选
4. 全部错误 → 刷新验证码图片，重新 OCR
5. 每个查询周期最多刷新 3 次验证码

### 4.4 限流应对

测试中发现服务器在连续 ~6 次快速提交后会返回"操作频繁，请稍后再试"。解决方案：

- 候选间延迟 4 秒
- 刷新验证码间延迟 6 秒
- 每周期最多 3×3=9 次提交

---

## 五、程序架构

```
auto-checker.js
│
├── 配置加载
│   ├── config.example.json  → config.json（首次运行自动复制）
│   └── loadConfig()         # 深度合并默认值 + 文件配置
│
├── CONFIG (运行时)           # 命令行参数覆盖文件配置
│
├── 工具函数
│   ├── timestamp()         # 东八区时间戳
│   ├── log()               # 同时输出控制台 + 写入日志文件
│   ├── sleep()             # Promise 版延迟
│   ├── playAlert()         # Windows 蜂鸣提醒
│   ├── initMailer()        # 初始化 SMTP 连接
│   ├── sendTestEmail()     # 首次/配置变更时发送测试邮件
│   └── sendEmailNotification()  # 发送录取邮件（HTML + 截图附件）
│
├── Cookie 持久化
│   ├── saveCookies()       # 保存到 session_cookies.json
│   └── loadCookies()       # 下次启动恢复
│
├── OCR 模块（仅自动模式）
│   ├── loadOCR()           # 初始化 tesseract.js worker
│   └── recognizeCaptchaMulti()  # 多策略识别 + 去重排序
│
├── 核心查询
│   └── executeQuery(context)
│       ├── Step 1: page.goto() 访问查询页
│       ├── Step 2: 等待验证码图片加载完成
│       ├── Step 3A (自动): 提取 base64 → OCR → 候选尝试
│       ├── Step 3B (手动): 等待用户操作
│       ├── Step 4: page.content() → parseResultPage()
│       └── Step 5: 截图保存
│
├── 结果解析
│   └── parseResultPage(html)
│       ├── 检测 "暂无录取信息"  → 未出结果
│       ├── 检测 "验证码错误"    → 重试
│       ├── 检测 "操作频繁"      → 限流
│       ├── 检测录取表格        → 录取！
│       └── 提取考生信息 + 录取详情
│
└── 主循环 main()
    ├── 启动浏览器
    ├── 加载 OCR（自动模式）
    ├── 初始化邮件（如启用）→ 发送测试邮件
    ├── 恢复 Session Cookie
    └── while(true)
        ├── executeQuery()
        ├── 找到录取？
        │   ├── Yes → 发邮件 → 响铃 + 持续提醒
        │   └── No  → sleep(间隔) → 下一轮
        └── 单次模式 → break
```

---

## 六、关键设计决策

### 6.1 为什么保留两种模式

自动 OCR 模式方便但准确率受限于验证码难度。手动模式作为保底方案：用户只需在浏览器中输一次验证码，之后程序接管定时刷新。两种模式共用同一套查询、解析、提醒逻辑。

### 6.2 Session 持久化

每次成功查询后保存 Cookie 到 `session_cookies.json`。下次启动时恢复，可以减少登录次数。服务器 Session 过期后自动重新认证。

### 6.3 临时文件清理

验证码图片 `temp_captcha.png` 有三重清理保障：
1. `try-finally`：OCR 结束后立即删除
2. `SIGINT` 钩子：Ctrl+C 退出时清理
3. `exit` 钩子：进程退出兜底清理

### 6.4 为什么是 4 位数字验证码

经过实际测试和用户确认，该网站验证码为 4 位纯数字。这个信息来自：
- 前期 OCR 测试中，数字类候选的置信度明显更高
- 用户确认"验证码都是四位数"
- 白名单改为纯数字后，OCR 候选质量显著提升

### 6.5 邮件通知设计

邮件通知使用 nodemailer 库，支持主流邮箱（QQ、163、Gmail、Outlook）。设计要点：

- **懒初始化**：`initMailer()` 只在 `smtp.enabled=true` 时才创建 SMTP 连接，不影响不配置邮件的用户
- **首次测试**：`sendTestEmail()` 在配置好 SMTP 后首次启动时自动发送测试邮件，验证配置正确性
- **变更检测**：对 SMTP 关键字段（host + user + to）计算 MD5 指纹，存入 `.email_tested`。配置变更时自动重新测试，未变更则跳过
- **HTML 邮件**：正文以表格形式展示录取详情（姓名、院校、专业等），比纯文本更直观
- **截图附件**：附带录取页面的完整截图，方便用户核对
- **命令行覆盖**：`--email-on` / `--no-email` / `--email-to=` 可以在不改代码的情况下临时开关或覆盖收件人
- **失败不阻塞**：邮件发送失败只记日志，不影响响铃、截图等其他通知渠道

### 6.6 配置文件外置

配置从代码中抽离到 `config.json`，原因：

- **隐私安全**：`config.json` 被 `.gitignore` 忽略，准考证号和邮箱授权码不会误提交到 git
- **修改方便**：用户只需编辑 JSON 文件，不用看源代码
- **自动创建**：首次运行如果 `config.json` 不存在，自动从 `config.example.json` 复制，降低使用门槛
- **深度合并**：`loadConfig()` 将文件配置与内置默认值深度合并，新增配置项时向后兼容，不会因为缺字段而崩溃
- **命令行优先**：`--once`、`--headed`、`--email-to=` 等命令行参数会覆盖文件配置，方便临时调整

---

## 七、依赖说明

| 包 | 版本 | 用途 |
|----|------|------|
| `playwright` | ^1.61 | 浏览器自动化，操作 Chrome |
| `tesseract.js` | ^5.1 | WASM 版 Tesseract OCR 引擎 |
| `sharp` | ^0.35 | 图片预处理（缩放、灰度、阈值） |
| `nodemailer` | ^6.x | SMTP 邮件发送 |
| `lz-string` | ^1.5 | LZString 压缩（备用于纯 HTTP 方案，当前 Playwright 方案不需要手动压缩） |
