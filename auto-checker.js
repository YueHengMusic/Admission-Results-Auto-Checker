/**
 * 江西省高考录取结果自动查询工具 v2
 * 
 * 网站: https://jxcf.jxeea.cn/
 * 
 * 使用方法:
 *   node auto-checker.js                     # 自动模式 (OCR识别验证码)
 *   node auto-checker.js --headed            # 手动模式 (浏览器可见，用户手动输入验证码)
 *   node auto-checker.js --once              # 只查询一次
 *   node auto-checker.js --interval=5        # 每5分钟查询一次
 *   node auto-checker.js --headed --once     # 手动输入验证码，查询一次
 *   node auto-checker.js --email-on          # 启用邮件通知（需先配置SMTP）
 *   node auto-checker.js --email-to=me@qq.com # 指定收件人
 *   node auto-checker.js --no-email          # 禁用邮件通知
 * 
 * 自动模式: 使用tesseract.js OCR识别验证码（准确率有限，会多次重试）
 * 手动模式: 打开可见浏览器，用户手动输入验证码后，工具接管后续流程
 */

const { chromium } = require("playwright");
const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

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
    maxCaptchaRefetches: 3,
    maxCandidatesPerCaptcha: 3,
    candidateDelayMs: 4000,
    captchaRefetchDelayMs: 6000,
    headless: true,
    manualCaptcha: false,
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
  else if (arg === "--headed") CONFIG.manualCaptcha = true;
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

