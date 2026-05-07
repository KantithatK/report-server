// ===== server.js (คัดลอกแทนทั้งไฟล์ได้เลย) =====
const path = require("path");
const fs = require("fs");
const os = require("os");
const express = require("express");
const puppeteer = require("puppeteer");
const Handlebars = require("handlebars");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 4100;

const LOG_DIR = path.join(__dirname, "logs");
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// =========================
// Pretty CMD Logger
// =========================
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",

  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",

  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m",
};

function color(text, ...codes) {
  return `${codes.join("")}${text}${ANSI.reset}`;
}

function nowStamp() {
  const d = new Date();
  return d.toLocaleString("th-TH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function nowIso() {
  return new Date().toISOString();
}

function nowForFile() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getLogFilePath() {
  return path.join(LOG_DIR, `server-${nowForFile()}.log`);
}

function appendLogLine(line) {
  try {
    fs.appendFileSync(getLogFilePath(), line + os.EOL, "utf8");
  } catch (err) {
    console.error("write log file failed:", err?.message || err);
  }
}

function toPlainText(v) {
  return String(v ?? "").replace(/\x1b\[[0-9;]*m/g, "");
}

function writeMonitorLog(entry = {}) {
  const line = JSON.stringify({
    ts: nowIso(),
    ...entry,
  });
  appendLogLine(line);
}

function cleanupOldLogs(days = 14) {
  try {
    const files = fs.readdirSync(LOG_DIR);
    const now = Date.now();
    const maxAge = days * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.endsWith(".log")) continue;
      const p = path.join(LOG_DIR, file);
      const stat = fs.statSync(p);
      if (now - stat.mtimeMs > maxAge) {
        fs.unlinkSync(p);
        writeMonitorLog({
          level: "LOG_CLEANUP",
          message: "old log deleted",
          file,
        });
      }
    }
  } catch (err) {
    console.error("log cleanup failed:", err?.message || err);
  }
}

function hr() {
  console.log(color("─".repeat(108), ANSI.dim, ANSI.cyan));
}

function padRight(str, len) {
  const s = String(str ?? "");
  if (s.length >= len) return s;
  return s + " ".repeat(len - s.length);
}

function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function safeJsonSize(obj) {
  try {
    return Buffer.byteLength(JSON.stringify(obj || {}), "utf8");
  } catch {
    return 0;
  }
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[i]}`;
}

function getStatusColor(status) {
  if (status >= 500) return ANSI.red;
  if (status >= 400) return ANSI.yellow;
  if (status >= 300) return ANSI.cyan;
  if (status >= 200) return ANSI.green;
  return ANSI.white;
}

function getMethodColor(method) {
  const m = String(method || "").toUpperCase();
  if (m === "GET") return ANSI.cyan;
  if (m === "POST") return ANSI.green;
  if (m === "PUT") return ANSI.yellow;
  if (m === "DELETE") return ANSI.red;
  if (m === "PATCH") return ANSI.magenta;
  if (m === "OPTIONS") return ANSI.blue;
  return ANSI.white;
}

function routeLabelFromPath(url = "") {
  if (url.startsWith("/tpr-quotation")) return "QUOTATION";
  if (url.startsWith("/tpr-credit-note")) return "CREDIT_NOTE";
  if (url.startsWith("/tpr-invoice")) return "INVOICE";
  if (url.startsWith("/tpr-purchase-order")) return "PURCHASE_ORDER";
  if (url.startsWith("/tpr-receipt")) return "RECEIPT";
  if (url.startsWith("/tpr-tax-receipt")) return "TAX_RECEIPT";
  if (url.startsWith("/tpr-withholding-tax-certificate")) return "WHT_CERT";
  if (url.startsWith("/tpr-payment-voucher")) return "PAYMENT_VOUCHER";
  if (url.startsWith("/tpr-receipt-voucher")) return "RECEIPT_VOUCHER";
  if (url.startsWith("/tpr-petty-cash-voucher")) return "PETTY_CASH_VOUCHER";
  if (url.startsWith("/tpr-petty-cash-request")) return "PETTY_CASH_REQUEST";
  if (url.startsWith("/tpr-petty-cash-payment-report")) return "PETTY_CASH_REPORT";
  if (url.startsWith("/tpr-receipt-certification")) return "RECEIPT_CERTIFICATION";
  if (url.startsWith("/tpr-payroll-slip")) return "PAYROLL_SLIP";
  if (url.startsWith("/health")) return "HEALTH";
  if (url.startsWith("/debug/css")) return "DEBUG_CSS";
  return "GENERAL";
}

function genReqId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

function logBanner() {
  const lines = [
    "╔════════════════════════════════════════════════════════════════════════════════════════════════════╗",
    "║                                  TPR PDF SERVER MONITOR                                          ║",
    "╚════════════════════════════════════════════════════════════════════════════════════════════════════╝",
  ];
  console.log(color(lines[0], ANSI.bold, ANSI.cyan));
  console.log(color(lines[1], ANSI.bold, ANSI.white));
  console.log(color(lines[2], ANSI.bold, ANSI.cyan));
  console.log(
    color("[BOOT] ", ANSI.bold, ANSI.green) +
      color(`started at ${nowStamp()}`, ANSI.white)
  );
  hr();
}

function logInfo(title, message, extra = {}) {
  console.log(
    color(`[INFO] `, ANSI.bold, ANSI.blue) +
      color(`${title}`, ANSI.bold, ANSI.white) +
      color(`  ${message}`, ANSI.dim, ANSI.white)
  );

  writeMonitorLog({
    level: "INFO",
    title,
    message: toPlainText(message),
    ...extra,
  });
}

function logSuccess(title, message, extra = {}) {
  console.log(
    color(`[OK]   `, ANSI.bold, ANSI.green) +
      color(`${title}`, ANSI.bold, ANSI.white) +
      color(`  ${message}`, ANSI.dim, ANSI.white)
  );

  writeMonitorLog({
    level: "OK",
    title,
    message: toPlainText(message),
    ...extra,
  });
}

function logWarn(title, message, extra = {}) {
  console.log(
    color(`[WARN] `, ANSI.bold, ANSI.yellow) +
      color(`${title}`, ANSI.bold, ANSI.white) +
      color(`  ${message}`, ANSI.dim, ANSI.white)
  );

  writeMonitorLog({
    level: "WARN",
    title,
    message: toPlainText(message),
    ...extra,
  });
}

function logErrorBlock(title, err, reqId = "", extra = {}) {
  hr();
  console.error(color("[ERROR] " + title, ANSI.bold, ANSI.bgRed, ANSI.white));
  if (reqId) {
    console.error(color(`Request ID : ${reqId}`, ANSI.bold, ANSI.red));
  }
  console.error(color(`Time       : ${nowStamp()}`, ANSI.red));
  console.error(color(`Message    : ${err?.message || String(err)}`, ANSI.red));
  if (err?.stack) {
    console.error(color("Stack      :", ANSI.bold, ANSI.red));
    console.error(color(err.stack, ANSI.dim, ANSI.white));
  }
  hr();

  writeMonitorLog({
    level: "ERROR",
    title,
    reqId,
    message: err?.message || String(err),
    stack: err?.stack || "",
    ...extra,
  });
}

function createReqLogger(req) {
  return function step(stage, detail = "") {
    const prefix =
      color(`[REQ ${req.reqId}]`, ANSI.bold, ANSI.magenta) +
      color(` [${routeLabelFromPath(req.originalUrl)}] `, ANSI.bold, ANSI.cyan) +
      color(`${stage}`, ANSI.bold, ANSI.white);

    if (detail) {
      console.log(prefix + color(`  ${detail}`, ANSI.dim, ANSI.white));
    } else {
      console.log(prefix);
    }

    writeMonitorLog({
      level: "STEP",
      reqId: req.reqId,
      route: routeLabelFromPath(req.originalUrl),
      stage,
      detail: toPlainText(detail),
      method: req.method,
      url: req.originalUrl,
    });
  };
}

// request logger middleware
app.use((req, res, next) => {
  req.reqId = genReqId();
  req.logStep = createReqLogger(req);

  const start = Date.now();
  const origin = req.headers.origin || "-";
  const ua = req.headers["user-agent"] || "-";
  const ip =
    req.headers["x-forwarded-for"] ||
    req.socket?.remoteAddress ||
    req.ip ||
    "-";

  req.logStep("START", `${req.method} ${req.originalUrl}`);

  console.log(
    color("        ", ANSI.dim) +
      color("id=", ANSI.dim, ANSI.white) +
      color(req.reqId, ANSI.bold, ANSI.magenta) +
      color(" | ip=", ANSI.dim, ANSI.white) +
      color(ip, ANSI.white) +
      color(" | origin=", ANSI.dim, ANSI.white) +
      color(origin, ANSI.white)
  );

  if (ua && ua !== "-") {
    console.log(
      color("        ", ANSI.dim) +
        color("ua=", ANSI.dim, ANSI.white) +
        color(ua.length > 120 ? ua.slice(0, 117) + "..." : ua, ANSI.dim, ANSI.white)
    );
  }

  writeMonitorLog({
    level: "REQUEST_START",
    reqId: req.reqId,
    route: routeLabelFromPath(req.originalUrl),
    method: req.method,
    url: req.originalUrl,
    ip,
    origin,
    ua,
    payloadBytes: safeJsonSize(req.body || {}),
  });

  res.on("finish", () => {
    const ms = Date.now() - start;
    const status = res.statusCode;
    const methodColored = color(padRight(req.method, 6), ANSI.bold, getMethodColor(req.method));
    const statusColored = color(String(status), ANSI.bold, getStatusColor(status));
    const label = color(routeLabelFromPath(req.originalUrl), ANSI.bold, ANSI.cyan);
    const len = res.getHeader("content-length");
    const size = len ? formatBytes(Number(len)) : "-";

    console.log(
      color(`[DONE ${req.reqId}] `, ANSI.bold, ANSI.green) +
        methodColored +
        color(" | ", ANSI.dim) +
        statusColored +
        color(" | ", ANSI.dim) +
        color(label, ANSI.white) +
        color(" | ", ANSI.dim) +
        color(req.originalUrl, ANSI.white) +
        color(" | ", ANSI.dim) +
        color(formatMs(ms), ANSI.bold, ANSI.yellow) +
        color(" | ", ANSI.dim) +
        color(size, ANSI.white)
    );
    hr();

    writeMonitorLog({
      level: "REQUEST_DONE",
      reqId: req.reqId,
      route: routeLabelFromPath(req.originalUrl),
      method: req.method,
      url: req.originalUrl,
      status,
      durationMs: ms,
      responseSize: size,
    });
  });

  res.on("close", () => {
    if (!res.writableEnded) {
      console.log(
        color(`[CLOSE ${req.reqId}] `, ANSI.bold, ANSI.yellow) +
          color(`${req.method} ${req.originalUrl} connection closed before finish`, ANSI.white)
      );
      hr();

      writeMonitorLog({
        level: "REQUEST_CLOSE",
        reqId: req.reqId,
        route: routeLabelFromPath(req.originalUrl),
        method: req.method,
        url: req.originalUrl,
        note: "connection closed before finish",
      });
    }
  });

  next();
});

// =========================
// CORS
// =========================
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (/^http:\/\/localhost:\d+$/.test(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS: " + origin));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "2mb" }));

// static: http://localhost:4100/...
app.use(express.static(path.join(__dirname, "public")));

// =========================
// Handlebars helpers
// =========================
Handlebars.registerHelper("money", (v) => {
  const n = Number(v || 0);
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
});

// money แต่ถ้าไม่ได้ส่งค่า (null/undefined/"") ให้แสดง "-" แทน
Handlebars.registerHelper("moneyOrDash", (v) => {
  if (v === null || v === undefined || v === "") return "-";
  const n = Number(String(v).replace(/,/g, ""));
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
});

// แสดงจำนวนแบบมีเครื่องหมาย - เฉพาะกรณีติดลบ (เช่น ผลต่าง)
Handlebars.registerHelper("moneySigned", (v) => {
  const n = Number(v || 0);
  const abs = Math.abs(n).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-${abs}` : abs;
});

