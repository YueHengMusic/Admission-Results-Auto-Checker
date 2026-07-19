# 项目构建思路

## 一、需求分析

用户需要在 [江西省教育考试院](https://jxcf.jxeea.cn/) 查询高考录取结果。核心需求：

1. 录取结果尚未公布时，网站显示"暂无录取信息"
2. 录取公布后，页面会出现录取表格（院校名称、专业名称等）
3. 需要有人 **自动、定时** 去查询，一旦查到录取信息就立刻通知用户

技术挑战：该网站有 **4位字母+数字混合验证码**，必须正确输入才能查询。

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
- 验证码是 **4位字母+数字混合**（含大小写，服务器不区分）
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
    ├── 姓名：张三
    ├── 准考证号：12345678901
    ├── 考生号：26360783150000
    ├── 语文：104  数学：68  英语：132
    ├── 物理：47   化学：73  生物：90
    └── 总分：514
```

**状态 B — 已录取（完整9字段）：**
```
├── 考生状态：已录取
├── 院校代号：xxxx
├── 院校名称：xxxx大学
├── 专业组名称：xxx
├── 专业代号：xx
├── 专业名称：xxx专业
├── 批次名称：本科一批
├── 科类名称：理工
└── 计划性质：非定向
```

检测关键：页面中是否存在 `<table class="enro-result">` 录取表格，且表格内数据 `<td>` 非空。

---

## 三、方案选型

### 3.1 方案对比

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **纯 HTTP 请求** | 轻量，无需浏览器 | 需要手动处理 LZString 压缩、Cookie 管理；验证码 OCR 困难 | ❌ 验证码是瓶颈 |
| **Playwright + ddddocr** | 浏览器自动化 + 专用验证码识别 | 需要 Python | ✅ 选用 |

### 3.2 为什么选 Playwright 而非纯 HTTP

1. **LZString 压缩**：虽然 Node.js 有 `lz-string` 包，但服务端可能校验其他 header（如 Referer、Origin）
2. **Cookie 管理**：验证码绑定 Session，Playwright 自动管理 Cookie 生命周期
3. **弹窗处理**：错误时页面弹出"验证码错误"弹窗，需要点击"知道了"关闭，Playwright 可以自动化这些交互
4. **调试友好**：`--headed` 模式可以直观看到浏览器操作

### 3.3 浏览器策略

- **Windows**：注册表检测 Chrome → Edge → Playwright 内置 Chromium
- **macOS / Linux**：直接使用 Playwright 内置 Chromium（系统浏览器路径不稳定，内置更可靠）
- 内置 Chromium 首次需下载约 180MB，`setup` 脚本会自动处理

---

## 四、OCR 方案设计

### 4.1 最终方案：ddddocr（主力）+ tesseract.js（备选）

经过大量测试，tesseract.js 对 64×30 的 JPEG 验证码识别率极低（<5%）。最终选用 **[ddddocr](https://github.com/sml2h3/ddddocr)**（Python 库，GitHub 14.5k⭐），专门为中国网站小型验证码训练，实测准确率接近 100%。

**工作流程：**
```
验证码图片
    │
    ├── ddddocr (Python, ~1秒) → 命中 → 直接返回 ✅
    │
    └── 未命中 → tesseract.js 多策略（备选）
        ├── 12x放大 + PSM 7/8/6 + 无白名单
        └── 去重排序 → 逐候选提交
```

**调用方式：** Node.js 通过 `child_process.execSync` 调用 `py ocr_server.py <image>`，stdout 输出结果。首次调用失败则标记 ddddocr 不可用，后续自动回退 tesseract。

### 4.2 候选尝试与限流

每张验证码的候选提交策略：
1. ddddocr 命中 → 唯一候选，直接提交
2. 未命中 → tesseract 产生 3-4 个候选，逐个提交
3. 全部错误 → 刷新验证码，重新识别
4. 每个查询周期最多刷新 5 次
5. 候选间延迟 3 秒，刷新间延迟 5 秒（防限流）

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
│   ├── sendDesktopNotification()  # 桌面弹窗（跨平台）
│   ├── initMailer()        # 初始化 SMTP 连接
│   ├── sendTestEmail()     # 首次查询成功后发送（含考生信息+状态）
│   └── sendEmailNotification()  # 发送录取邮件（HTML + 截图附件）
│
├── Cookie 持久化
│   ├── saveCookies()       # 保存到 session_cookies.json
│   └── loadCookies()       # 下次启动恢复
│
├── OCR 模块
│   ├── ocr_server.py      # ddddocr Python 脚本（主力）
│   ├── ocrViaDdddocr()    # Node→Python 调用，~1秒出结果
│   ├── loadOCR()          # 初始化 tesseract.js worker（备选）
│   └── recognizeCaptchaMulti()  # ddddocr优先 → tesseract回退
│
├── 核心查询
│   └── executeQuery(context)
│       ├── Step 1: page.goto() 访问查询页，等待验证码加载
│       ├── Step 2: OCR识别验证码 → 候选提交
│       ├── Step 3: page.content() → parseResultPage()
│       └── Step 4: 录取时保存截图
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
    ├── 加载 OCR
    ├── 初始化邮件（如启用）
    ├── 恢复 Session Cookie
    └── while(true)
        ├── executeQuery()
        ├── 首次成功？→ 发送测试邮件
        ├── 找到录取？
        │   ├── Yes → 发邮件 → 弹窗 + 持续提醒
        │   └── No  → sleep(间隔) → 下一轮
        └── 单次模式 → break
```

---

## 六、关键设计决策

### 6.1 为什么选 ddddocr 而非纯 tesseract

经过大量实测，tesseract.js 对 64×30 的 JPEG 验证码识别率极低（<5%）。改用专门为中国网站验证码训练的 ddddocr 后准确率接近 100%。ddddocr 不可用时自动回退 tesseract.js 作为备选。

### 6.2 Session 持久化

每次成功查询后保存 Cookie 到 `session_cookies.json`。下次启动时恢复，可以减少登录次数。服务器 Session 过期后自动重新认证。

### 6.3 临时文件清理

验证码图片 `temp_captcha.png` 有三重清理保障：
1. `try-finally`：OCR 结束后立即删除
2. `SIGINT` 钩子：Ctrl+C 退出时清理
3. `exit` 钩子：进程退出兜底清理

### 6.4 验证码格式的确认过程

最初以为是纯数字，后来实测发现 OCR 在数字白名单下几乎无输出。去掉白名单后 tesseract 读到了 "TPpf"、"PCxX" 等字母数字混合结果。结合页面提示"验证码（不分大小写）"，确认实际是 **4 位字母+数字混合**。白名单改为字母数字混合后，OCR 候选产量和质量显著提升。

### 6.5 邮件通知设计

邮件通知使用 nodemailer 库，支持主流邮箱（QQ、163、Gmail、Outlook）。设计要点：

- **懒初始化**：`initMailer()` 只在 `smtp.enabled=true` 时才创建 SMTP 连接，不影响不配置邮件的用户
- **首次测试**：`sendTestEmail()` 在第一次查询成功后发送，包含考生姓名、当前录取状态和运行配置，一次性验证 SMTP + 查询 + 考生信息
- **变更检测**：对 SMTP 关键字段（host + user + to）计算 MD5 指纹，存入 `.email_tested`。配置变更时自动重新测试，未变更则跳过
- **HTML 邮件**：正文以表格形式展示录取详情（姓名、院校、专业等），比纯文本更直观
- **截图附件**：附带录取页面的完整截图，方便用户核对
- **命令行覆盖**：`--email-on` / `--no-email` / `--email-to=` 可以在不改代码的情况下临时开关或覆盖收件人
- **失败不阻塞**：邮件发送失败只记日志，不影响弹窗、截图等其他通知渠道

### 6.6 配置文件外置

配置从代码中抽离到 `config.json`，原因：

- **隐私安全**：`config.json` 被 `.gitignore` 忽略，准考证号和邮箱授权码不会误提交到 git
- **修改方便**：用户只需编辑 JSON 文件，不用看源代码
- **自动创建**：首次运行如果 `config.json` 不存在，自动从 `config.example.json` 复制，降低使用门槛
- **深度合并**：`loadConfig()` 将文件配置与内置默认值深度合并，新增配置项时向后兼容，不会因为缺字段而崩溃
- **命令行优先**：`--once`、`--headed`、`--email-to=` 等命令行参数会覆盖文件配置，方便临时调整

### 6.7 长期运行保障

- **浏览器内存释放**：每 N 次查询或 N 小时后自动重启浏览器（`browserRestartQueries` / `browserRestartHours` 可配）
- **失败告警**：连续 N 次查询全部失败时自动发送告警邮件（`failureAlertThreshold` 可配）
- **邮件重试**：录取通知邮件失败后自动重试最多 3 次（间隔 30 秒）
- **页面解析泛化**：CSS class 匹配 + 关键词兜底 + "暂无录取"10 种变体覆盖，网站改版不漏报
- **状态追踪**：持续监测考生状态变化，支持全状态链路

### 6.8 录取状态追踪

程序记录 `lastAdmissionStatus`，每次对比当前状态，分为三类：

| 分类 | 判断逻辑 | 行为 |
|------|---------|------|
| **最终录取** | 含"录取"且不含"预/拟/退/未/不/审" | 🎉 发录取通知+弹窗3次，**停止** |
| **危险状态** | 子串匹配"退档/自由可投/未录取/不予录取" | ⚠️ 发警告邮件+弹窗，继续轮询 |
| **普通状态** | 其他（投档/院校在阅/预录取/拟录取等） | 📋 状态变化时通知，继续轮询 |

判断顺序：危险 > 最终 > 普通，互斥。只有 `isFinalStatus` 通过时才停止。

---

## 七、依赖说明

| 包 | 版本 | 用途 |
|----|------|------|
| `ddddocr` (Python) | 1.6 | 验证码识别引擎（主力，准确率~100%） |
| `playwright` | ^1.61 | 浏览器自动化，操作 Chrome |
| `tesseract.js` | ^5.1 | WASM 版 Tesseract OCR（备选方案） |
| `sharp` | ^0.35 | 图片预处理（缩放） |
| `nodemailer` | ^9.x | SMTP 邮件发送 |
| `node-notifier` | ^10.x | 桌面弹窗通知（跨平台） |
