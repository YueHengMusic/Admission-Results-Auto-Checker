/**
 * 江西省高考录取结果自动查询工具 v2
 * 
 * 网站: https://jxcf.jxeea.cn/
 * 
 * 使用方法:
 *   node auto-checker.js                     # 自动模式 (ddddocr识别验证码)
 *   node auto-checker.js --headed            # 显示浏览器窗口（方便调试）
 *   node auto-checker.js --once              # 只查询一次
 *   node auto-checker.js --interval=5        # 每5分钟查询一次
 *   node auto-checker.js --email-on          # 启用邮件通知（需先配置SMTP）
 *   node auto-checker.js --email-to=me@qq.com # 指定收件人
 *   node auto-checker.js --no-email          # 禁用邮件通知
 * 
 * OCR方案: ddddocr (Python, 主力) + tesseract.js (Node, 按需懒加载备选)
 */

const { chromium } = require("playwright");
const nodemailer = require("nodemailer");
const notifier = require("node-notifier");
const path = require("path");
const fs = require("fs");

// ===================== 配置加载 =====================

const CONFIG_FILE = path.join(__dirname, "config.json");
const CONFIG_EXAMPLE_FILE = path.join(__dirname, "config.example.json");

/**
 * 如果 config.json 不存在，从 config.example.json 复制一份
 */
if (!fs.existsSync(CONFIG_FILE)) {
  if (fs.existsSync(CONFIG_EXAMPLE_FILE)) {
    fs.copyFileSync(CONFIG_EXAMPLE_FILE, CONFIG_FILE);
    console.log("已从 config.example.json 创建 config.json，请编辑后重新运行。");
  } else {
    console.log("config.json 和 config.example.json 均不存在，使用内置默认配置。");
  }
}

/**
 * 读取配置文件，缺失字段用默认值填充
 */
function loadConfig() {
  const defaults = {
    examNumber: "",
    idLast4: "",
    checkIntervalMinutes: 10,
    maxCaptchaRefetches: 5,
    maxCandidatesPerCaptcha: 4,
    candidateDelayMs: 3000,
    captchaRefetchDelayMs: 5000,
    headless: true,
    browserRestartQueries: 50,       // 每N次查询重启浏览器释放内存
    browserRestartHours: 6,          // 或每N小时重启浏览器
    failureAlertThreshold: 6,        // 连续N次失败发送告警邮件
    smtp: {
      enabled: false,
      host: "smtp.qq.com",
      port: 465,
      secure: true,
      auth: { user: "", pass: "" },
      from: "",
      to: "",
    },
  };

  let fileConfig = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    }
  } catch (e) {
    console.error("读取 config.json 失败:", e.message);
  }

  // 深度合并：文件配置覆盖默认值，跳过 _ 开头的注释键
  function merge(defaults, file) {
    const result = { ...defaults };
    if (!file || typeof file !== "object") return result;  // null/非对象直接返回默认
    for (const key of Object.keys(result)) {
      if (key.startsWith("_")) continue;  // 跳过注释字段
      if (file[key] !== undefined) {
        if (typeof result[key] === "object" && !Array.isArray(result[key]) && typeof file[key] === "object") {
          result[key] = merge(result[key], file[key]);
        } else {
          result[key] = file[key];
        }
      }
    }
    return result;
  }

  return merge(defaults, fileConfig);
}

const CONFIG = loadConfig();

// 类型强制转换：防止 config.json 中误填字符串类型导致计算异常
// 注意：checkIntervalMinutes/browserRestartQueries/failureAlertThreshold 的 0 是合法值，不能用 ||
CONFIG.checkIntervalMinutes = isNaN(Number(CONFIG.checkIntervalMinutes)) ? 10 : Number(CONFIG.checkIntervalMinutes);
CONFIG.maxCaptchaRefetches = isNaN(Number(CONFIG.maxCaptchaRefetches)) ? 5 : Number(CONFIG.maxCaptchaRefetches);
CONFIG.maxCandidatesPerCaptcha = isNaN(Number(CONFIG.maxCandidatesPerCaptcha)) ? 4 : Number(CONFIG.maxCandidatesPerCaptcha);
CONFIG.candidateDelayMs = isNaN(Number(CONFIG.candidateDelayMs)) ? 3000 : Number(CONFIG.candidateDelayMs);
CONFIG.captchaRefetchDelayMs = isNaN(Number(CONFIG.captchaRefetchDelayMs)) ? 5000 : Number(CONFIG.captchaRefetchDelayMs);
CONFIG.headless = CONFIG.headless !== false;  // 只有明确设为 false 才显示窗口
CONFIG.browserRestartQueries = isNaN(Number(CONFIG.browserRestartQueries)) ? 50 : Number(CONFIG.browserRestartQueries);
CONFIG.browserRestartHours = isNaN(Number(CONFIG.browserRestartHours)) ? 6 : Number(CONFIG.browserRestartHours);
CONFIG.failureAlertThreshold = isNaN(Number(CONFIG.failureAlertThreshold)) ? 6 : Number(CONFIG.failureAlertThreshold);
if (CONFIG.smtp) {
  CONFIG.smtp.port = isNaN(Number(CONFIG.smtp.port)) ? 465 : Number(CONFIG.smtp.port);
  CONFIG.smtp.enabled = CONFIG.smtp.enabled === true || CONFIG.smtp.enabled === "true";
  CONFIG.smtp.secure = CONFIG.smtp.secure !== false;
}

// 解析命令行参数
for (const arg of process.argv.slice(2)) {
  if (arg === "--once") CONFIG.checkIntervalMinutes = 0;
  else if (arg.startsWith("--interval=")) {
    const v = parseInt(arg.split("=")[1], 10);
    CONFIG.checkIntervalMinutes = isNaN(v) ? 10 : v;
  }
  else if (arg === "--headed") CONFIG.headless = false;  // 显示浏览器窗口
  else if (arg === "--no-email") CONFIG.smtp.enabled = false;
  else if (arg.startsWith("--email-to=")) CONFIG.smtp.to = arg.split("=")[1];
  else if (arg === "--email-on") CONFIG.smtp.enabled = true;
}

const BASE_URL = "https://jxcf.jxeea.cn";
const LOG_FILE = path.join(__dirname, "auto-checker.log");
const RESULT_DIR = path.join(__dirname, "results");
const COOKIE_FILE = path.join(__dirname, "session_cookies.json");