Handlebars.registerHelper("safeText", (v, fallback = "-") => {
  const s = (v ?? "").toString().trim();
  return s ? s : fallback;
});

Handlebars.registerHelper("isZero", (v) => {
  return Number(v || 0) === 0;
});

// =========================
// Template compile (cache)
// =========================
function compileTemplate(relPath) {
  const p = path.join(__dirname, relPath);
  if (!fs.existsSync(p)) throw new Error(`Template missing: ${p}`);
  logInfo("TEMPLATE", `compile ${relPath}`, { templatePath: p });
  return Handlebars.compile(fs.readFileSync(p, "utf8"));
}

const templates = {
  quotation: compileTemplate(path.join("templates", "tpr_quotation.hbs")),
  credit_note: compileTemplate(path.join("templates", "tpr_credit_note.hbs")),
  invoice: compileTemplate(path.join("templates", "tpr_invoice.hbs")),
  purchase_order: compileTemplate(path.join("templates", "tpr_purchase_order.hbs")),
  receipt: compileTemplate(path.join("templates", "tpr_receipt.hbs")),
  tax_receipt: compileTemplate(path.join("templates", "tpr_tax_receipt.hbs")),
  withholding_tax_certificate: compileTemplate(
    path.join("templates", "tpr_withholding_tax_certificate.hbs")
  ),
  payment_voucher: compileTemplate(path.join("templates", "tpr_payment_voucher.hbs")),
  receipt_voucher: compileTemplate(path.join("templates", "tpr_receipt_voucher.hbs")),
  petty_cash_voucher: compileTemplate(path.join("templates", "tpr_petty_cash_voucher.hbs")),
  petty_cash_request: compileTemplate(path.join("templates", "tpr_petty_cash_request.hbs")),
  petty_cash_payment_report: compileTemplate(
    path.join("templates", "tpr_petty_cash_payment_report.hbs")
  ),
  receipt_certification: compileTemplate(
    path.join("templates", "tpr_receipt_certification.hbs")
  ),
  payroll_slip: compileTemplate(
    path.join("templates", "tpr_payroll_slip.hbs")
  ),
};

// ✅ load CSS to inline inject (เผื่อ template ยังใช้) — คงไว้เพื่อ backward compatible
const cssPath = path.join(__dirname, "public", "css", "quotation.css");
const cssInline = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf8") : "";
if (cssInline) {
  logSuccess("CSS", `inline loaded from ${cssPath}`, { cssPath });
} else {
  logWarn("CSS", `inline missing: ${cssPath} (ไม่จำเป็นถ้า CSS อยู่ใน hbs แล้ว)`, { cssPath });
}

// =========================
// Utils
// =========================
function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

// ---- Thai Baht text (ใช้กับ credit note) ----
function numberToThaiWords(num) {
  const digits = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
  const units = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];
  if (num === 0) return "ศูนย์";

  function convertLessThanMillion(n) {
    let s = "";
    const str = String(n).padStart(6, "0");
    for (let i = 0; i < 6; i++) {
      const digit = Number(str[i]);
      const pos = 6 - i - 1;
      if (digit === 0) continue;

      if (pos === 1) {
        if (digit === 1) s += "สิบ";
        else if (digit === 2) s += "ยี่สิบ";
        else s += digits[digit] + "สิบ";
      } else if (pos === 0) {
        const tensDigit = Number(str[4]);
        if (digit === 1 && tensDigit > 0) s += "เอ็ด";
        else s += digits[digit];
      } else {
        s += digits[digit] + units[pos];
      }
    }
    return s;
  }

  let result = "";
  let remaining = Math.floor(num);

  const parts = [];
  while (remaining > 0) {
    parts.push(remaining % 1000000);
    remaining = Math.floor(remaining / 1000000);
  }

  for (let i = parts.length - 1; i >= 0; i--) {
    const g = parts[i];
    if (g === 0) continue;
    result += convertLessThanMillion(g);
    if (i > 0) result += "ล้าน";
  }

  return result || "ศูนย์";
}

function thaiBahtText(amount) {
  const sign = amount < 0 ? "ลบ" : "";
  const abs = Math.abs(round2(amount));
  let baht = Math.floor(abs);
  let satang = Math.round((abs - baht) * 100);

  if (satang === 100) {
    baht += 1;
    satang = 0;
  }

  const bahtText = numberToThaiWords(baht);
  let result = sign + bahtText + "บาท";

  if (satang === 0) result += "ถ้วน";
  else result += numberToThaiWords(satang) + "สตางค์";

  return result;
}

// Purchase Order: รวมเงิน, VAT 7%, รวมเงินทั้งสิ้น
function computePurchaseOrderSummary(items, discount = 0) {
  const subtotal = items.reduce((s, x) => s + Number(x.line_total || 0), 0);
  const afterDiscount = subtotal - Number(discount || 0);

  const vat = round2(afterDiscount * 0.07);
  const total = round2(afterDiscount + vat);

  return {
    subtotal: round2(afterDiscount),
    vat,
    total,
    total_text: thaiBahtText(total),
  };
}

// =========================
// Business: summaries
// =========================
function computeQuotationSummary(items, discount = 0, withholdingRate = 0.03) {
  const subtotal = items.reduce((s, x) => s + Number(x.line_total || 0), 0);
  const afterDiscount = subtotal - Number(discount || 0);

  const vat = round2(afterDiscount * 0.07);
  const total = round2(afterDiscount + vat);

  const withholding = round2(afterDiscount * Number(withholdingRate || 0));
  const net_total = round2(total - withholding);

  const total_text = `รวมเป็นเงิน ${total.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} บาทถ้วน`;

  return {
    subtotal: round2(subtotal),
    discount: round2(discount),
    vat,
    total,
    withholding,
    net_total,
    total_text,
  };
}

