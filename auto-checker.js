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
 * OCR方案: ddddocr (Python, 主力) + tesseract.js (Node, 备选)
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

// 解析命令行参数
for (const arg of process.argv.slice(2)) {
  if (arg === "--once") CONFIG.checkIntervalMinutes = 0;
  else if (arg.startsWith("--interval=")) CONFIG.checkIntervalMinutes = parseInt(arg.split("=")[1]) || 10;
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

// ===================== 工具函数 =====================

function timestamp() {
  return new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function log(message) {
  const line = `[${timestamp()}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
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

function smtpConfigFingerprint() {
  // 用关键字段生成指纹，配置变了就重新测试
  const key = `${CONFIG.smtp.host}|${CONFIG.smtp.auth.user}|${CONFIG.smtp.to}`;
  return require("crypto").createHash("md5").update(key).digest("hex");
}

function markEmailTested() {
  fs.writeFileSync(EMAIL_TESTED_FILE, smtpConfigFingerprint());
}

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
      table.info { width: 100%; border-collapse: collapse; }
      table.info td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
      table.info td:first-child { color: #888; width: 90px; white-space: nowrap; }
      table.info td:last-child { color: #333; font-weight: 600; }
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
  
  const nameMatch = queryResult.html ? queryResult.html.match(/<span class="kname">([^<]+)<\/span>/) : null; // 见 extractStudentName()
  const studentName = nameMatch ? nameMatch[1].trim() : "未知";
  const statusText = queryResult.found ? "已录取" : (queryResult.message || "查询成功");
  
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
  
  try {
    const info = await mailTransporter.sendMail({
      from: CONFIG.smtp.from,
      to: CONFIG.smtp.to,
      subject: `✅ 录取查询工具 — 配置验证 (${studentName} ${statusText})`,
      html: htmlBody,
    });
    log(`  ✅ 测试邮件已发送: ${info.messageId}`);
    markEmailTested();
  } catch (err) {
    log(`  ⚠️ 测试邮件发送失败: ${err.message}`);
    log(`  ⚠️ 请检查 config.json 中的 SMTP 配置`);
    log(`  ⚠️ 程序将继续运行，录取时邮件通知可能无法送达`);
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
  
  const school = details?.["院校名称"] || "";
  const major = details?.["专业名称"] || "";
  
  // 构建录取详情表格行
  let detailRows = "";
  if (details && Object.keys(details).length > 0) {
    for (const [key, value] of Object.entries(details)) {
      if (key === "姓名" || key === "准考证号" || key === "考生号") continue; // 基本信息已在标题区
      detailRows += `<tr><td>${key}</td><td>${value}</td></tr>`;
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
          <tr><td>姓名</td><td>${details?.["姓名"] || ""}</td></tr>
          <tr><td>准考证号</td><td>${details?.["准考证号"] || CONFIG.examNumber}</td></tr>
          <tr><td>考生号</td><td>${details?.["考生号"] || ""}</td></tr>
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
    log(`  📧 邮件发送失败: ${err.message}`);
    return false;
  }
}

// ===================== Cookie 持久化 =====================

/** 保存浏览器Cookie到文件，下次启动恢复 */
function saveCookies(cookies) {
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
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
  // 跨平台检测：Windows 用 py→python 回退，其他平台 python3→python 回退
  if (process.platform === "win32") {
    try { require("child_process").execSync("py --version", { stdio: "ignore" }); return "py"; } catch {}
    try { require("child_process").execSync("python --version", { stdio: "ignore" }); return "python"; } catch {}
    return "py"; // 最后尝试
  }
  try { require("child_process").execSync("python3 --version", { stdio: "ignore" }); return "python3"; } catch {}
  try { require("child_process").execSync("python --version", { stdio: "ignore" }); return "python"; } catch {}
  return "python3";
})();
let ocrWorker = null;
let ddddocrAvailable = null;  // null=未检测, true=可用, false=不可用

/**
 * 调用 ddddocr（Python）识别验证码，返回结果或 null
 */
function ocrViaDdddocr(imagePath) {
  if (ddddocrAvailable === false) return null;
  
  // 最多重试3次（应对 Python 偶尔超时等瞬时故障）
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
      if (attempt === 2) {
        if (ddddocrAvailable === null) {
          log("  ⚠ ddddocr 不可用，回退到 tesseract.js");
          ddddocrAvailable = false;
        }
        return null;
      }
    }
  }
  return null;
}

async function loadOCR() {
  // 初始化tesseract.js作为备选（ddddocr不可用时回退）
  log("  正在加载 OCR 引擎（首次需下载语言包，约15MB，请耐心等待）...");
  const { createWorker } = require("tesseract.js");
  ocrWorker = await createWorker("eng", 1, {
    logger: m => {
      if (m.status === "downloading") {
        // 显示下载进度
        const pct = m.progress ? Math.round(m.progress * 100) : 0;
        if (pct > 0 && pct % 20 === 0) log(`  下载中... ${pct}%`);
      }
    },
  });
  log("  OCR 引擎就绪 (ddddocr + tesseract)");
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
  const metadata = await sharp(originalBuf).metadata();
  const W = metadata.width, H = metadata.height;
  
  const seen = new Set();
  const candidates = [];
  
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
 *           screenshot?:string, captchaError?:boolean, inputError?:boolean}>}
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
      
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 }).catch(() => {}),
        page.click(".inquire"),
      ]);
      
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
    
    // 仅在查到录取结果时保存截图到 results/
    if (result.found) {
      const timeStr = timestamp().replace(/[/:]/g, "-").replace(/\s/g, "_");
      const ssPath = path.join(RESULT_DIR, `admission_${timeStr}.png`);
      await page.screenshot({ path: ssPath, fullPage: true });
      result.screenshot = ssPath;
      const htmlPath = path.join(RESULT_DIR, `admission_${timeStr}.html`);
      fs.writeFileSync(htmlPath, html);
      result.htmlPath = htmlPath;
    }
    
    return result;
    
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * 解析服务器返回的HTML，判断录取状态
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
  // 无录取信息
  if (html.includes("暂无录取信息") || html.includes("暂无录取") || html.includes("暂无信息")) {
    return { found: false, message: "暂无录取信息" };
  }
  
  // 验证码错误 (服务器端返回)
  if (html.includes("验证码不正确") || html.includes("验证码错误") || html.includes("验证码无效")) {
    return { found: false, message: "验证码错误", captchaError: true };
  }
  
  // 操作频繁/限流
  if (html.includes("操作频繁") || html.includes("稍后再试") || html.includes("频率")) {
    return { found: false, message: "操作频繁，请稍后再试", captchaError: true };
  }
  
  // 表单页（验证码错误回显，无录取表格）
  if (html.includes('id="key1"') && html.includes("请输入")) {
    return { found: false, message: "返回了查询表单", captchaError: true };
  }
  
  // 检查录取信息：用CSS class精确定位
  const hasAdmissionTable = html.includes("enro-result");
  if (!hasAdmissionTable) {
    const snippet = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 200);
    return { found: false, message: `未知响应: ${snippet.substring(0, 100)}`, unknown: true };
  }
  
  // 提取考生基本信息
  const details = {};
  const nameMatch = html.match(/<span class="kname">([^<]+)<\/span>/);
  if (nameMatch) details["姓名"] = nameMatch[1].trim();
  
  const examMatch = html.match(/<span class="knum">(\d+)<\/span>/);
  if (examMatch) details["准考证号"] = examMatch[1];
  
  const idMatch = html.match(/<span class="kksh">(\d+)<\/span>/);
  if (idMatch) details["考生号"] = idMatch[1];
  
  // 用CSS class精确定位录取表格数据（完整9个字段）
  const fieldMap = {
    "lqzt":   "考生状态",
    "yxdh":   "院校代号",
    "yxmc":   "院校名称",
    "zyzmc":  "专业组名称",
    "zydh":   "专业代号",
    "zymc":   "专业名称",
    "pcmc":   "批次名称",
    "klmc":   "科类名称",
    "jhxzmc": "计划性质",
  };
  
  let hasAnyData = false;
  for (const [cls, label] of Object.entries(fieldMap)) {
    const regex = new RegExp(`<td class="${cls}[^"]*">([^<]*)<\\/td>|<th class="${cls}[^"]*">([^<]*)<\\/th>`, "i");
    const match = html.match(regex);
    if (match) {
      const value = (match[1] || match[2] || "").trim();
      if (value) {
        details[label] = value;
        hasAnyData = true;
      }
    }
  }
  
  if (!hasAnyData) {
    return { found: false, message: "暂无录取信息" };
  }
  
  const plainText = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  
  return { found: true, message: "🎉 检测到录取信息！", details, plainText: plainText.substring(0, 3000) };
}

// ===================== 主循环 =====================

/**
 * 主函数：启动浏览器，进入轮询循环，全程ddddocr自动识别
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
  
  // 初始化OCR（无论哪种模式，后续轮询都需要）
  await loadOCR();
  
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
  
  const browser = await chromium.launch(launchOptions);
  
  const context = await browser.newContext({
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
      const cookies = await context.cookies();
      saveCookies(cookies);
      
      if (!querySuccess || !finalResult) {
        log("├─ 所有尝试均失败");
      } else if (finalResult.found) {
        // ===== 🎉 找到录取信息！=====
        log("├─ ╔══════════════════════════════════════╗");
        log("├─ ║  🎉🎉  检 测 到 录 取 信 息 ！ 🎉🎉  ║");
        log("├─ ╚══════════════════════════════════════╝");
        
        if (finalResult.details && Object.keys(finalResult.details).length > 0) {
          log("├─");
          log("├─ 录取详情:");
          for (const [key, value] of Object.entries(finalResult.details)) {
            log(`├─   ${key}: ${value}`);
          }
        }
        
        if (finalResult.plainText) {
          log("├─");
          for (const line of finalResult.plainText.split(/[。\n]/).slice(0, 15)) {
            if (line.trim()) log(`├─   ${line.trim()}`);
          }
        }
        
        if (finalResult.screenshot) log(`├─ 截图: ${finalResult.screenshot}`);
        if (finalResult.htmlPath) log(`├─ HTML: ${finalResult.htmlPath}`);
        
        // 发送邮件通知
        log("├─");
        await sendEmailNotification(finalResult.details, finalResult.screenshot);
        
        // 桌面弹窗
        const school = finalResult.details?.["院校名称"] || "";
        sendDesktopNotification(
          "🎉 高考录取结果已出！",
          school ? `你已被 ${school} 录取！请查看详情` : "请查看录取详情"
        );
        
        log("├─");
        log("└─ 💬 将在 10/20/30 分钟后各弹窗提醒一次，按 Ctrl+C 可随时退出");
        
        for (let i = 1; i <= 3; i++) {
          sendDesktopNotification("🎉 高考录取结果已出！", `第 ${i}/3 次提醒 — 请查看 results/ 目录下的截图和邮件`);
          await sleep(10 * 60 * 1000);
          log(`[${timestamp()}] 💬 第 ${i}/3 次弹窗提醒`);
        }
        
        log("└─ 提醒结束，程序退出");
      } else {
        log(`├─ 结果: ${finalResult.message}`);
        
        // 显示考生姓名确认
        if (finalResult.html) {
          const nameMatch = finalResult.html.match(/<span class="kname">([^<]+)<\/span>/);
          if (nameMatch) log(`├─ 考生: ${nameMatch[1].trim()}`);
        }
      }
      
      // 首次查询成功后发送测试邮件（验证SMTP+查询功能+考生信息）
      // 如果已经查到录取结果，录取通知邮件本身已有验证作用，跳过测试邮件
      if (querySuccess && finalResult && !finalResult.found && attemptNumber === 1) {
        log("├─");
        await sendTestEmail(finalResult);
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

main().catch(err => {
  log(`程序异常: ${err.message}`);
  console.error(err);
  process.exit(1);
});