if (!fs.existsSync(RESULT_DIR)) fs.mkdirSync(RESULT_DIR, { recursive: true });

// 启动校验：防止使用默认假号直接查询
if (!CONFIG.examNumber || CONFIG.examNumber === "12345678901") {
  console.error("❌ 请先在 config.json 中填写正确的准考证号 (examNumber) 和身份证后4位 (idLast4)！");
  process.exit(1);
}
if (!CONFIG.idLast4 || CONFIG.idLast4 === "1234" || CONFIG.idLast4.length !== 4) {
  console.error("❌ 请先在 config.json 中填写正确的身份证后4位 (idLast4，需为4位)！");
  process.exit(1);
}

// ===================== 工具函数 =====================

/** 东八区时间戳，用于日志和邮件 */
function timestamp() {
  return new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

/** 同时输出到控制台和日志文件 */
function log(message) {
  const line = `[${timestamp()}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

/** Promise 版延迟 */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** HTML 转义，防止邮件内容注入 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 桌面弹窗通知（Windows/macOS/Linux）
 */
function sendDesktopNotification(title, message) {
  try {
    notifier.notify({
      title,
      message,
      sound: true,
      wait: false,
      timeout: 10,
    });
  } catch (e) { /* node-notifier 不可用时静默忽略 */ }
}

// ===================== 邮件通知 =====================

let mailTransporter = null;
const EMAIL_TESTED_FILE = path.join(__dirname, ".email_tested");

/** 对SMTP关键字段取MD5，用于检测配置是否变更 */
function smtpConfigFingerprint() {
  // 用关键字段生成指纹，配置变了就重新测试
  const key = `${CONFIG.smtp.host}|${CONFIG.smtp.auth.user}|${CONFIG.smtp.to}`;
  return require("crypto").createHash("md5").update(key).digest("hex");
}

/** 记录已测试的SMTP指纹 */
function markEmailTested() {
  fs.writeFileSync(EMAIL_TESTED_FILE, smtpConfigFingerprint());
}

/** 检查SMTP配置是否已经过测试 */
function isEmailAlreadyTested() {
  try {
    if (fs.existsSync(EMAIL_TESTED_FILE)) {
      return fs.readFileSync(EMAIL_TESTED_FILE, "utf8").trim() === smtpConfigFingerprint();
    }
  } catch (e) { /* */ }
  return false;
}

/**
 * 初始化SMTP连接（懒加载，首次发送邮件时才创建）
 */
function initMailer() {
  if (!CONFIG.smtp.enabled) return;
  if (mailTransporter) return;
  
  mailTransporter = nodemailer.createTransport({
    host: CONFIG.smtp.host,
    port: CONFIG.smtp.port,
    secure: CONFIG.smtp.secure,
    auth: {
      user: CONFIG.smtp.auth.user,
      pass: CONFIG.smtp.auth.pass,
    },
  });
  
  log("  📧 邮件通知已配置");
}

/**
 * 邮件样式 — 极简扁平风格
 */
function emailStyle() {
  return `
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8f9fa; margin: 0; padding: 20px; }
      .card { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,.06); overflow: hidden; }
      .head { padding: 24px 28px 16px; border-bottom: 1px solid #eee; }
      .head h2 { margin: 0; font-size: 20px; font-weight: 600; color: #1a1a1a; }
      .head .sub { margin-top: 4px; font-size: 13px; color: #888; }
      .head .emoji { font-size: 28px; margin-bottom: 4px; }
      .body { padding: 20px 28px; }
      .section { margin-bottom: 20px; }
      .section:last-child { margin-bottom: 0; }
      .section-label { font-size: 11px; font-weight: 600; color: #999; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 8px; }
      table.info { width: 100%; border-collapse: collapse; }
      table.info td { padding: 8px 0; font-size: 14px; border-bottom: 1px solid #f5f5f5; }
      table.info td:first-child { color: #777; width: 80px; }
      table.info td:last-child { color: #1a1a1a; text-align: right; }
      table.info tr:last-child td { border-bottom: none; }
      .tip { padding: 12px 16px; border-radius: 4px; font-size: 13px; line-height: 1.5; margin: 16px 0; }
      .tip-ok { background: #f6f9f6; color: #2d6a2d; }
      .tip-warn { background: #fef9f0; color: #8a6d14; }
      .foot { padding: 16px 28px; border-top: 1px solid #eee; font-size: 11px; color: #bbb; text-align: center; }
      .highlight { background: #f0fdf4; border-left: 3px solid #22c55e; padding: 12px 16px; border-radius: 6px; margin: 16px 0; font-size: 14px; color: #166534; }
      .warn { background: #fffbeb; border-left: 3px solid #f59e0b; padding: 12px 16px; border-radius: 6px; margin: 16px 0; font-size: 14px; color: #92400e; }
      .footer { text-align: center; color: #aaa; font-size: 12px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #f0f0f0; }
      .badge { display: inline-block; background: #22c55e; color: #fff; padding: 2px 10px; border-radius: 10px; font-size: 12px; margin-left: 6px; }
    </style>
  `;
}

/**
 * 发送测试邮件（首次查询成功后调用，包含实际查询结果）
 * @param {object} queryResult - executeQuery 返回的结果
 */
async function sendTestEmail(queryResult) {
  if (!CONFIG.smtp.enabled) return;
  
  if (isEmailAlreadyTested()) {
    log("  📧 邮件配置未变更，跳过测试");
    return;
  }
  
  if (!mailTransporter) initMailer();
  
  const nameMatch = queryResult.html ? queryResult.html.match(/<span class="kname">([^<]+)<\/span>/) : null;
  const studentName = escapeHtml(nameMatch ? nameMatch[1].trim() : "未知");
  const statusText = escapeHtml(queryResult.found ? "已录取" : (queryResult.message || "查询成功"));
  
  log("  📧 发送测试邮件（含查询结果验证）...");
  
  const htmlBody = `
    <!DOCTYPE html><html><head><meta charset="utf-8">${emailStyle()}</head><body>
    <div class="card">
      <div class="head">
        <div class="emoji">✅</div>
        <h2>录取查询工具 — 配置验证</h2>
        <div class="sub">${studentName} · ${statusText}</div>
      </div>
      <div class="body">
        <div class="tip tip-ok">所有配置已验证通过，录取结果出来时会自动发送通知。</div>
        
        <div class="section"><div class="section-label">考生信息</div>
        <table class="info">
          <tr><td>姓名</td><td>${studentName}</td></tr>
          <tr><td>准考证号</td><td>${CONFIG.examNumber}</td></tr>
          <tr><td>证件后4位</td><td>${CONFIG.idLast4}</td></tr>
          <tr><td>当前状态</td><td>${statusText}</td></tr>
        </table>
        
        <div class="section"><div class="section-label">运行配置</div>
        <table class="info">
          <tr><td>查询间隔</td><td>${CONFIG.checkIntervalMinutes} 分钟</td></tr>
          <tr><td>SMTP 服务器</td><td>${CONFIG.smtp.host}:${CONFIG.smtp.port}</td></tr>
          <tr><td>收件人</td><td>${CONFIG.smtp.to}</td></tr>
        </table>
        
        <div class="tip tip-warn">⚠️ 如有误请修改 config.json 后重新运行。</div>
        
        <div class="foot">录取结果自动查询工具 · ${timestamp()}</div>
      </div>
    </div>
    </body></html>
  `;
  
  // 发送测试邮件（共2次尝试，间隔15秒）
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const info = await mailTransporter.sendMail({
        from: CONFIG.smtp.from,
        to: CONFIG.smtp.to,
        subject: `✅ 录取查询工具 — 配置验证 (${studentName} ${statusText})`,
        html: htmlBody,
      });
      log(`  ✅ 测试邮件已发送: ${info.messageId}`);
      markEmailTested();
      return;
    } catch (err) {
      if (attempt < 1) {
        await sleep(15000);
      } else {
        log(`  ⚠️ 测试邮件发送失败: ${err.message}`);
        log(`  ⚠️ 请检查 config.json 中的 SMTP 配置`);
        log(`  ⚠️ 程序将继续运行，录取时邮件通知可能无法送达`);
      }
    }
  }
}


/**
 * 发送状态变化通知邮件
 */
async function sendStatusChangeEmail(oldStatus, newStatus, details, screenshotPath, danger = false) {
  if (!CONFIG.smtp.enabled || !mailTransporter) return;
  
  const school = escapeHtml(details?.["院校名称"] || "");
  const statusText = oldStatus ? `${escapeHtml(oldStatus)} → ${escapeHtml(newStatus)}` : `当前状态: ${escapeHtml(newStatus)}`;
  const emoji = danger ? "⚠️" : (oldStatus ? "🔄" : "📋");
  const title = danger ? "⚠️ 录取状态警告" : (oldStatus ? "录取状态更新" : "检测到投档信息");
  
  let detailRows = "";
  if (details) {
    for (const [key, value] of Object.entries(details)) {
      if (key === "考生状态") continue;
      detailRows += `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(String(value))}</td></tr>`;
    }
  }

  const htmlBody = `
    <!DOCTYPE html><html><head><meta charset="utf-8">${emailStyle()}</head><body>
    <div class="card">
      <div class="head">
        <div class="emoji">${emoji}</div>
        <h2>${title}</h2>
        <div class="sub">${statusText}${school ? " · " + school : ""}</div>
      </div>
      <div class="body">
        <div class="section"><div class="section-label">当前详情</div>
        <table class="info">
          <tr><td>状态变化</td><td>${statusText}</td></tr>
          ${detailRows}
        </table></div>
        <div class="foot">程序将持续监测 · ${timestamp()}</div>
      </div>
    </div>
    </body></html>
  `;

  try {
    await mailTransporter.sendMail({
      from: CONFIG.smtp.from,
      to: CONFIG.smtp.to,
      subject: `${emoji} 录取状态: ${statusText}`,
      attachments: screenshotPath ? [{ filename: path.basename(screenshotPath), path: screenshotPath }] : [],
      html: htmlBody,
    });
    log("  📧 状态邮件已发送");
  } catch (e) {
    log(`  📧 状态邮件发送失败: ${e.message}`);
  }
}

/**
 * 发送录取通知邮件（精美HTML格式 + 截图附件）
 */
async function sendEmailNotification(details, screenshotPath) {
  if (!CONFIG.smtp.enabled) {
    log("  📧 邮件通知未启用，跳过");
    return;
  }
  if (!mailTransporter) initMailer();
  
  const school = escapeHtml(details?.["院校名称"] || "");
  const major = escapeHtml(details?.["专业名称"] || "");
  
  // 构建录取详情表格行
  let detailRows = "";
  if (details && Object.keys(details).length > 0) {
    for (const [key, value] of Object.entries(details)) {
      if (key === "姓名" || key === "准考证号" || key === "考生号") continue; // 基本信息已在标题区
      detailRows += `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(String(value))}</td></tr>`;
    }
  }
  
  const htmlBody = `
    <!DOCTYPE html><html><head><meta charset="utf-8">${emailStyle()}</head><body>
    <div class="card">
      <div class="head">
        <div class="emoji">🎉</div>
        <h2>高考录取结果已出</h2>
        <div class="sub">${school}${major ? " · " + major : ""}</div>
      </div>
      <div class="body">
        <div class="tip tip-ok">恭喜！你的录取结果已公布。</div>
        
        <div class="section"><div class="section-label">基本信息</div>
        <table class="info">
          <tr><td>姓名</td><td>${escapeHtml(details?.["姓名"] || "")}</td></tr>
          <tr><td>准考证号</td><td>${escapeHtml(details?.["准考证号"] || CONFIG.examNumber)}</td></tr>
          <tr><td>考生号</td><td>${escapeHtml(details?.["考生号"] || "")}</td></tr>
        </table>
        
        <div class="section"><div class="section-label">录取详情</div>
        <table class="info">
          ${detailRows}
        </table>
        
        <div class="foot">录取结果自动查询工具 · ${timestamp()}<br>页面截图见附件</div>
      </div>
    </div>
    </body></html>
  `;
  
  const attachments = [];
  if (screenshotPath && fs.existsSync(screenshotPath)) {
    attachments.push({
      filename: path.basename(screenshotPath),
      path: screenshotPath,
    });
  }
  
  // 发送邮件（共3次尝试，间隔30秒，应对临时网络故障）
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const info = await mailTransporter.sendMail({
        from: CONFIG.smtp.from,
        to: CONFIG.smtp.to,
        subject: `🎉 高考录取结果已出！${school ? " — " + school : ""}`,
        html: htmlBody,
        attachments,
      });
      log(`  📧 邮件已发送: ${info.messageId}`);
      return true;
    } catch (err) {
      if (attempt < 2) {
        log(`  📧 邮件发送失败(尝试${attempt + 1}/3): ${err.message}，30秒后重试...`);
        await sleep(30000);
      } else {
        log(`  📧 邮件发送失败(已重试3次): ${err.message}`);
        return false;
      }
    }
  }
  return false;
}

// ===================== Cookie 持久化 =====================

/** 保存浏览器Cookie到文件，下次启动恢复 */
function saveCookies(cookies) {
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2), { mode: 0o600 });
  log("  → 会话已保存");
}

/** 从文件恢复上次的浏览器Cookie */
function loadCookies() {
  try {
    if (fs.existsSync(COOKIE_FILE)) {
      return JSON.parse(fs.readFileSync(COOKIE_FILE, "utf8"));
    }
  } catch (e) { /* */ }
  return null;
}

// ===================== OCR（ddddocr主力 + tesseract备选） =====================

const PYTHON_CMD = (() => {
  // 跨平台检测：Windows 用 where（PATH查找，不启动解释器），其他平台用 command -v
  if (process.platform === "win32") {
    try { require("child_process").execSync("where py", { stdio: "ignore" }); return "py"; } catch {}
    try { require("child_process").execSync("where python", { stdio: "ignore" }); return "python"; } catch {}
    return "py"; // 最后尝试
  }
  try { require("child_process").execSync("command -v python3", { stdio: "ignore" }); return "python3"; } catch {}
  try { require("child_process").execSync("command -v python", { stdio: "ignore" }); return "python"; } catch {}
  return "python3";
})();
let ocrWorker = null;
let tesseractLoading = false;   // 防止并发初始化
let tesseractFailed = false;    // 初始化失败后不再重试
let ddddocrAvailable = null;  // null=未检测, true=可用, false=不可用

/**
 * 懒加载 tesseract.js（仅在 ddddocr 回退时首次调用，避免启动时下载15MB语言包）
 */
async function ensureTesseract() {
  if (ocrWorker) return true;
  if (tesseractFailed) return false;
  if (tesseractLoading) {
    // 已有初始化在进行中，等待完成
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      if (ocrWorker) return true;
      if (tesseractFailed) return false;
    }
    return false;
  }
  
  tesseractLoading = true;
  try {
    log("  → ddddocr 不可用，正在加载 tesseract 备选引擎（首次需下载语言包，约15MB）...");
    const { createWorker } = require("tesseract.js");
    ocrWorker = await createWorker("eng", 1, {
      logger: m => {
        if (m.status === "downloading") {
          const pct = m.progress ? Math.round(m.progress * 100) : 0;
          if (pct > 0 && pct % 20 === 0) log(`  → 下载中... ${pct}%`);
        }
      },
    });
    log("  ✓ tesseract 备选引擎就绪");
    return true;
  } catch (e) {
    log(`  ⚠ tesseract 初始化失败: ${e.message}`);
    tesseractFailed = true;
    return false;
  } finally {
    tesseractLoading = false;
  }
}

/**
 * 调用 ddddocr（Python）识别验证码，返回结果或 null
 */
function ocrViaDdddocr(imagePath) {
  if (ddddocrAvailable === false) return null;
  
  // 重试逻辑：Python异常 OR 非4位字母数字结果各重试最多3次；
  // 3次均失败则标记 ddddocr 不可用，后续回退 tesseract
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { execSync } = require("child_process");
      const result = execSync(`${PYTHON_CMD} "${path.join(__dirname, "ocr_server.py")}" "${imagePath}"`, {
      timeout: 10000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    
    if (result && result.length === 4 && /^[a-zA-Z0-9]+$/.test(result)) {
      ddddocrAvailable = true;
      return result;
    }
    // 格式不对（非4位字母数字），继续重试
    } catch (e) {
      // Python 异常，继续重试（最后一次时才标记不可用）
    }
  }
  // 3次全部失败，标记 ddddocr 不可用
  if (ddddocrAvailable === null) {
    log("  ⚠ ddddocr 不可用，回退到 tesseract.js");
    ddddocrAvailable = false;
  }
  return null;
}

/**
 * 识别验证码：优先ddddocr，回退tesseract多策略
 * @param {string} imagePath - 验证码图片路径
 * @returns {{code:string, confidence:number, source?:string}[]} 候选列表
 */
async function recognizeCaptchaMulti(imagePath) {
  const sharp = require("sharp");
  const worker = ocrWorker;
  const originalBuf = fs.readFileSync(imagePath);
  let W = 64, H = 30;  // 已知验证码尺寸作为默认值
  try {
    const metadata = await sharp(originalBuf).metadata();
    W = metadata.width || W;
    H = metadata.height || H;
  } catch (e) {
    // sharp 解析失败（如图片损坏），使用默认尺寸继续
  }
  
  const seen = new Set();
  const candidates = [];
  
  // 添加候选到列表（去重：3-4位字母数字）
  function add(code, conf, source) {
    // 去重：只添加3-4位字母数字，避免重复候选
    if (!seen.has(code) && code.length >= 3 && code.length <= 4) {
      seen.add(code);
      candidates.push({ code, confidence: conf, source });
    }
  }
  
  const ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  
  // 首选: ddddocr（专门针对此类验证码训练）
  const ddddResult = await ocrViaDdddocr(imagePath);
  if (ddddResult && ddddResult.length === 4) {
    // ddddocr 命中，直接返回，不再跑 tesseract
    add(ddddResult, 100, "ddddocr");
    candidates.sort((a, b) => b.confidence - a.confidence);
    return candidates;
  }
  
  // ddddocr 未命中，回退 tesseract 多策略
  if (!ocrWorker && !tesseractFailed) {
    const loaded = await ensureTesseract();
    if (!loaded) {
      // tesseract 不可用，返回 ddddocr 结果（如果有）
      if (ddddResult) add(ddddResult, 80, "ddddocr");
      candidates.sort((a, b) => b.confidence - a.confidence);
      return candidates;
    }
  }
  if (!ocrWorker) {
    // tesseract 未初始化，只能返回 ddddocr 的结果（如果有）或空
    if (ddddResult) add(ddddResult, 80, "ddddocr");
    candidates.sort((a, b) => b.confidence - a.confidence);
    return candidates;
  }
  if (ddddocrAvailable !== false) {
    // ddddocr 已加载但本次没识别出来（非首次不可用的情况）
    log("  → ddddocr 未命中，尝试 tesseract...");
  }
  const buf12 = await sharp(originalBuf).resize(W * 12, H * 12, { kernel: "nearest" }).png().toBuffer();
  
  for (const psm of ["7", "8", "6"]) {
    await worker.setParameters({ tessedit_char_whitelist: ALPHANUM, tessedit_pageseg_mode: psm });
    const { data } = await worker.recognize(buf12);
    add(data.text.replace(/[^a-zA-Z0-9]/g, ""), data.confidence, "tesseract");
  }
  
  // 无白名单兜底（可能抓到被过滤的字符）
  await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "7" });
  const { data: d2 } = await worker.recognize(buf12);
  add(d2.text.replace(/[^a-zA-Z0-9]/g, ""), d2.confidence, "tesseract");
  
  candidates.sort((a, b) => {
    // 验证码固定4位，4字符候选加权+100优先，3字符兜底不加分
    const score = (c) => (c.code.length === 4 ? 100 : 0) + c.confidence;
    return score(b) - score(a);
  });
  
  return candidates;
}

// ===================== 核心查询逻辑 =====================

/**
 * 执行一次完整的查询流程
 *   访问页面 → 获取验证码 → OCR识别 → 提交表单 → 解析结果 → 截图
 * @param {BrowserContext} context - Playwright 浏览器上下文
 * @returns {Promise<{found:boolean, message:string, html?:string, details?:object,
 *           screenshotBuf?:Buffer, htmlContent?:string, captchaError?:boolean,
 *           inputError?:boolean}>}
 */
async function executeQuery(context) {
  const page = await context.newPage();
  
  try {
    // ---- Step 1: 访问查询页面 ----
    log("  → 访问查询页面...");
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30000 });
    
    // 等待验证码加载
    await page.waitForSelector(".img-verifycode[src]", { timeout: 10000 });
    await page.waitForFunction(() => {
      const img = document.querySelector(".img-verifycode");
      return img && img.naturalWidth > 0;
    }, { timeout: 10000 });
    await sleep(1000);
    
    // ---- Step 2: OCR识别验证码 ----
    let captchaPassed = false;
    
    const imgBase64 = await page.$eval(".img-verifycode", el => el.src);
    const rawBytes = Buffer.from(imgBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
    const captchaPath = path.join(__dirname, "temp_captcha.png");
    let candidates = [];
    
    try {
      fs.writeFileSync(captchaPath, rawBytes);
      candidates = await recognizeCaptchaMulti(captchaPath);
    } finally {
      try { fs.unlinkSync(captchaPath); } catch (e) { /* */ }
    }
    
    if (candidates.length === 0) {
      log("  ✗ OCR未产生候选结果");
      return { found: false, message: "OCR失败", captchaError: true };
    }
    
    const engine = candidates[0]?.source === "ddddocr" ? "ddddocr" : "tesseract";
    log(`  → OCR(${engine}): ${candidates.slice(0, 5).map(c => `"${c.code}"(${c.confidence}%)`).join(", ")}`);
    
    for (let i = 0; i < Math.min(candidates.length, CONFIG.maxCandidatesPerCaptcha); i++) {
      const captcha = candidates[i].code;
      if (i > 0) {
        log(`  → 尝试候选 #${i+1}: "${captcha}"`);
        await page.fill(".code", "");
      }
      
      await page.fill("#key1", CONFIG.examNumber);
      await page.fill("#key2", CONFIG.idLast4);
      await page.fill(".code", captcha);
      
      let navOk = true;
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 }).catch(() => { navOk = false; }),
        page.click(".inquire"),
      ]);
      
      if (!navOk) {
        // 导航超时：可能点击无效或网络问题，检查当前页面状态
        const stillOnForm = await page.$("#key1").catch(() => null);
        if (stillOnForm) {
          log(`  → "${captcha}" 提交后页面未跳转，可能验证码错误`);
          await sleep(CONFIG.candidateDelayMs);
          continue;
        }
        log(`  ⚠ 页面跳转超时，继续尝试解析...`);
      }
      
      // 确认导航完成后再检查（避免读旧页面）
      try { await page.waitForSelector(".tipswz, .enro-result, .kname", { timeout: 10000 }); } catch {}
      
      const errorMsg = await page.$eval(".tipswz", el => el.textContent).catch(() => "");
      const maskVisible = await page.$eval(".mask", el => {
        const style = window.getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden";
      }).catch(() => false);
      
      // 弹窗检测：有错误文字 或 遮罩可见（任一条件即可）
      if (errorMsg || maskVisible) {
        if (errorMsg.includes("验证码")) {
          log(`  → "${captcha}" 错误，尝试下一个...`);
          await page.click(".gbtips").catch(() => {});
          await sleep(CONFIG.candidateDelayMs);
          continue;
        }
        if (errorMsg.includes("操作频繁") || errorMsg.includes("频率")) {
          log(`  ⚠ 触发限流: ${errorMsg}`);
          return { found: false, message: "触发限流", captchaError: true };
        }
        return { found: false, message: errorMsg };
      }
      
      log(`  ✓ 验证码 "${captcha}" 正确！`);
      captchaPassed = true;
      break;
    }
    
    if (!captchaPassed) {
      log("  ✗ 所有候选均错误");
      return { found: false, message: "验证码候选均错误", captchaError: true };
    }
    
    // ---- Step 3: 解析结果 ----
    const html = await page.content();
    const result = parseResultPage(html);
    result.html = html;
    
    // 始终截图并保存HTML内容（Buffer），是否落盘由调用方决定
    if (result.found) {
      result.screenshotBuf = await page.screenshot({ fullPage: true });
      result.htmlContent = html;
    }
    
    return result;
    
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * HTML → 纯文本（去除 script/style/标签/nbsp，合并空白）
 */
function stripHtml(html) {
  return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 解析服务器返回的HTML，判断录取状态
 *
 * @param {string} html - 查询结果页的完整 HTML
 * @returns {{found:boolean, message:string, details?:object, html?:string,
 *           plainText?:string, captchaError?:boolean, unknown?:boolean, fallback?:boolean}}
 *
 * 录取结果表格结构（当有录取信息时，第二个td/th会填充数据）：
 *   <table class="enro-result">
 *     <tr><th>考生状态</th><th class="lqzt">...</th></tr>
 *     <tr><td>院校代号</td><td class="yxdh">...</td></tr>
 *     <tr><td>院校名称</td><td class="yxmc">...</td></tr>
 *     <tr><td>专业组名称</td><td class="zyzmc">...</td></tr>
 *     <tr><td>专业代号</td><td class="zydh">...</td></tr>
 *     <tr><td>专业名称</td><td class="zymc">...</td></tr>
 *     <tr><td>批次名称</td><td class="pcmc">...</td></tr>
 *     <tr><td>科类名称</td><td class="klmc">...</td></tr>
 *     <tr><td>计划性质</td><td class="jhxzmc">...</td></tr>
 *   </table>
 */
function parseResultPage(html) {
  // ---- 错误状态检测（优先级最高） ----
  if (html.includes("验证码不正确") || html.includes("验证码错误") || html.includes("验证码无效")) {
    return { found: false, message: "验证码错误", captchaError: true };
  }
  if (html.includes("操作频繁") || html.includes("稍后再试") || html.includes("频率")) {
    return { found: false, message: "操作频繁，请稍后再试", captchaError: true };
  }
  if (html.includes('id="key1"') && html.includes("请输入")) {
    return { found: false, message: "返回了查询表单", captchaError: true };
  }
  
  // ---- 提取考生基本信息 ----
  const details = {};
  const nameMatch = html.match(/<span class="kname">([^<]+)<\/span>/);
  if (nameMatch) details["姓名"] = nameMatch[1].trim();
  const examMatch = html.match(/<span class="knum">(\d+)<\/span>/);
  if (examMatch) details["准考证号"] = examMatch[1];
  const idMatch = html.match(/<span class="kksh">(\d+)<\/span>/);
  if (idMatch) details["考生号"] = idMatch[1];
  
  // ---- 录取信息提取：CSS class 正则匹配（支持 class 后缀如 lqzt-hover，不受页面其他区域干扰） ----
  if (html.includes("enro-result")) {
    const fieldMap = {
      "lqzt": "考生状态", "yxdh": "院校代号", "yxmc": "院校名称",
      "zyzmc": "专业组名称", "zydh": "专业代号", "zymc": "专业名称",
      "pcmc": "批次名称", "klmc": "科类名称", "jhxzmc": "计划性质",
    };
    let hasAnyData = false;
    for (const [cls, label] of Object.entries(fieldMap)) {
      const regex = new RegExp(`<td class="${cls}[^"]*">([^<]*)<\\/td>|<th class="${cls}[^"]*">([^<]*)<\\/th>`, "i");
      const match = html.match(regex);
      if (match) {
        const value = (match[1] || match[2] || "").trim();
        if (value) { details[label] = value; hasAnyData = true; }
      }
    }
    if (hasAnyData) {
      const plainText = stripHtml(html);
      return { found: true, message: "📋 检测到相关结果", details, plainText: plainText.substring(0, 3000) };
    }
  }
  
  // ---- 表格不存在或无数据时，用关键词判断"暂无录取" ----
  const noResultPatterns = [
    "暂无录取", "暂无信息", "暂无数据", "暂未公布", "暂未录取",
    "当前没有", "没有您的录取", "未查到", "无录取", "无相关",
  ];
  if (noResultPatterns.some(p => html.includes(p))) {
    return { found: false, message: "暂无录取信息" };
  }
  
  // ---- 兜底：页面有关键录取词但CSS class不匹配（网站改版） ----
  const admissionKeywords = ["录取院校", "院校名称", "录取专业", "专业名称", "录取批次", "考生状态"];
  if (admissionKeywords.some(k => html.includes(k))) {
    const plainText = stripHtml(html);
    return { found: true, message: "📋 检测到相关结果（兜底匹配）", details, plainText: plainText.substring(0, 3000), fallback: true };
  }
  
  const snippet = stripHtml(html);
  return { found: false, message: `未知响应: ${snippet.substring(0, 100)}`, unknown: true };
}

// ===================== 主循环 =====================

/**
 * 主函数：启动浏览器，进入轮询循环，ddddocr 自动识别验证码
 *   - ddddocr 不可用时自动懒加载 tesseract.js 备选
 *   - 首次查询成功后发送测试邮件（验证 SMTP + 查询 + 考生信息）
 *   - 录取后桌面弹窗3次(间隔10分钟)，30分钟后自动退出
 */
async function main() {
  console.clear();
  log("=".repeat(55));
  log("  江西省高考录取结果自动查询工具");
  log("=".repeat(55));
  log(`  准考证号: ${CONFIG.examNumber}`);
  log(`  证件后4位: ${CONFIG.idLast4}`);
  log(`  浏览器: ${CONFIG.headless ? "后台静默" : "可见窗口"}`);
  log(`  查询间隔: ${CONFIG.checkIntervalMinutes === 0 ? "仅一次" : CONFIG.checkIntervalMinutes + " 分钟"}`);
  log(`  邮件通知: ${CONFIG.smtp.enabled ? "已启用 → " + CONFIG.smtp.to : "未启用"}`);
  log("=".repeat(55));
  
  // 初始化邮件（如果启用）
  initMailer();

  // 启动浏览器：Chrome → Edge → 内置 Chromium 逐级回退
  log("  正在启动浏览器...");
  const { execSync } = require("child_process");
  let launchOptions = {
    headless: CONFIG.headless,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
    ],
  };

  // 检测可用浏览器（仅 Windows 尝试系统浏览器，其他平台直接用内置 Chromium）
  if (process.platform === "win32") {
    try { execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe"', { stdio: "ignore" }); launchOptions.channel = "chrome"; log("  浏览器: Google Chrome"); } catch {
    try { execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe"', { stdio: "ignore" }); launchOptions.channel = "msedge"; log("  浏览器: Microsoft Edge"); } catch {
    log("  浏览器: Playwright 内置 Chromium"); }}
  } else {
    log("  浏览器: Playwright 内置 Chromium");
  }
  
  let browser = await chromium.launch(launchOptions);
  
  let context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });
  log("  浏览器就绪");
  
  // 恢复之前的会话cookie
  const savedCookies = loadCookies();
  if (savedCookies) {
    await context.addCookies(savedCookies);
    log("  已恢复上次会话");
  }
  
  let attemptNumber = 0;
  let queriesSinceRestart = 0;
  const RESTART_INTERVAL = CONFIG.browserRestartQueries;
  const RESTART_INTERVAL_MS = CONFIG.browserRestartHours * 3600 * 1000;
  let lastRestartTime = Date.now();
  let consecutiveFailures = 0;
  const FAILURE_ALERT_THRESHOLD = CONFIG.failureAlertThreshold;
  let lastAdmissionStatus = null;  // 追踪上一次的考生状态，用于检测变化
  
  // 危险状态（退档相关、自由可投等）——匹配子串
  const DANGER_KEYWORDS = ["退档", "自由可投", "未录取", "不予录取"];
  // 最终录取：包含"录取"但不含"预""拟""退""未""不"（排除预录取、拟录取、退档等）
  function isFinalStatus(status) {
    return status.includes("录取")
      && !status.includes("预")
      && !status.includes("拟")
      && !status.includes("退")
      && !status.includes("未")
      && !status.includes("不")
      && !status.includes("审");  // 排除"录取待审"等中间状态
  }
  
  /**
   * 重启浏览器（释放 Chromium 长期运行积累的内存）
   */
  async function restartBrowser() {
    log("├─ 🔄 重启浏览器释放内存...");
    // 重置 ddddocr 可用性检测，给它一次恢复机会（可能只是临时故障）
    if (ddddocrAvailable === false) {
      ddddocrAvailable = null;
      log("├─ 🔄 重新检测 ddddocr...");
    }
    // 保存当前 cookie 再关闭旧浏览器
    try { saveCookies(await context.cookies()); } catch (e) { /* */ }
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    
    const newBrowser = await chromium.launch(launchOptions).catch(err => {
      log(`├─ ❌ 浏览器重启失败: ${err.message}`);
      return null;
    });
    if (!newBrowser) {
      log("└─ 无法重启浏览器，程序退出");
      process.exit(1);
    }
    const newContext = await newBrowser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });
    // 恢复 cookie
    const cookies = loadCookies();
    if (cookies) await newContext.addCookies(cookies);
    
    // 更新外部引用（通过修改闭包变量，然后 main 中用新引用）
    return { browser: newBrowser, context: newContext };
  }
  
  try {
    while (true) {
      attemptNumber++;
      log(`\n┌─ 第 ${attemptNumber} 次查询 ${"─".repeat(30)}`);
      
      let querySuccess = false;
      let finalResult = null;
      
      for (let retry = 0; retry < CONFIG.maxCaptchaRefetches; retry++) {
        if (retry > 0) {
          log(`├─ 重新获取验证码 (${retry}/${CONFIG.maxCaptchaRefetches})...`);
          await sleep(CONFIG.captchaRefetchDelayMs);
        }
        
        try {
          const result = await executeQuery(context);
          
          if (result.captchaError) {
            continue; // 重试
          }
          
          if (result.inputError) {
            log(`├─ ❌ ${result.message}`);
            log("└─ 请检查准考证号和证件后4位！程序退出。");
            process.exit(1);
          }
          
          querySuccess = true;
          finalResult = result;
          break;
        } catch (err) {
          log(`├─ 错误: ${err.message}`);
        }
      }
      
      // 保存cookie
      try {
        const cookies = await context.cookies();
        saveCookies(cookies);
      } catch (e) {
        // 浏览器已关闭等情况下忽略
      }
      
      if (!querySuccess || !finalResult) {
        log("├─ 所有尝试均失败");
        consecutiveFailures++;
        // 连续多次失败：发送告警通知
        if (consecutiveFailures === FAILURE_ALERT_THRESHOLD && CONFIG.smtp.enabled) {
          log("├─ ⚠️ 连续6次查询失败，发送告警邮件...");
          if (!mailTransporter) initMailer();
          try {
            await mailTransporter.sendMail({
              from: CONFIG.smtp.from,
              to: CONFIG.smtp.to,
              subject: "⚠️ 录取查询工具 — 服务异常告警",
              html: `<p>连续 ${FAILURE_ALERT_THRESHOLD} 次查询均失败，可能网络异常或验证码识别故障。</p><p>请检查运行日志。</p><p style="color:#999">${timestamp()}</p>`,
            });
            log("├─ 告警邮件已发送");
          } catch (e) { log(`├─ 告警邮件发送失败: ${e.message}`); }
        }
      } else if (finalResult.found) {
        consecutiveFailures = 0;
        const currentStatus = finalResult.details?.["考生状态"] || "";
        const statusChanged = lastAdmissionStatus && lastAdmissionStatus !== currentStatus;
        const isDanger = DANGER_KEYWORDS.some(s => currentStatus.includes(s));
        const isFinal = isFinalStatus(currentStatus);
        
        // 根据实际状态覆盖结果消息
        if (isFinal) {
          finalResult.message = "🎉 正式录取！";
        } else if (isDanger) {
          finalResult.message = `⚠️ 危险状态：${currentStatus}`;
        } else {
          finalResult.message = `📋 当前状态：${currentStatus}`;
        }
        
        // 状态变化或首次检测：写入截图/HTML到磁盘，发邮件
        const statusChangedOrNew = !lastAdmissionStatus || statusChanged;
        let screenshotPath = null;
        if (statusChangedOrNew && finalResult.screenshotBuf) {
          const ts = timestamp().replace(/[/:]/g, "-").replace(/\s/g, "_");
          screenshotPath = path.join(RESULT_DIR, `admission_${ts}.png`);
          const htmlPath = path.join(RESULT_DIR, `admission_${ts}.html`);
          fs.writeFileSync(screenshotPath, finalResult.screenshotBuf);
          fs.writeFileSync(htmlPath, finalResult.htmlContent);
          log(`├─ 截图: ${screenshotPath}`);
        }
        
        // ---- 横幅 + 详情 + 通知 ----
        if (!lastAdmissionStatus) {
          // 首次出现数据
          log("├─ ╔══════════════════════════════════════╗");
          log(`├─ ║  ${finalResult.message}${" ".repeat(Math.max(0, 34 - finalResult.message.length))}║`);
          log("├─ ╚══════════════════════════════════════╝");
          if (isFinal) {
            // 首次查到就是录取 → 直接走最终通知
            log("├─");
            await sendEmailNotification(finalResult.details, screenshotPath);
            const school = finalResult.details?.["院校名称"] || "";
            sendDesktopNotification("🎉 高考录取结果已出！", school ? `你已被 ${school} 录取！` : "请查看录取详情");
            log("├─ 💬 将在 10/20/30 分钟后各弹窗提醒一次，按 Ctrl+C 可随时退出");
            for (let i = 1; i <= 3; i++) {
              sendDesktopNotification("🎉 高考录取结果已出！", `第 ${i}/3 次提醒 — 请查看 results/ 目录下的截图和邮件`);
              await sleep(10 * 60 * 1000);
              log(`[${timestamp()}] 💬 第 ${i}/3 次弹窗提醒`);
            }
            log("└─ 提醒结束，程序退出");
            lastAdmissionStatus = currentStatus;
            break;
          }
          log("├─");
          log("├─ 程序将持续监测状态变化，正式录取时停止");
          for (const [key, value] of Object.entries(finalResult.details)) {
            if (key !== "考生状态") log(`├─   ${key}: ${value}`);
          }
          sendDesktopNotification(isDanger ? "⚠️ 检测到危险状态" : "📋 检测到投档信息", `当前状态: ${currentStatus}`);
          if (CONFIG.smtp.enabled) {
            await sendStatusChangeEmail(null, currentStatus, finalResult.details, screenshotPath);
          }
        } else if (statusChanged) {
          // 状态发生变化
          log("├─ ╔══════════════════════════════════════╗");
          log(`├─ ║  🔄 ${finalResult.message}${" ".repeat(Math.max(0, 32 - finalResult.message.length))}║`);
          log("├─ ╚══════════════════════════════════════╝");
          log(`├─ 上次状态: ${lastAdmissionStatus}`);
          for (const [key, value] of Object.entries(finalResult.details)) {
            if (key !== "考生状态") log(`├─   ${key}: ${value}`);
          }
          if (isFinal) {
            // 变为录取 → 最终通知
            log("├─");
            await sendEmailNotification(finalResult.details, screenshotPath);
            const school = finalResult.details?.["院校名称"] || "";
            sendDesktopNotification("🎉 高考录取结果已出！", school ? `你已被 ${school} 录取！` : "请查看录取详情");
            log("├─ 💬 将在 10/20/30 分钟后各弹窗提醒一次，按 Ctrl+C 可随时退出");
            for (let i = 1; i <= 3; i++) {
              sendDesktopNotification("🎉 高考录取结果已出！", `第 ${i}/3 次提醒 — 请查看 results/ 目录下的截图和邮件`);
              await sleep(10 * 60 * 1000);
              log(`[${timestamp()}] 💬 第 ${i}/3 次弹窗提醒`);
            }
            log("└─ 提醒结束，程序退出");
            lastAdmissionStatus = currentStatus;
            break;
          }
          sendDesktopNotification(isDanger ? "⚠️ 录取状态警告" : "🔄 录取状态更新", `${lastAdmissionStatus} → ${currentStatus}`);
          if (CONFIG.smtp.enabled) {
            await sendStatusChangeEmail(lastAdmissionStatus, currentStatus, finalResult.details, screenshotPath, isDanger);
          }
        } else {
          // 状态未变
          if (finalResult.html) {
            const nameMatch = finalResult.html.match(/<span class="kname">([^<]+)<\/span>/);
            if (nameMatch) log(`├─ 考生: ${nameMatch[1].trim()}`);
          }
        }
        
        lastAdmissionStatus = currentStatus;
        log(`├─ 结果: ${finalResult.message}`);
        consecutiveFailures = 0;
      } else {
        // 查询成功但暂无录取 — 也重置失败计数
        consecutiveFailures = 0;
      }
      
      // 首次查询成功后发送测试邮件（验证SMTP+查询功能+考生信息）
      // 如果已经查到录取结果，录取通知邮件本身已有验证作用，跳过测试邮件
      if (querySuccess && finalResult && !finalResult.found && attemptNumber === 1) {
        log("├─");
        await sendTestEmail(finalResult);
      }
      
      // 长期运行：每50次或6小时自动重启浏览器释放内存
      queriesSinceRestart++;
      if (queriesSinceRestart >= RESTART_INTERVAL || (Date.now() - lastRestartTime) >= RESTART_INTERVAL_MS) {
        const newRefs = await restartBrowser();
        browser = newRefs.browser;
        context = newRefs.context;
        queriesSinceRestart = 0;
        lastRestartTime = Date.now();
      }
      
      // 单次模式
      if (CONFIG.checkIntervalMinutes === 0) {
        log("└─ 单次查询完成");
        break;
      }
      
      // 等待
      const waitMs = CONFIG.checkIntervalMinutes * 60 * 1000;
      const nextTime = new Date(Date.now() + waitMs).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
      log(`├─ 下次: ${nextTime} (${CONFIG.checkIntervalMinutes}分钟后)`);
      log(`└─ 等待中... (Ctrl+C 退出)`);
      await sleep(waitMs);
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

// 退出处理 - 同时清理可能残留的临时文件
function cleanup() {
  const tmp = path.join(__dirname, "temp_captcha.png");
  try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e) { /* */ }
  // 终止 tesseract worker
  if (ocrWorker) {
    try { ocrWorker.terminate(); } catch (e) { /* */ }
  }
}

process.on("SIGINT", () => {
  cleanup();
  log("\n程序已退出");
  process.exit(0);
});

process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

process.on("exit", () => cleanup());

// 未处理的 Promise 拒绝兜底
process.on("unhandledRejection", (reason) => {
  log(`⚠ 未捕获的异步错误: ${reason?.message || reason}`);
  // 不退出，仅记录日志，保持程序继续运行
});

main().catch(err => {
  log(`程序异常: ${err.message}`);
  console.error(err);
  process.exit(1);
});