// Credit Note: diff = correct - original
function computeCreditNoteSummary(originalTotal = 0, correctTotal = 0) {
  const original = round2(originalTotal);
  const correct = round2(correctTotal);
  const diff = round2(correct - original);

  return {
    original_total: original,
    correct_total: correct,
    diff_total: diff,
    diff_text: thaiBahtText(diff),
    original_total_text: thaiBahtText(original),
    correct_total_text: thaiBahtText(correct),
  };
}

// Invoice/Billing
function computeInvoiceSummary(items, discount = 0, withholdingRate = 0.03) {
  const subtotal = items.reduce((s, x) => s + Number(x.line_total || 0), 0);
  const afterDiscount = subtotal - Number(discount || 0);

  const vat = round2(afterDiscount * 0.07);
  const total = round2(afterDiscount + vat);

  const withholding = round2(afterDiscount * Number(withholdingRate || 0));
  const net_total = round2(total - withholding);

  const total_text = `รวมเป็นเงิน ${total.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} บาทถ้วน`;

  return {
    subtotal: round2(subtotal),
    discount: round2(discount),
    vat,
    total,
    withholding,
    net_total,
    total_text,
  };
}

// Receipt
function computeReceiptSummary(items, deposit = 0) {
  const subtotal = items.reduce((s, x) => s + Number(x.line_total || 0), 0);
  const dep = round2(deposit || 0);
  const after_deposit = round2(subtotal - dep);
  const net_total = round2(after_deposit);

  const total_text = `รวมเป็นเงิน ${net_total.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} บาทถ้วน`;

  return {
    subtotal: round2(subtotal),
    deposit: dep,
    after_deposit,
    net_total,
    total_text,
  };
}

// Tax receipt
function computeTaxReceiptSummary(items, depositReturn = 0) {
  const subtotal = items.reduce((s, x) => s + Number(x.line_total || 0), 0);
  const depRet = round2(depositReturn || 0);
  const after_deposit = round2(subtotal - depRet);

  const vat = round2(after_deposit * 0.07);
  const total = round2(after_deposit + vat);
  const net_total = total;

  const total_text = `รวมเป็นเงิน ${total.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} บาทถ้วน`;

  return {
    subtotal: round2(subtotal),
    deposit_return: depRet,
    after_deposit,
    vat,
    total,
    net_total,
    total_text,
  };
}

// =========================
// Normalizers
// =========================
function normalizeCompany(payload) {
  return {
    logo_url: payload?.company?.logo_url || payload?.logoUrl || "",
    name: payload?.company?.name || "TPR GLOBAL SERVICE",
    branch:
      payload?.company?.branch ||
      payload?.company?.branch_name ||
      payload?.company?.branchName ||
      payload?.branch ||
      "",
    address: payload?.company?.address || "99/1 ถนนสุขุมวิท แขวงบางนา เขตบางนา กรุงเทพฯ 10260",
    tax_id: payload?.company?.tax_id || "010555xxxxx",
    phone: payload?.company?.phone || "02-xxx-xxxx",
    fax: payload?.company?.fax || payload?.company?.fax_no || payload?.company?.faxNo || payload?.fax || "",
    email: payload?.company?.email || "info@tprgs.co.th",
  };
}

function normalizeCustomer(payload) {
  return {
    name: payload?.customer?.name || payload?.customerName || "-",
    address: payload?.customer?.address || payload?.customerAddress || "",
    tax_id: payload?.customer?.tax_id || payload?.customerTaxId || "",
  };
}

function normalizeVendor(payload) {
  return {
    name:
      payload?.vendor?.name ||
      payload?.vendorName ||
      payload?.supplier?.name ||
      payload?.supplierName ||
      "-",
    address:
      payload?.vendor?.address ||
      payload?.vendorAddress ||
      payload?.supplier?.address ||
      payload?.supplierAddress ||
      "",
    tax_id:
      payload?.vendor?.tax_id ||
      payload?.vendorTaxId ||
      payload?.supplier?.tax_id ||
      payload?.supplierTaxId ||
      "",
  };
}

function normalizeItems(payload) {
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  return rawItems.map((it, idx) => {
    const qty = Number(it?.qty || 0);
    const price = Number(it?.price || 0);
    return {
      no: idx + 1,
      name: it?.name || "-",
      description: it?.description || "",
      qty,
      unit: it?.unit || "รายการ",
      price,
      line_total: round2(qty * price),
    };
  });
}

function parseNumberLoose(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return 0;
    return Number(s.replace(/,/g, "")) || 0;
  }
  return Number(v) || 0;
}

function toTaxIdBoxes(taxId) {
  const digits = String(taxId || "").replace(/\D/g, "").slice(0, 13); // ใช้สูงสุด 13 หลักแรก
  const targetLengths = [1, 4, 5, 2, 1];
  const blanks = (n) => Array.from({ length: n }, () => "&nbsp;");

  if (digits.length !== 13) {
    return {
      p1: blanks(targetLengths[0]),
      p2: blanks(targetLengths[1]),
      p3: blanks(targetLengths[2]),
      p4: blanks(targetLengths[3]),
      p5: blanks(targetLengths[4]),
    };
  }

  let offset = 0;
  const parts = targetLengths.map((len) => {
    const s = digits.slice(offset, offset + len);
    offset += len;
    return s.split("");
  });

  return { p1: parts[0], p2: parts[1], p3: parts[2], p4: parts[3], p5: parts[4] };
}

function computeWithholdingTaxCertificateSummary(incomeRows, payloadSummary = {}) {
  const totalPaidFromClient = payloadSummary?.total_paid ?? payloadSummary?.totalPaid;
  const totalWithheldFromClient = payloadSummary?.total_withheld ?? payloadSummary?.totalWithheld;

  const total_paid = round2(
    parseNumberLoose(totalPaidFromClient) ||
      incomeRows.reduce((s, r) => s + parseNumberLoose(r?.paid_amount), 0)
  );
  const total_withheld = round2(
    parseNumberLoose(totalWithheldFromClient) ||
      incomeRows.reduce((s, r) => s + parseNumberLoose(r?.withheld_tax), 0)
  );

  const totalWithheldTextFromClient =
    typeof payloadSummary?.total_withheld_text === "string" && payloadSummary.total_withheld_text.trim()
      ? payloadSummary.total_withheld_text.trim()
      : typeof payloadSummary?.totalWithheldText === "string" && payloadSummary.totalWithheldText.trim()
        ? payloadSummary.totalWithheldText.trim()
        : "";

  return {
    total_paid,
    total_withheld,
    total_withheld_text: totalWithheldTextFromClient || thaiBahtText(total_withheld),
  };
}

function normalizeQuotationPayload(payload) {
  const items = normalizeItems(payload);
  const discount = Number(payload?.discount || 0);
  const withholdingRate = payload?.withholding_rate ?? 0.03;
  const summary = computeQuotationSummary(items, discount, withholdingRate);

  return {
    css_inline: cssInline,
    company: normalizeCompany(payload),
    doc: {
      number: payload?.doc?.number || payload?.docNumber || "QT-DEV-0001",
      date: payload?.doc?.date || payload?.docDate || "10/01/2026",
      due_date: payload?.doc?.due_date || payload?.dueDate || "",
      valid_until: payload?.doc?.valid_until || payload?.validUntil || "24/01/2026",
    },
    customer: normalizeCustomer(payload),
    terms: {
      bank_note:
        payload?.terms?.bank_note ||
        payload?.bankNote ||
        "โอนเงินเข้าบัญชี ธนาคารกสิกรไทย สาขา ลาดพร้าว\nชื่อบัญชี บริษัท ตัวอย่าง จำกัด\nเลขที่บัญชี 023-2-67749-0",
    },
    items,
    summary,
  };
}

function normalizeCreditNotePayload(payload) {
  const items = normalizeItems(payload);

  const ref = {
    invoice_no: payload?.ref?.invoice_no || payload?.refInvoiceNo || "",
    invoice_date: payload?.ref?.invoice_date || payload?.refInvoiceDate || "",
  };

  const reason = {
    text: payload?.reason?.text || payload?.reasonText || "",
  };

  const originalTotal = payload?.summary?.original_total ?? payload?.original_total ?? payload?.originalTotal ?? 0;
  const correctTotal = payload?.summary?.correct_total ?? payload?.correct_total ?? payload?.correctTotal ?? 0;

  const baseSummary = computeCreditNoteSummary(originalTotal, correctTotal);

  const vat = round2(payload?.summary?.vat ?? 0);
  const grand_total = round2(payload?.summary?.grand_total ?? (baseSummary.diff_total + vat));

  const diff_text =
    typeof payload?.summary?.diff_text === "string" && payload.summary.diff_text.trim()
      ? payload.summary.diff_text.trim()
      : baseSummary.diff_text;

  return {
    css_inline: cssInline,
    company: normalizeCompany(payload),
    doc: {
      number: payload?.doc?.number || payload?.docNumber || "CN-DEV-0001",
      date: payload?.doc?.date || payload?.docDate || "10/01/2026",
    },
    customer: normalizeCustomer(payload),
    ref,
    reason,
    items,
    summary: {
      ...baseSummary,
      vat,
      grand_total,
      diff_text,
    },
  };
}