function playAlert() {
  try {
    for (let i = 0; i < 10; i++) {
      exec("powershell -c \"[System.Console]::Beep(800,400); Start-Sleep -Milliseconds 100\"");
    }
  } catch (e) { /* */ }
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

async function sendTestEmail() {
  if (!CONFIG.smtp.enabled) return;
  
  if (isEmailAlreadyTested()) {
    log("  📧 邮件配置未变更，跳过测试");
    return;
  }
  
  if (!mailTransporter) initMailer();
  
  log("  📧 首次使用此邮件配置，正在发送测试邮件...");
  
  try {
    const info = await mailTransporter.sendMail({
      from: CONFIG.smtp.from,
      to: CONFIG.smtp.to,
      subject: "✅ 录取查询工具 — 邮件通知测试",
      html: `
        <h2>✅ 邮件配置测试成功</h2>
        <p>如果你收到这封邮件，说明 SMTP 配置正确，录取结果出来时会自动通知你。</p>
        <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse; font-size:14px; margin-top:16px;">
          <tr><td><b>SMTP 服务器</b></td><td>${CONFIG.smtp.host}:${CONFIG.smtp.port}</td></tr>
          <tr><td><b>发件人</b></td><td>${CONFIG.smtp.from}</td></tr>
          <tr><td><b>收件人</b></td><td>${CONFIG.smtp.to}</td></tr>
          <tr><td><b>查询准考证号</b></td><td>${CONFIG.examNumber}</td></tr>
        </table>
        <p style="color:#999; margin-top:20px;">此邮件由录取结果自动查询工具发送 — ${timestamp()}</p>
      `,
    });
    log(`  ✅ 测试邮件已发送: ${info.messageId}`);
    markEmailTested();
  } catch (err) {
    log(`  ⚠️ 测试邮件发送失败: ${err.message}`);
    log(`  ⚠️ 请检查 config.json 中的 SMTP 配置（host/port/user/pass 是否正确？授权码不是登录密码！）`);
    log(`  ⚠️ 程序将继续运行，录取时邮件通知可能无法送达`);
  }
}

async function sendEmailNotification(details, screenshotPath) {
  if (!CONFIG.smtp.enabled) {
    log("  📧 邮件通知未启用，跳过");
    return;
  }
  if (!mailTransporter) initMailer();
  
  // 构建邮件正文
  let htmlBody = `
    <h2>🎉 高考录取结果已出！</h2>
    <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse; font-size:14px;">
  `;
  
  if (details && Object.keys(details).length > 0) {
    for (const [key, value] of Object.entries(details)) {
      htmlBody += `<tr><td><b>${key}</b></td><td>${value}</td></tr>`;
    }
  }
  
  htmlBody += `
    </table>
    <p style="color:#999; margin-top:20px;">
      此邮件由录取结果自动查询工具发送<br>
      发送时间：${timestamp()}
    </p>
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
      subject: "🎉 高考录取结果已出！",
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

function saveCookies(cookies) {
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
  log("  → 会话已保存");
}

function loadCookies() {
  try {
    if (fs.existsSync(COOKIE_FILE)) {
      return JSON.parse(fs.readFileSync(COOKIE_FILE, "utf8"));
    }
  } catch (e) { /* */ }
  return null;
}

// ===================== OCR (仅自动模式) =====================

let ocrWorker = null;

async function loadOCR() {
  if (CONFIG.manualCaptcha) return; // 手动模式不需要OCR
  const { createWorker } = require("tesseract.js");
  ocrWorker = await createWorker("eng", 1, { logger: m => {} });
  log("  OCR 引擎就绪");
}

async function recognizeCaptchaMulti(imagePath) {
  const sharp = require("sharp");
  const worker = ocrWorker;
  const originalBuf = fs.readFileSync(imagePath);
  const metadata = await sharp(originalBuf).metadata();
  const W = metadata.width, H = metadata.height;
  
  const seen = new Set();
  const candidates = [];
  
  function add(code, conf) {
    // 验证码是4位纯数字，只接受3-4位结果
    if (!seen.has(code) && code.length >= 3 && code.length <= 4) {
      seen.add(code);
      candidates.push({ code, confidence: conf });
    }
  }
  
  // 多种预处理策略
  for (const scale of [4, 6, 8]) {
    const buf = await sharp(originalBuf).resize(W * scale, H * scale, { kernel: "nearest" }).png().toBuffer();
    for (const psm of ["7", "8", "6"]) {
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789",
        tessedit_pageseg_mode: psm,
      });
      const { data } = await worker.recognize(buf);
      add(data.text.replace(/[^0-9]/g, ""), data.confidence);
    }
  }
  
  for (const thresh of [100, 110, 120, 130, 140, 150]) {
    const buf = await sharp(originalBuf).resize(W * 6, H * 6, { kernel: "nearest" }).grayscale().threshold(thresh).png().toBuffer();
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789",
      tessedit_pageseg_mode: "7",
    });
    const { data } = await worker.recognize(buf);
    add(data.text.replace(/[^0-9]/g, ""), data.confidence);
  }
  
  for (const psm of ["7", "8"]) {
    const buf = await sharp(originalBuf).resize(W * 6, H * 6, { kernel: "nearest" }).grayscale().normalize().png().toBuffer();
    await worker.setParameters({ tessedit_char_whitelist: "0123456789", tessedit_pageseg_mode: psm });
    const { data } = await worker.recognize(buf);
    add(data.text.replace(/[^0-9]/g, ""), data.confidence);
  }
  
  candidates.sort((a, b) => {
    const score = (c) => (c.code.length === 4 ? 100 : 0) + c.confidence;
    return score(b) - score(a);
  });
  
  return candidates;
}

// ===================== 核心查询逻辑 =====================

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
    
    // ---- Step 2: 获取验证码 ----
    let captchaAttempts = [];
    
    if (CONFIG.manualCaptcha) {
      // 手动模式：等待用户输入验证码
      log("  ┌─────────────────────────────────────┐");
      log("  │  🔔 请在浏览器中输入验证码并点击查询  │");
      log("  │  等待中... (超时120秒)              │");
      log("  └─────────────────────────────────────┘");
      
      // 等待用户手动操作 - 监控页面变化
      // 预填准考证号和证件号，方便用户
      await page.fill("#key1", CONFIG.examNumber);
      await page.fill("#key2", CONFIG.idLast4);
      
      // 等待用户点击查询后页面跳转或出现弹窗
      const startTime = Date.now();
      let userDone = false;
      
      while (Date.now() - startTime < 120000 && !userDone) { // 2分钟超时
        // 检查是否有弹窗
        const errorMsg = await page.$eval(".tipswz", el => el.textContent).catch(() => "");
        const maskVisible = await page.$eval(".mask", el => {
          const style = window.getComputedStyle(el);
          return style.display !== "none";
        }).catch(() => false);
        
        // 检查是否已经跳转到结果页
        const pageTitle = await page.title().catch(() => "");
        
        if (errorMsg && maskVisible) {
          if (errorMsg.includes("验证码")) {
            log("  → 验证码错误，请重新输入...");
            await page.click(".gbtips").catch(() => {});
            await sleep(500);
            continue;
          }
          if (errorMsg.includes("考生号") || errorMsg.includes("证件")) {
            log(`  ✗ 输入错误: ${errorMsg}`);
            return { found: false, message: errorMsg, inputError: true };
          }
        }
        
        if (pageTitle.includes("结果") || pageTitle.includes("查询结果")) {
          userDone = true;
          break;
        }
        
        await sleep(1000);
      }
      
      if (!userDone) {
        log("  ✗ 等待超时，用户未完成操作");
        return { found: false, message: "用户操作超时" };
      }
      
      log("  → 用户操作完成，正在分析结果...");
      await sleep(2000);
      
    } else {
      // 自动模式：OCR识别验证码
      const imgBase64 = await page.$eval(".img-verifycode", el => el.src);
      const rawBytes = Buffer.from(imgBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
      const captchaPath = path.join(__dirname, "temp_captcha.png");
      let candidates = [];
      
      try {
        fs.writeFileSync(captchaPath, rawBytes);
        candidates = await recognizeCaptchaMulti(captchaPath);
      } finally {
        // 无论OCR成功还是抛异常，都删掉临时验证码图片
        try { fs.unlinkSync(captchaPath); } catch (e) { /* */ }
      }
      
      if (candidates.length === 0) {
        log("  ✗ OCR未产生候选结果");
        return { found: false, message: "OCR失败", captchaError: true };
      }
      
      log(`  → OCR候选(${candidates.length}): ${candidates.slice(0, 5).map(c => `"${c.code}"(${c.confidence}%)`).join(", ")}`);
      
      // 尝试每个候选
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
        await sleep(2000);
        
        const errorMsg = await page.$eval(".tipswz", el => el.textContent).catch(() => "");
        const maskVisible = await page.$eval(".mask", el => {
          const style = window.getComputedStyle(el);
          return style.display !== "none";
        }).catch(() => false);
        
        if (errorMsg && maskVisible) {
          if (errorMsg.includes("验证码")) {
            log(`  → "${captcha}" 错误，尝试下一个...`);
            await page.click(".gbtips").catch(() => {});
            await sleep(CONFIG.candidateDelayMs);  // 延迟，避免限流
            continue;
          }
          if (errorMsg.includes("操作频繁") || errorMsg.includes("频率")) {
            log(`  ⚠ 触发限流: ${errorMsg}`);
            return { found: false, message: "触发限流", captchaError: true };
          }
          return { found: false, message: errorMsg };
        }
        
        // 成功！
        log(`  ✓ 验证码 "${captcha}" 正确！`);
        captchaAttempts = [{ code: captcha, correct: true }];
        break;
      }
      
      if (captchaAttempts.length === 0) {
        log("  ✗ 所有候选均错误");
        return { found: false, message: "验证码候选均错误", captchaError: true };
      }
    }
    
    // ---- Step 3: 解析结果 ----
    const html = await page.content();
    const result = parseResultPage(html);
    result.html = html;
    
    // ---- Step 4: 保存截图 ----
    const timeStr = timestamp().replace(/[/:]/g, "-").replace(/\s/g, "_");
    
    if (result.found) {
      const ssPath = path.join(RESULT_DIR, `admission_${timeStr}.png`);
      await page.screenshot({ path: ssPath, fullPage: true });
      result.screenshot = ssPath;
      const htmlPath = path.join(RESULT_DIR, `admission_${timeStr}.html`);
      fs.writeFileSync(htmlPath, html);
      result.htmlPath = htmlPath;
    }
    
    // 保存当前截图用于调试
    const debugPath = path.join(RESULT_DIR, `latest_${timeStr}.png`);
    await page.screenshot({ path: debugPath, fullPage: true });
    
    return result;
    
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * 解析查询结果
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
  
  // 检查录取信息
  const hasAdmissionTable = html.includes("院校名称") || html.includes("专业名称") || html.includes("录取院校");
  const stillNoResult = html.includes("暂无录取");
  
  if (hasAdmissionTable && !stillNoResult) {
    const details = {};
    
    const nameMatch = html.match(/<span class="kname">([^<]+)<\/span>/);
    if (nameMatch) details["姓名"] = nameMatch[1].trim();
    
    const examMatch = html.match(/<span class="knum">(\d+)<\/span>/);
    if (examMatch) details["准考证号"] = examMatch[1];
    
    const idMatch = html.match(/<span class="kksh">(\d+)<\/span>/);
    if (idMatch) details["考生号"] = idMatch[1];
    
    // 提取录取表格数据
    const tdRegex = /<td[^>]*>([^<]+)<\/td>/g;
    const tdMatches = [...html.matchAll(tdRegex)];
    const tdTexts = tdMatches.map(m => m[1].trim()).filter(t => t && !t.match(/^(院校|专业|考生)/));
    
    if (tdTexts.length >= 2) {
      details["录取状态"] = tdTexts[0];
      if (tdTexts.length >= 3) details["院校"] = tdTexts[2];
      if (tdTexts.length >= 5) details["专业"] = tdTexts[4];
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
  
  // 操作频繁/限流
  if (html.includes("操作频繁") || html.includes("稍后再试") || html.includes("频率")) {
    return { found: false, message: "操作频繁，请稍后再试", captchaError: true };
  }
  
  // 表单页（验证码错误回显）
  if (html.includes('id="key1"') && html.includes("请输入")) {
    return { found: false, message: "返回了查询表单", captchaError: true };
  }
  
  const snippet = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 200);
  return { found: false, message: `未知响应: ${snippet.substring(0, 100)}`, unknown: true };
}

// ===================== 主循环 =====================

async function main() {
  console.clear();
  log("=".repeat(55));
  log("  江西省高考录取结果自动查询工具");
  log("=".repeat(55));
  log(`  准考证号: ${CONFIG.examNumber}`);
  log(`  证件后4位: ${CONFIG.idLast4}`);
  log(`  查询模式: ${CONFIG.manualCaptcha ? "手动输入验证码" : "自动OCR识别"}`);
  log(`  查询间隔: ${CONFIG.checkIntervalMinutes === 0 ? "仅一次" : CONFIG.checkIntervalMinutes + " 分钟"}`);
  log(`  邮件通知: ${CONFIG.smtp.enabled ? "已启用 → " + CONFIG.smtp.to : "未启用"}`);
  log("=".repeat(55));
  
  // 初始化OCR（自动模式）
  if (!CONFIG.manualCaptcha) {
    await loadOCR();
  }
  
  // 初始化邮件（如果启用）
  initMailer();
  await sendTestEmail();   // 首次/配置变更时发送测试邮件

  // 创建浏览器上下文
  const browser = await chromium.launch({
    channel: "chrome",
    headless: !CONFIG.manualCaptcha, // 手动模式显示浏览器
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
    ],
  });
  
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });
  
  // 恢复之前的会话cookie
  const savedCookies = CONFIG.manualCaptcha ? null : loadCookies();
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
      
      // 重试循环
      const maxRetries = CONFIG.manualCaptcha ? 1 : CONFIG.maxCaptchaRefetches;
      for (let retry = 0; retry < maxRetries; retry++) {
        if (retry > 0) {
          log(`├─ 重新获取验证码 (${retry}/${maxRetries})...`);
          await sleep(CONFIG.captchaRefetchDelayMs);  // 延迟，避免限流
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
        if (!CONFIG.manualCaptcha) {
          log("├─ 💡 提示: 尝试使用手动模式 'node auto-checker.js --headed'");
        }
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
        
        log("├─");
        log("└─ 🔔 持续响铃提醒！按 Ctrl+C 退出");
        
        while (true) {
          playAlert();
          await sleep(30000);
          log(`[${timestamp()}] 🔔 录取结果已出！请查看 results/ 目录`);
        }
      } else {
        log(`├─ 结果: ${finalResult.message}`);
        
        // 显示考生姓名确认
        if (finalResult.html) {
          const nameMatch = finalResult.html.match(/<span class="kname">([^<]+)<\/span>/);
          if (nameMatch) log(`├─ 考生: ${nameMatch[1].trim()}`);
        }
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

process.on("exit", () => cleanup());

main().catch(err => {
  log(`程序异常: ${err.message}`);
  console.error(err);
  process.exit(1);
});