function normalizeInvoicePayload(payload) {
  const items = normalizeItems(payload);
  const discount = Number(payload?.discount || 0);
  const withholdingRate = payload?.withholding_rate ?? 0.03;
  const summary = computeInvoiceSummary(items, discount, withholdingRate);

  const ref = {
    quotation_no:
      payload?.ref?.quotation_no ||
      payload?.refQuotationNo ||
      payload?.quotation_no ||
      payload?.quotationNo ||
      "",
  };

  return {
    css_inline: cssInline,
    company: normalizeCompany(payload),
    doc: {
      number: payload?.doc?.number || payload?.docNumber || "IV-DEV-0001",
      date: payload?.doc?.date || payload?.docDate || "10/01/2026",
      due_date: payload?.doc?.due_date || payload?.dueDate || "",
    },
    customer: normalizeCustomer(payload),
    ref,
    note: payload?.note || "",
    items,
    summary,
  };
}

function normalizePurchaseOrderPayload(payload) {
  const items = normalizeItems(payload);

  const discount = Number(payload?.discount || payload?.summary?.discount || 0);
  const computed = computePurchaseOrderSummary(items, discount);

  const subtotalFromClient = payload?.summary?.subtotal ?? payload?.subtotal;
  const vatFromClient = payload?.summary?.vat ?? payload?.vat;
  const totalFromClient = payload?.summary?.total ?? payload?.total;

  const subtotal = round2(parseNumberLoose(subtotalFromClient) || computed.subtotal);
  const vat = round2(parseNumberLoose(vatFromClient) || computed.vat);
  const total = round2(parseNumberLoose(totalFromClient) || computed.total);

  const totalTextFromClient =
    typeof payload?.summary?.total_text === "string" && payload.summary.total_text.trim()
      ? payload.summary.total_text.trim()
      : typeof payload?.total_text === "string" && payload.total_text.trim()
        ? payload.total_text.trim()
        : "";

  const total_text = totalTextFromClient || thaiBahtText(total);

  return {
    css_inline: cssInline,
    company: normalizeCompany(payload),
    doc: {
      number:
        payload?.doc?.number ||
        payload?.docNumber ||
        payload?.po_number ||
        payload?.poNumber ||
        "PO-DEV-0001",
      date:
        payload?.doc?.date ||
        payload?.docDate ||
        payload?.po_date ||
        payload?.poDate ||
        "10/01/2026",
      due_date: payload?.doc?.due_date || payload?.dueDate || payload?.doc?.dueDate || "",
      buyer: payload?.doc?.buyer || payload?.buyer || payload?.purchaser || "",
      project_name: payload?.doc?.project_name || payload?.project_name || payload?.projectName || "",
      contact_name: payload?.doc?.contact_name || payload?.contact_name || payload?.contactName || "",
      contact_phone: payload?.doc?.contact_phone || payload?.contact_phone || payload?.contactPhone || "",
      copy_label: payload?.doc?.copy_label || payload?.copy_label || payload?.copyLabel || "ต้นฉบับ",
    },
    vendor: normalizeVendor(payload),
    items,
    notes: {
      title: payload?.notes?.title || payload?.note_title || payload?.noteTitle || "หมายเหตุ :",
      text: payload?.notes?.text || payload?.notes || payload?.note || payload?.remark || "",
    },
    summary: {
      subtotal,
      vat,
      total,
      total_text,
    },
    closing_message:
      payload?.closing_message ||
      payload?.closingMessage ||
      "ทางบริษัทฯ หวังเป็นอย่างยิ่งว่าจะได้บริการท่านในเร็วๆ นี้",
    signature: {
      title: payload?.signature?.title || payload?.signatureTitle || "ผู้จัดทำเอกสาร",
    },
    confirmation: {
      text:
        payload?.confirmation?.text ||
        payload?.confirmationText ||
        "กรณีสั่งซื้อ กรุณาลงนามยืนยันการสั่งซื้อสินค้าตามด้านล่างนี้ หรือส่งใบสั่งซื้อหน่วยงานท่านมาที่บริษัทฯ",
      sign1_label:
        payload?.confirmation?.sign1_label ||
        payload?.confirmation?.sign1Label ||
        "ผู้มีอำนาจ",
      sign2_label:
        payload?.confirmation?.sign2_label ||
        payload?.confirmation?.sign2Label ||
        "ประทับตราหน่วยงาน",
      footnote: payload?.confirmation?.footnote || payload?.confirmationFootnote || "",
    },
  };
}

function normalizeReceiptPayload(payload) {
  const items = normalizeItems(payload);
  const deposit_return = Number(
    payload?.deposit_return || payload?.summary?.deposit_return ||
    payload?.deposit        || payload?.summary?.deposit        || 0
  );
  const raw = computeReceiptSummary(items, deposit_return);

  // map ให้ตรง template variable (summary.total, summary.deposit_return)
  const summary = {
    total:          raw.subtotal,
    deposit_return: raw.deposit,
    after_deposit:  raw.after_deposit,
    net_total:      raw.net_total,
    total_text:     raw.total_text,
  };

  return {
    css_inline: cssInline,
    company: normalizeCompany(payload),
    doc: {
      number: payload?.doc?.number || payload?.docNumber || "RC-DEV-0001",
      date: payload?.doc?.date || payload?.docDate || "10/01/2026",
    },
    customer: normalizeCustomer(payload),
    note: payload?.note || "",
    items,
    summary,
  };
}

function normalizeTaxReceiptPayload(payload) {
  const items = normalizeItems(payload);
  const deposit_return = Number(
    payload?.deposit_return || payload?.depositReturn || payload?.summary?.deposit_return || 0
  );
  const summary = computeTaxReceiptSummary(items, deposit_return);

  const ref = {
    billing_no: payload?.ref?.billing_no || payload?.refBillingNo || payload?.ref?.billingNo || "",
    billing_date: payload?.ref?.billing_date || payload?.refBillingDate || payload?.ref?.billingDate || "",
  };

  return {
    css_inline: cssInline,
    company: normalizeCompany(payload),
    doc: {
      number: payload?.doc?.number || payload?.docNumber || "TR-DEV-0001",
      date: payload?.doc?.date || payload?.docDate || "10/01/2026",
    },
    customer: normalizeCustomer(payload),
    ref,
    note: payload?.note || "",
    items,
    summary,
  };
}

function normalizeWithholdingTaxCertificatePayload(payload) {
  const withholderRaw = payload?.withholder || payload?.payer || payload?.company || {};
  const payeeRaw = payload?.payee || payload?.recipient || payload?.customer || {};

  const withholder = {
    name: withholderRaw?.name || payload?.withholderName || payload?.payerName || "",
    address: withholderRaw?.address || payload?.withholderAddress || payload?.payerAddress || "",
    tax_id:
      withholderRaw?.tax_id ||
      withholderRaw?.taxId ||
      payload?.withholderTaxId ||
      payload?.payerTaxId ||
      "",
  };
  withholder.tax_id_boxes = toTaxIdBoxes(withholder.tax_id);

  const payee = {
    name: payeeRaw?.name || payload?.payeeName || payload?.recipientName || "",
    address: payeeRaw?.address || payload?.payeeAddress || payload?.recipientAddress || "",
    tax_id:
      payeeRaw?.tax_id ||
      payeeRaw?.taxId ||
      payload?.payeeTaxId ||
      payload?.recipientTaxId ||
      "",
  };
  payee.tax_id_boxes = toTaxIdBoxes(payee.tax_id);

  const formType =
    (payload?.doc?.form_type || payload?.doc?.formType || payload?.form_type || payload?.formType || "").toString();

  const form_types = {
    pnd1k: formType === "pnd1k",
    pnd1k_special: formType === "pnd1k_special",
    pnd2: formType === "pnd2",
    pnd3: formType === "pnd3",
    pnd2k: formType === "pnd2k",
    pnd3k: formType === "pnd3k",
    pnd53: formType === "pnd53",
  };

  const rawIncomeRows = Array.isArray(payload?.income_rows)
    ? payload.income_rows
    : Array.isArray(payload?.incomeRows)
      ? payload.incomeRows
      : null;

  const defaultIncomeRows = [
    { label: "1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตามมาตรา 40 (1)", row_class: "" },
    { label: "2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ ตามมาตรา 40 (2)", row_class: "" },
    { label: "3. ค่าแห่งลิขสิทธิ์ ฯลฯ ตามมาตรา 40 (3)", row_class: "" },
    { label: "4. (ก) ค่าดอกเบี้ย ฯลฯ ตามมาตรา 40(4) (ก)", row_class: "item-4" },
    { label: "(ข) เงินปันผล เงินส่วนแบ่งกำไร ฯลฯ ตามมาตรา 40(4) (ข)", row_class: "item-4", indent_mm: 3 },
    {
      label:
        "(1) กรณีผู้ได้รับเงินปันผลได้รับเครดิตภาษี โดยจ่ายจากกำไรสุทธิของกิจการที่ได้ต้องเสียภาษีเงินได้นิติบุคคลในอัตราดังนี้",
      row_class: "item-4",
      indent_mm: 6,
    },
    { label: "(1.1) อัตราร้อยละ 30 ของกำไรสุทธิ", row_class: "item-4", indent_mm: 10 },
    { label: "(1.2) อัตราร้อยละ 25 ของกำไรสุทธิ", row_class: "item-4", indent_mm: 10 },
    { label: "(1.3) อัตราร้อยละ 20 ของกำไรสุทธิ", row_class: "item-4", indent_mm: 10 },
    { label: "(1.4) อัตราอื่น ๆ (ระบุ).................ของกำไรสุทธิ", row_class: "item-4", indent_mm: 10 },
    { label: "(2) กรณีผู้ได้รับเงินปันผลไม่ได้รับเครดิตภาษี เนื่องจากจ่ายจาก", row_class: "item-4", indent_mm: 6 },
    { label: "(2.1) กำไรสุทธิของกิจการที่ได้รับยกเว้นภาษีเงินได้นิติบุคคล", row_class: "item-4", indent_mm: 10 },
    {
      label:
        "(2.2) เงินปันผลหรือเงินส่วนแบ่งของกำไรที่ได้รับยกเว้นไม่ต้องนำมารวม คำนวณเป็นรายได้เพื่อเสียภาษีนิติบุคคล",
      row_class: "item-4",
      indent_mm: 10,
    },
    {
      label:
        "(2.3) กำไรสุทธิส่วนที่ได้หักผลขาดทุนสุทธิยกมาไม่เกิน 5 ปี ก่อนรอบระยะเวลาบัญชีปัจจุบัน",
      row_class: "item-4",
      indent_mm: 10,
    },
    { label: "(2.4) กำไรที่รับรู้ทางบัญชีโดยวิธีส่วนได้เสีย (equity method)", row_class: "item-4", indent_mm: 10 },
    {
      label:
        "(2.5) อื่น ๆ ( ระบุ ).....................................................................................................................",
      row_class: "item-4",
      indent_mm: 10,
    },
    {
      label:
        "5. การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่ายตามคำสั่งกรมสรรพากรที่ออกตามมาตรา 3 เตรส เช่น รางวัล ส่วนลดหรือประโยชน์ใด ๆ เนื่องจากการส่งเสริมการขาย รางวัลในการประกวด การแข่งขัน การชิงโชค ค่าแสดงของนักแสดงสาธารณะ ค่าจ้างทำของ ค่าโฆษณา ค่าเช่า ค่าขนส่ง ค่าบริการ ค่าเบี้ยประกันวินาศภัย ฯลฯ",
      row_class: "",
    },
    { label: "6. อื่นๆ ระบุ", row_class: "", other_text: "" },
  ];

  // Always use defaultIncomeRows as the authoritative list (fixed labels per Thai tax law).
  // Client sends only the rows that have data, matched by row_index (0-based).
  // We overlay date/paid_amount/withheld_tax from the client row into the matching default row.
  const income_rows = defaultIncomeRows.map((defaultRow, idx) => {
    const clientRow = rawIncomeRows
      ? rawIncomeRows.find((r) => (r?.row_index ?? r?.rowIndex ?? -1) === idx)
      : null;
    return {
      label: defaultRow.label,                                                 // ALWAYS the fixed official text
      date: clientRow?.date || "",
      paid_amount: clientRow?.paid_amount ?? clientRow?.paidAmount ?? null,
      withheld_tax: clientRow?.withheld_tax ?? clientRow?.withheldTax ?? null,
      row_class: defaultRow.row_class || "",
      indent_mm: Number(defaultRow.indent_mm ?? 0) || 0,
      other_text: clientRow?.other_text || clientRow?.otherText || defaultRow.other_text || "",
    };
  });

  const summary = computeWithholdingTaxCertificateSummary(income_rows, payload?.summary || {});

  const paymentMode =
    (payload?.payment?.mode || payload?.payment_mode || payload?.paymentMode || "withholding").toString();

  const payment = {
    one_time: paymentMode === "one_time",
    forever: paymentMode === "forever",
    withholding: paymentMode === "withholding",
    other: paymentMode === "other",
    other_text:
      payload?.payment?.other_text ||
      payload?.payment?.otherText ||
      payload?.payment_other_text ||
      "",
  };

  return {
    css_inline: cssInline,
    doc: {
      book_no: payload?.doc?.book_no || payload?.doc?.bookNo || payload?.book_no || payload?.bookNo || "",
      number: payload?.doc?.number || payload?.docNumber || "",
      sequence_no:
        payload?.doc?.sequence_no ||
        payload?.doc?.sequenceNo ||
        payload?.sequence_no ||
        payload?.sequenceNo ||
        "",
      issued_date:
        payload?.doc?.issued_date ||
        payload?.doc?.issuedDate ||
        payload?.issued_date ||
        payload?.issuedDate ||
        "",
    },
    withholder,
    payee,
    form_types: payload?.form_types || payload?.formTypes || form_types,
    income_rows,
    summary,
    contrib: {
      teacher_fund_amount:
        payload?.contrib?.teacher_fund_amount ||
        payload?.contrib?.teacherFundAmount ||
        payload?.teacher_fund_amount ||
        "",
      social_security_amount:
        payload?.contrib?.social_security_amount ||
        payload?.contrib?.socialSecurityAmount ||
        payload?.social_security_amount ||
        "",
      provident_fund_amount:
        payload?.contrib?.provident_fund_amount ||
        payload?.contrib?.providentFundAmount ||
        payload?.provident_fund_amount ||
        "",
    },
    payment,
    signer: {
      name: payload?.signer?.name || payload?.signerName || payload?.issuer_name || payload?.issuerName || "",
      date: payload?.signer?.date || payload?.signerDate || payload?.issued_date || payload?.issuedDate || "",
    },
    stamp_text: payload?.stamp_text || payload?.stampText || "ประทับตรานิติบุคคล<br>(ถ้ามี)",
  };
}

function normalizePaymentVoucherPayload(payload) {
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  const items = rawItems.map((it) => ({
    date: it?.date || it?.doc_date || it?.docDate || "",
    doc_no: it?.doc_no || it?.docNo || "",
    description: it?.description || it?.name || "",
    amount: round2(parseNumberLoose(it?.amount)),
  }));

  const subtotalComputed = round2(items.reduce((s, x) => s + Number(x.amount || 0), 0));
  const vat = round2(parseNumberLoose(payload?.summary?.vat));
  const subtotal = round2(parseNumberLoose(payload?.summary?.subtotal) || subtotalComputed);
  const net_total = round2(parseNumberLoose(payload?.summary?.net_total) || subtotal + vat);

  return {
    css_inline: cssInline,
    company: normalizeCompany(payload),
    doc: {
      number: payload?.doc?.number || payload?.docNumber || "PV-DEV-0001",
      date: payload?.doc?.date || payload?.docDate || "10/01/2026",
    },
    payee: {
      name: payload?.payee?.name || payload?.payeeName || "-",
    },
    payment: {
      is_cash: Boolean(payload?.payment?.is_cash ?? payload?.payment?.isCash ?? false),
      is_transfer: Boolean(payload?.payment?.is_transfer ?? payload?.payment?.isTransfer ?? false),
      is_cheque: Boolean(payload?.payment?.is_cheque ?? payload?.payment?.isCheque ?? false),
      bank: payload?.payment?.bank || "",
      branch: payload?.payment?.branch || "",
      cheque_no: payload?.payment?.cheque_no || payload?.payment?.chequeNo || "",
      cheque_date: payload?.payment?.cheque_date || payload?.payment?.chequeDate || "",
      amount: round2(parseNumberLoose(payload?.payment?.amount)),
    },
    items,
    summary: {
      subtotal,
      vat: vat || 0,
      net_total,
      total_text: thaiBahtText(net_total),
    },
    notes: payload?.notes || payload?.note || payload?.remark || "",
  };
}

function normalizePettyCashVoucherPayload(payload) {
  return {
    css_inline: cssInline,
    company: normalizeCompany(payload),
    doc: {
      number: payload?.doc?.number || payload?.docNumber || "PCV-DEV-0001",
      title: payload?.doc?.title || payload?.docTitle || "-",
      request_date:
        payload?.doc?.request_date ||
        payload?.doc?.requestDate ||
        payload?.request_date ||
        payload?.requestDate ||
        "",
      amount: round2(parseNumberLoose(payload?.doc?.amount ?? payload?.amount)),
      remark: payload?.doc?.remark || payload?.remark || "",
      department: payload?.doc?.department || payload?.department || "",
    },
    requester: {
      name: payload?.requester?.name || payload?.requesterName || "-",
      position: payload?.requester?.position || payload?.requesterPosition || "",
      bank_info:
        payload?.requester?.bank_info ||
        payload?.requester?.bankInfo ||
        payload?.bank_info ||
        payload?.bankInfo ||
        "",
      name_title:
        payload?.requester?.name_title ||
        payload?.requester?.nameTitle ||
        payload?.requesterNameTitle ||
        payload?.requester?.name ||
        "",
    },
    approver: {
      name: payload?.approver?.name || payload?.approverName || "",
    },
    sign1: Boolean(payload?.sign1),
    sign2: Boolean(payload?.sign2),
  };
}

function normalizeReceiptCertificationPayload(payload) {
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  const items = rawItems.map((it) => ({
    date: it?.date || it?.doc_date || it?.docDate || "",
    description: it?.description || it?.desc || it?.detail || it?.name || "",
    amount: round2(parseNumberLoose(it?.amount)),
    note: it?.note || it?.remark || "",
  }));

  const totalComputed = round2(items.reduce((s, x) => s + Number(x.amount || 0), 0));
  const total = round2(parseNumberLoose(payload?.summary?.total) || totalComputed);

  const totalTextFromClient =
    typeof payload?.summary?.total_text === "string" && payload.summary.total_text.trim()
      ? payload.summary.total_text.trim()
      : typeof payload?.total_text === "string" && payload.total_text.trim()
        ? payload.total_text.trim()
        : "";

  const total_text = totalTextFromClient || `${thaiBahtText(total)}`;

  const emptyRowCount = Math.max(0, 8 - items.length);
  const empty_rows = Array.from({ length: emptyRowCount }, (_, i) => i + 1);

  return {
    css_inline: cssInline,
    company: normalizeCompany(payload),
    doc: {
      number: payload?.doc?.number || payload?.docNumber || "",
    },
    items,
    empty_rows,
    summary: {
      total,
      total_text,
    },
    certification: {
      payer_name:
        payload?.certification?.payer_name ||
        payload?.certification?.payerName ||
        payload?.payer?.name ||
        payload?.requester?.name ||
        payload?.requesterName ||
        "",
      payer_position:
        payload?.certification?.payer_position ||
        payload?.certification?.payerPosition ||
        payload?.payer?.position ||
        payload?.requester?.position ||
        payload?.requesterPosition ||
        "",
      from_date:
        payload?.certification?.from_date ||
        payload?.certification?.fromDate ||
        payload?.from_date ||
        payload?.fromDate ||
        "",
      to_date:
        payload?.certification?.to_date ||
        payload?.certification?.toDate ||
        payload?.to_date ||
        payload?.toDate ||
        "",
    },
  };
}

function normalizePettyCashRequestPayload(payload) {
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  const items = rawItems.map((it, idx) => {
    const desc = it?.description || it?.desc || it?.detail || it?.name || "";
    const amount = round2(parseNumberLoose(it?.amount));
    return {
      no: idx + 1,
      description: desc ? `${idx + 1}. ${desc}` : "",
      amount,
    };
  });

  const totalComputed = round2(items.reduce((s, x) => s + Number(x.amount || 0), 0));
  const total = round2(parseNumberLoose(payload?.summary?.total ?? payload?.total) || totalComputed);

  const desiredRows = Math.max(0, Number(payload?.table_rows || payload?.tableRows || 6));
  const rows = [];
  for (let i = 0; i < desiredRows; i++) {
    const it = items[i];
    if (it) rows.push({ description: it.description, amount: it.amount, has_amount: true });
    else rows.push({ description: "", amount: 0, has_amount: false });
  }

  return {
    css_inline: cssInline,
    company: normalizeCompany(payload),
    doc: {
      number:
        payload?.doc?.number ||
        payload?.docNumber ||
        payload?.document_no ||
        payload?.documentNo ||
        "PC-DEV-0001",
      date: payload?.doc?.date || payload?.docDate || payload?.date || "",
      department: payload?.doc?.department || payload?.department || "",
    },
    form: {
      paid_to:
        payload?.form?.paid_to ||
        payload?.paid_to ||
        payload?.paidTo ||
        payload?.payee ||
        payload?.payeeName ||
        "",
      purpose: payload?.form?.purpose || payload?.purpose || payload?.reason || "",
    },
    rows,
    summary: {
      total,
    },
    signature: {
      receiver: payload?.signature?.receiver || "ผู้รับเงิน",
      approved: payload?.signature?.approved || "อนุมัติโดย",
      checked: payload?.signature?.checked || "ตรวจสอบเอกสารโดย",
      requested: payload?.signature?.requested || "ร้องขอโดย",
    },
    footer_note:
      payload?.footer_note ||
      payload?.footerNote ||
      "* หมายเหตุ: กรุณาแนบเอกสารประกอบเมื่อยื่นแบบเบิกเงินสดย่อยคือต้นฉบับใบเสร็จรับเงิน/ใบกำกับภาษีที่ระบุชื่อบริษัทและที่อยู่อย่างถูกต้อง",
  };
}

function normalizePettyCashPaymentReportPayload(payload) {
  const rawRows = Array.isArray(payload?.rows) ? payload.rows : Array.isArray(payload?.items) ? payload.items : [];

  const mapped = rawRows.map((r, idx) => {
    const receive = round2(parseNumberLoose(r?.receive ?? r?.rec ?? r?.in ?? r?.income));
    const pay = round2(parseNumberLoose(r?.pay ?? r?.paid ?? r?.out ?? r?.expense ?? r?.amount));

    return {
      no: r?.no ?? idx + 1,
      date: r?.date || r?.doc_date || r?.docDate || "",
      doc_no: r?.doc_no || r?.docNo || r?.document_no || r?.documentNo || "",
      description: r?.description || r?.desc || r?.detail || r?.name || "",
      receive,
      pay,
      signature: r?.signature || r?.sign || "",
      has_receive: Boolean(receive),
      has_pay: Boolean(pay),
    };
  });

  const desiredRows = Math.max(0, Number(payload?.table_rows || payload?.tableRows || 22));
  const rows = [];
  for (let i = 0; i < desiredRows; i++) {
    const r = mapped[i];
    if (r) rows.push(r);
    else {
      rows.push({
        no: "",
        date: "",
        doc_no: "",
        description: "",
        receive: 0,
        pay: 0,
        signature: "",
        has_receive: false,
        has_pay: false,
      });
    }
  }

  const totalsComputed = mapped.reduce(
    (acc, r) => {
      acc.total_receive += Number(r.receive || 0);
      acc.total_pay += Number(r.pay || 0);
      return acc;
    },
    { total_receive: 0, total_pay: 0 }
  );

  const total_receive = round2(
    parseNumberLoose(
      payload?.summary?.total_receive ??
        payload?.summary?.receive_total ??
        payload?.total_receive
    ) || totalsComputed.total_receive
  );

  const total_pay = round2(
    parseNumberLoose(
      payload?.summary?.total_pay ??
        payload?.summary?.pay_total ??
        payload?.total_pay
    ) || totalsComputed.total_pay
  );

  const cash_summary = round2(parseNumberLoose(payload?.summary?.cash_summary ?? payload?.summary?.cashSummary));
  const carry_forward = round2(parseNumberLoose(payload?.summary?.carry_forward ?? payload?.summary?.carryForward));

  return {
    css_inline: cssInline,
    company: normalizeCompany(payload),
    report: {
      month: payload?.report?.month || payload?.month || "",
      year_be: payload?.report?.year_be || payload?.report?.yearBE || payload?.year_be || payload?.yearBE || "",
      payer_name: payload?.report?.payer_name || payload?.report?.payerName || payload?.payer_name || payload?.payerName || "",
      report_date: payload?.report?.report_date || payload?.report?.reportDate || payload?.report_date || payload?.reportDate || "",
      department: payload?.report?.department || payload?.report?.dept || payload?.department || payload?.dept || "",
    },
    rows,
    summary: {
      total_receive,
      total_pay,
      cash_summary: cash_summary || 0,
      carry_forward: carry_forward || 0,
    },
    notes: payload?.notes || payload?.note || payload?.remark || "",
  };
}

function normalizePayrollSlipPayload(payload) {
  const slip = payload?.slip || payload || {};

  // Format Thai date "01-31 พ.ค. 2569"
  function fmtThaiDate(d) {
    if (!d) return "";
    try {
      const date = new Date(d);
      return date.toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" });
    } catch { return String(d); }
  }

  const period_start = payload?.schedule?.period_start || payload?.period_start || "";
  const period_end   = payload?.schedule?.period_end   || payload?.period_end   || "";
  const payment_date = payload?.schedule?.payment_date || payload?.payment_date || "";

  const period = period_start && period_end
    ? `${fmtThaiDate(period_start)} — ${fmtThaiDate(period_end)}`
    : payload?.period || "";

  // Bank account from employee_bank_accounts (first row)
  const bankAcc = Array.isArray(payload?.bank_accounts) ? payload.bank_accounts[0] : null;
  const bank_account = bankAcc
    ? `${bankAcc.account_number || ""}${bankAcc.bank_name ? " (" + bankAcc.bank_name + ")" : ""}`
    : payload?.bank_account || "";

  // YTD totals (ส่งมาจาก frontend หรือ default 0)
  const ytd = {
    earnings: round2(parseNumberLoose(payload?.ytd?.earnings ?? payload?.ytd_earnings ?? 0)),
    tax:      round2(parseNumberLoose(payload?.ytd?.tax      ?? payload?.ytd_tax      ?? 0)),
    sso:      round2(parseNumberLoose(payload?.ytd?.sso      ?? payload?.ytd_sso      ?? 0)),
  };

  const deduct_absence = round2(
    parseNumberLoose(slip?.deduct_absent ?? 0) + parseNumberLoose(slip?.deduct_late ?? 0)
  );

  // derive year (Buddhist Era) from period_end or current year
  let year = "";
  try {
    const d = period_end ? new Date(period_end) : new Date();
    year = String(d.getFullYear() + 543);
  } catch { year = ""; }

  // ─── Aggregate fields (fallback only when no slip_lines) ─────────────────
  const earn_base    = round2(parseNumberLoose(slip?.earn_base    ?? slip?.salary_rate ?? 0));
  const earn_ot      = round2(parseNumberLoose(slip?.earn_ot      ?? 0));
  const earn_other   = round2(parseNumberLoose(slip?.earn_other   ?? 0));
  const deduct_sso   = round2(parseNumberLoose(slip?.deduct_sso   ?? 0));
  const deduct_tax   = round2(parseNumberLoose(slip?.deduct_tax   ?? 0));
  const deduct_loan  = round2(parseNumberLoose(slip?.deduct_loan  ?? 0));
  const deduct_other = round2(parseNumberLoose(slip?.deduct_other ?? 0));

  const toDisplayLine = (line, fallbackName, fallbackNameEn = "") => ({
    name: line?.earn_deduct_name || fallbackName,
    nameEn: line?.earn_deduct_code || fallbackNameEn || "",
    amount: round2(parseNumberLoose(line?.amount ?? 0)),
    isBlank: false,
  });

  const blankLine = { name: "", nameEn: "", amount: null, isBlank: true };

  const rawLines = Array.isArray(payload?.lines)
    ? [...payload.lines].sort((left, right) => {
        const leftSort = Number(left?.sort_order ?? 0);
        const rightSort = Number(right?.sort_order ?? 0);
        return leftSort - rightSort;
      })
    : [];

  let incomeLines = rawLines
    .filter((line) => line?.item_type === "income")
    .map((line) => toDisplayLine(line, "รายได้", "INCOME"));

  let deductionLines = rawLines
    .filter((line) => line?.item_type === "deduction")
    .map((line) => toDisplayLine(line, "รายการหัก", "DEDUCTION"));

  if (incomeLines.length === 0 && deductionLines.length === 0) {
    incomeLines = [
      { name: "เงินเดือน/ค่าจ้าง", nameEn: "BASE", amount: earn_base, isBlank: false },
      { name: "ค่าล่วงเวลา", nameEn: "OT", amount: earn_ot, isBlank: false },
      { name: "รายได้อื่น", nameEn: "OTHER", amount: earn_other, isBlank: false },
    ].filter((line) => line.amount !== 0);

    deductionLines = [
      { name: "ประกันสังคม", nameEn: "SSO", amount: deduct_sso, isBlank: false },
      { name: "ภาษีหัก ณ ที่จ่าย", nameEn: "TAX", amount: deduct_tax, isBlank: false },
      { name: "เงินกู้ยืม", nameEn: "LOAN", amount: deduct_loan, isBlank: false },
      { name: "ขาด/ลา/มาสาย", nameEn: "ABSENT", amount: deduct_absence, isBlank: false },
      { name: "รายการหักอื่น", nameEn: "OTHER", amount: deduct_other, isBlank: false },
    ].filter((line) => line.amount !== 0);
  }

  const total_earnings   = round2(parseNumberLoose(slip?.total_earnings   ?? 0));
  const total_deductions = round2(parseNumberLoose(slip?.total_deductions ?? 0));
  const net_pay          = round2(parseNumberLoose(slip?.net_pay          ?? 0));

  const ytdRows = [
    { name: "เงินได้สะสม", nameEn: "YTD earnings", amount: ytd.earnings, isBold: false, isNetPay: false, isBlank: false },
    { name: "ภาษีหัก ณ ที่จ่ายสะสม", nameEn: "YTD withholding tax", amount: ytd.tax, isBold: false, isNetPay: false, isBlank: false },
    { name: "เงินประกันสังคมสะสม", nameEn: "Accumulated SSF", amount: ytd.sso, isBold: false, isNetPay: false, isBlank: false },
    { name: "รวมเงินได้", nameEn: "Total earnings", amount: total_earnings, isBold: true, isNetPay: false, isBlank: false, toneClass: "summary-positive-row" },
    { name: "รวมรายการหัก", nameEn: "Total deductions", amount: total_deductions, isBold: true, isNetPay: false, isBlank: false, toneClass: "summary-negative-row" },
    { name: "เงินได้สุทธิ", nameEn: "Net pay", amount: net_pay, isBold: true, isNetPay: true, isBlank: false, noteText: `(${thaiBahtText(net_pay)})` },
  ];

  const rowCount = Math.max(incomeLines.length, deductionLines.length, ytdRows.length);
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    income: incomeLines[index] || blankLine,
    deduct: deductionLines[index] || blankLine,
    ytd: ytdRows[index] || blankLine,
  }));

  return {
    company: normalizeCompany(payload),
    slip: {
      employee_code:   slip?.employee_code   || "",
      full_name_th:    slip?.full_name_th    || "",
      position:        slip?.position        || "",
      department_name: slip?.department_name || "",
      note:            slip?.note            || "",
    },
    rows,
    period,
    payment_date: fmtThaiDate(payment_date),
    bank_account,
    year,
    ytd,
  };
}

// =========================
// Puppeteer: browser singleton
// =========================
let _browser = null;

async function ensureBrowser() {
  if (_browser) {
    logInfo("PUPPETEER", "reuse existing browser instance");
    return _browser;
  }

  logInfo("PUPPETEER", "launch browser...");
  _browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--font-render-hinting=medium",
      "--disable-dev-shm-usage",
    ],
  });

  logSuccess("PUPPETEER", "browser launched");
  return _browser;
}

async function htmlToPdfBuffer(html, opts = {}, req = null) {
  const logStep = req?.logStep || (() => {});
  const browser = await ensureBrowser();
  const page = await browser.newPage();

  const mediaType = opts?.mediaType || "screen";
  const pdfOverrides = opts?.pdfOptions || {};

  try {
    logStep("PDF:PAGE_OPEN", "create new page");
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 2 });
    await page.emulateMediaType(mediaType);

    logStep("PDF:SET_CONTENT", `html size ${formatBytes(Buffer.byteLength(html || "", "utf8"))}`);
    await page.setContent(html, { waitUntil: ["domcontentloaded", "networkidle0"] });

    logStep("PDF:FONTS_READY", "waiting document.fonts.ready");
    await page.evaluateHandle("document.fonts.ready");

    const defaultPdfOptions = {
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
    };

    const merged = {
      ...defaultPdfOptions,
      ...pdfOverrides,
      margin: pdfOverrides?.margin
        ? { ...defaultPdfOptions.margin, ...pdfOverrides.margin }
        : defaultPdfOptions.margin,
    };

    logStep(
      "PDF:RENDER",
      `format=${merged.format || "A4"} media=${mediaType} landscape=${Boolean(merged.landscape)}`
    );

    const pdfBuffer = await page.pdf(merged);
    logStep("PDF:BUFFER_READY", `pdf size ${formatBytes(pdfBuffer?.length || 0)}`);
    return pdfBuffer;
  } finally {
    logStep("PDF:PAGE_CLOSE", "close page");
    await page.close().catch(() => {});
  }
}

// graceful shutdown
async function shutdown(signal = "SIGTERM") {
  try {
    logWarn("SHUTDOWN", `received ${signal}, closing server resources...`, { signal });

    if (_browser) {
      logInfo("PUPPETEER", "closing browser...");
      await _browser.close();
      logSuccess("PUPPETEER", "browser closed");
    }
  } catch (e) {
    logErrorBlock("SHUTDOWN_FAILED", e);
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (err) => {
  logErrorBlock("UNCAUGHT_EXCEPTION", err);
});

process.on("unhandledRejection", (reason) => {
  logErrorBlock("UNHANDLED_REJECTION", reason instanceof Error ? reason : new Error(String(reason)));
});

// =========================
// Route helpers (ลดซ้ำ)
// =========================
function renderHtml(templateFn, normalizer, req, res) {
  req.logStep("NORMALIZE", `payload ${formatBytes(safeJsonSize(req.body || {}))}`);
  const data = normalizer(req.body || {});

  req.logStep("TEMPLATE", "render html");
  const html = templateFn(data);

  req.logStep("RESPOND_HTML", `html size ${formatBytes(Buffer.byteLength(html || "", "utf8"))}`);
  res.type("html").send(html);
}

async function renderPdf(templateFn, normalizer, filename, req, res, renderOptions = {}) {
  req.logStep("NORMALIZE", `payload ${formatBytes(safeJsonSize(req.body || {}))}`);
  const data = normalizer(req.body || {});

  req.logStep("TEMPLATE", "render html before pdf");
  const html = templateFn(data);

  const pdf = await htmlToPdfBuffer(html, renderOptions, req);

  req.logStep("RESPOND_PDF", `filename=${filename}`);
  writeMonitorLog({
    level: "PDF_RESPONSE",
    reqId: req.reqId,
    route: routeLabelFromPath(req.originalUrl),
    method: req.method,
    url: req.originalUrl,
    filename,
    pdfBytes: pdf?.length || 0,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.send(pdf);
}

function makeDocRoutes({ basePath, templateFn, normalizer, filename, renderOptions }) {
  app.post(`${basePath}/preview`, (req, res) => {
    try {
      req.logStep("ROUTE", "preview mode");
      renderHtml(templateFn, normalizer, req, res);
    } catch (err) {
      logErrorBlock("HTML_RENDER_FAILED", err, req.reqId, {
        route: routeLabelFromPath(req.originalUrl),
        method: req.method,
        url: req.originalUrl,
      });
      res.status(500).json({ error: "HTML_RENDER_FAILED", message: err?.message || String(err) });
    }
  });

  app.post(`${basePath}/pdf`, async (req, res) => {
    try {
      req.logStep("ROUTE", "pdf mode");
      await renderPdf(templateFn, normalizer, filename, req, res, renderOptions);
    } catch (err) {
      logErrorBlock("PDF_GENERATION_FAILED", err, req.reqId, {
        route: routeLabelFromPath(req.originalUrl),
        method: req.method,
        url: req.originalUrl,
      });
      res.status(500).json({ error: "PDF_GENERATION_FAILED", message: err?.message || String(err) });
    }
  });
}

// =========================
// Routes
// =========================
app.get("/health", (req, res) => {
  req.logStep("HEALTH", "ok");
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/debug/css", (req, res) => {
  req.logStep("DEBUG_CSS", cssInline ? "css inline loaded" : "css inline missing");
  res
    .type("text")
    .send(
      cssInline
        ? "✅ css inline loaded"
        : "❌ css inline missing: public/css/quotation.css (ไม่จำเป็นถ้า CSS อยู่ใน hbs แล้ว)"
    );
});

// ----- Quotation -----
makeDocRoutes({
  basePath: "/tpr-quotation",
  templateFn: templates.quotation,
  normalizer: normalizeQuotationPayload,
  filename: "tpr_quotation.pdf",
});

// ----- Credit Note / Tax Invoice -----
makeDocRoutes({
  basePath: "/tpr-credit-note",
  templateFn: templates.credit_note,
  normalizer: normalizeCreditNotePayload,
  filename: "tpr_credit_note.pdf",
});

// ----- Invoice / Billing -----
makeDocRoutes({
  basePath: "/tpr-invoice",
  templateFn: templates.invoice,
  normalizer: normalizeInvoicePayload,
  filename: "tpr_invoice.pdf",
});

// ----- Purchase Order / Work Order -----
makeDocRoutes({
  basePath: "/tpr-purchase-order",
  templateFn: templates.purchase_order,
  normalizer: normalizePurchaseOrderPayload,
  filename: "tpr_purchase_order.pdf",
});

// ----- Receipt -----
makeDocRoutes({
  basePath: "/tpr-receipt",
  templateFn: templates.receipt,
  normalizer: normalizeReceiptPayload,
  filename: "tpr_receipt.pdf",
});

// ----- Tax Receipt (Tax invoice / Receipt) -----
makeDocRoutes({
  basePath: "/tpr-tax-receipt",
  templateFn: templates.tax_receipt,
  normalizer: normalizeTaxReceiptPayload,
  filename: "tpr_tax_receipt.pdf",
});

// ----- Withholding Tax Certificate (50 ทวิ) -----
makeDocRoutes({
  basePath: "/tpr-withholding-tax-certificate",
  templateFn: templates.withholding_tax_certificate,
  normalizer: normalizeWithholdingTaxCertificatePayload,
  filename: "tpr_withholding_tax_certificate.pdf",
  renderOptions: {
    mediaType: "print",
  },
});

// ----- Payment Voucher -----
makeDocRoutes({
  basePath: "/tpr-payment-voucher",
  templateFn: templates.payment_voucher,
  normalizer: normalizePaymentVoucherPayload,
  filename: "tpr_payment_voucher.pdf",
});

// ----- Receipt Voucher -----
makeDocRoutes({
  basePath: "/tpr-receipt-voucher",
  templateFn: templates.receipt_voucher,
  normalizer: normalizePaymentVoucherPayload,
  filename: "tpr_receipt_voucher.pdf",
});

// ----- Petty Cash Voucher -----
makeDocRoutes({
  basePath: "/tpr-petty-cash-voucher",
  templateFn: templates.petty_cash_voucher,
  normalizer: normalizePettyCashVoucherPayload,
  filename: "tpr_petty_cash_voucher.pdf",
});

// ----- Petty Cash Request Form (Landscape) -----
makeDocRoutes({
  basePath: "/tpr-petty-cash-request",
  templateFn: templates.petty_cash_request,
  normalizer: normalizePettyCashRequestPayload,
  filename: "tpr_petty_cash_request.pdf",
  renderOptions: {
    mediaType: "print",
    pdfOptions: {
      landscape: true,
      margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
    },
  },
});

// ----- Petty Cash Payment Detail Report -----
makeDocRoutes({
  basePath: "/tpr-petty-cash-payment-report",
  templateFn: templates.petty_cash_payment_report,
  normalizer: normalizePettyCashPaymentReportPayload,
  filename: "tpr_petty_cash_payment_report.pdf",
  renderOptions: {
    mediaType: "print",
  },
});

// ----- Receipt Certification (แทนใบเสร็จรับเงิน) -----
makeDocRoutes({
  basePath: "/tpr-receipt-certification",
  templateFn: templates.receipt_certification,
  normalizer: normalizeReceiptCertificationPayload,
  filename: "tpr_receipt_certification.pdf",
});

// ----- Payroll Slip (สลิปเงินเดือน) -----
makeDocRoutes({
  basePath: "/tpr-payroll-slip",
  templateFn: templates.payroll_slip,
  normalizer: normalizePayrollSlipPayload,
  filename: "tpr_payroll_slip.pdf",
  renderOptions: {
    pdfOptions: {
      format: "A4",
      landscape: true,
      margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
    },
  },
});

// 404 handler
app.use((req, res) => {
  req.logStep("NOT_FOUND", `${req.method} ${req.originalUrl}`);
  res.status(404).json({
    error: "NOT_FOUND",
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// global error handler
app.use((err, req, res, next) => {
  logErrorBlock("EXPRESS_GLOBAL_ERROR", err, req?.reqId || "", {
    route: req?.originalUrl || "",
    method: req?.method || "",
  });

  if (res.headersSent) return next(err);

  res.status(500).json({
    error: "INTERNAL_SERVER_ERROR",
    message: err?.message || "Unknown error",
  });
});

app.listen(PORT, () => {
  cleanupOldLogs(14);
  logBanner();

  console.log(color("🌐 Server URL", ANSI.bold, ANSI.green), color(`http://localhost:${PORT}`, ANSI.white));
  console.log(color("❤️  Health    ", ANSI.bold, ANSI.green), color(`http://localhost:${PORT}/health`, ANSI.white));
  console.log(color("🧪 Debug CSS ", ANSI.bold, ANSI.green), color(`http://localhost:${PORT}/debug/css`, ANSI.white));
  hr();
  console.log(color("POST ROUTES", ANSI.bold, ANSI.magenta));
  console.log(color("  /tpr-quotation/pdf", ANSI.white));
  console.log(color("  /tpr-credit-note/pdf", ANSI.white));
  console.log(color("  /tpr-invoice/pdf", ANSI.white));
  console.log(color("  /tpr-purchase-order/pdf", ANSI.white));
  console.log(color("  /tpr-receipt/pdf", ANSI.white));
  console.log(color("  /tpr-tax-receipt/pdf", ANSI.white));
  console.log(color("  /tpr-withholding-tax-certificate/pdf", ANSI.white));
  console.log(color("  /tpr-payment-voucher/pdf", ANSI.white));
  console.log(color("  /tpr-receipt-voucher/pdf", ANSI.white));
  console.log(color("  /tpr-petty-cash-voucher/pdf", ANSI.white));
  console.log(color("  /tpr-petty-cash-request/pdf", ANSI.white));
  console.log(color("  /tpr-petty-cash-payment-report/pdf", ANSI.white));
  console.log(color("  /tpr-receipt-certification/pdf", ANSI.white));
  hr();
  logSuccess("READY", "PDF server is running", {
    port: PORT,
    logFile: getLogFilePath(),
  });

  writeMonitorLog({
    level: "BOOT",
    message: "PDF server is running",
    port: PORT,
    logFile: getLogFilePath(),
  });
});