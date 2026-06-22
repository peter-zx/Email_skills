#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SCAN_DIR = path.join(ROOT, 'scan-results');
const DOWNLOAD_DIR = path.join(SCAN_DIR, 'downloads');
const ARCHIVE_DIR = path.join(ROOT, 'archive');
const dateTag = process.argv[2] || '';

const BUYER_KEYWORDS = [
  ['武汉市硚口区融爱日用品经营部', '融爱'],
  ['融爱', '融爱'],
  ['武汉惠浮德锦人力资源服务有限公司', '惠浮德锦'],
  ['惠浮德锦', '惠浮德锦'],
  ['武汉市江岸区厚德济困服务中心', '厚德济困'],
  ['厚德济困', '厚德济困'],
  ['个人报销', '个人报销'],
];

function normalizeBuyerName(value) {
  const text = String(value || '').trim();
  if (text.includes('武汉市硚口区融爱日用品经营部')) return '武汉市硚口区融爱日用品经营部（个体工商户）';
  if (text.includes('武汉惠浮德锦')) return '武汉惠浮德锦人力资源服务有限公司';
  if (text.includes('武汉市江岸区厚德济困服务中心')) return '武汉市江岸区厚德济困服务中心';
  if (text.includes('竹相创意')) return '竹相创意（武汉）文化科技有限公司';
  return text;
}

function findLatest(dir, prefix) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .filter(f => !dateTag || f.includes(dateTag))
    .sort()
    .reverse();
  return files[0] ? path.join(dir, files[0]) : null;
}

function safe(value, fallback = '待确认') {
  let text = String(value || fallback).trim();
  text = text.replace(/[\r\n\t]/g, ' ');
  text = text.replace(/[\\/:*?"<>|]/g, '_');
  text = text.replace(/\s+/g, ' ');
  return (text || fallback).slice(0, 80);
}

function parseDate(value) {
  const d = new Date(value || '');
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(value) {
  const d = parseDate(value);
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthTag(record) {
  const d = parseDate(record.invoiceDate || record.emailDate);
  if (d) return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const match = String(dateTag).match(/^(\d{6})/);
  return match ? match[1] : '月份待确认';
}

function buyerKeyword(buyer) {
  const text = String(buyer || '');
  for (const [needle, label] of BUYER_KEYWORDS) {
    if (text.includes(needle)) return label;
  }
  return text ? safe(text.slice(0, 8), '未知') : '未知';
}

function docType(record, item) {
  if (item.type === 'ofd') return 'OFD';
  if (item.type === 'image') return 'PNG';
  const text = `${record.docType || ''} ${record.subject || ''} ${item.filename || ''}`;
  if (text.includes('付款') || text.includes('滞纳')) return '付款通知';
  return '发票';
}

function invoiceSuffix(record, item) {
  const raw = record.invoiceNo || (item.filename || '').match(/(\d{20,})/)?.[1] || `uid${item.uid}`;
  return String(raw).slice(-6);
}

function uniquePath(file) {
  if (!fs.existsSync(file)) return file;
  const ext = path.extname(file);
  const base = file.slice(0, -ext.length);
  let index = 2;
  while (fs.existsSync(`${base}-${index}${ext}`)) index++;
  return `${base}-${index}${ext}`;
}

function qqMailLink(record) {
  if (!record.emailUid && !record.uid) return null;
  const uid = record.emailUid || record.uid;
  return `https://mail.qq.com/cgi-bin/frame_html?sid=&t=msglist&folderid=1&loc=myinbox#msg=${uid}`;
}

function copyFile(item, record) {
  const buyer = safe(normalizeBuyerName(record.buyer), '待确认购买方');
  const seller = safe(record.seller, '待确认销售方');
  const amount = record.amount ? Number(record.amount).toFixed(2) : '金额待确认';
  const keyword = buyerKeyword(buyer);
  const type = docType(record, item);
  const suffix = invoiceSuffix(record, item);
  const month = monthTag(record);
  const ext = path.extname(item.path || item.filename || '') || `.${item.type || 'file'}`;
  const fileName = safe(`${amount}_${keyword}_${suffix}_${type}_${month}`, `uid${item.uid}`) + ext;
  const targetDir = item.type === 'image'
    ? path.join(ARCHIVE_DIR, '待处理', '美团')
    : path.join(ARCHIVE_DIR, buyer, seller);
  fs.mkdirSync(targetDir, { recursive: true });
  const targetPath = uniquePath(path.join(targetDir, fileName));
  fs.copyFileSync(item.path, targetPath);
  return { buyer, seller, amount, keyword, type, suffix, month, targetPath };
}

function htmlEscape(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function dateRange(rows) {
  const dates = rows.map(r => parseDate(r.emailDate)).filter(Boolean);
  if (!dates.length) return { label: '未知', days: 0 };
  const min = new Date(Math.min(...dates.map(d => d.getTime())));
  const max = new Date(Math.max(...dates.map(d => d.getTime())));
  const days = Math.round((new Date(max.getFullYear(), max.getMonth(), max.getDate()) - new Date(min.getFullYear(), min.getMonth(), min.getDate())) / 86400000) + 1;
  const label = `${min.getFullYear()}/${String(min.getMonth() + 1).padStart(2, '0')}/${String(min.getDate()).padStart(2, '0')} ~ ${max.getFullYear()}/${String(max.getMonth() + 1).padStart(2, '0')}/${String(max.getDate()).padStart(2, '0')}`;
  return { label, days };
}

function copyButton(title) {
  const text = String(title || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return `<button class="copy-title" onclick="copyTitle(\`${htmlEscape(text)}\`)">📋复制标题</button>`;
}

function mailAction(row, anomaly = false) {
  if (anomaly) return copyButton(row.emailSubject || row.subject);
  const link = qqMailLink(row);
  return link ? `<a href="${htmlEscape(link)}">打开邮件</a>` : copyButton(row.emailSubject || row.subject);
}

function renderHtml(records, anomalies, outFile) {
  const allRows = [...records, ...anomalies];
  const range = dateRange(allRows);
  const byBuyer = new Map();
  for (const record of records) {
    if (!byBuyer.has(record.buyer)) byBuyer.set(record.buyer, []);
    byBuyer.get(record.buyer).push(record);
  }
  const sortedByTime = [...allRows].sort((a, b) => (parseDate(b.emailDate)?.getTime() || 0) - (parseDate(a.emailDate)?.getTime() || 0));

  const style = `<style>
:root{color-scheme:light;--ink:#172033;--muted:#667085;--line:#d8dee8;--soft:#f6f8fb;--brand:#1769e0;--warn:#b54708}
*{box-sizing:border-box}
body{font-family:Arial,"Microsoft YaHei",sans-serif;margin:0;color:var(--ink);background:#eef2f7}
main{max-width:1440px;margin:0 auto;padding:28px}
h1{margin:0 0 16px;font-size:28px;letter-spacing:0}
h2{margin:28px 0 10px;font-size:18px}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:12px 0 18px}
.metric{border:1px solid var(--line);background:#fff;padding:13px 14px;border-radius:8px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.metric b{display:block;font-size:20px;margin-top:4px}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 18px;padding:0}
button,.button-link{border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:7px;cursor:pointer;text-decoration:none}
.tab-button{padding:9px 13px}
.tab-button.active{background:var(--brand);color:#fff;border-color:var(--brand)}
.copy-title{padding:5px 9px;font-size:12px}
.tab{display:none}.tab.active{display:block}
.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:8px;background:#fff;margin-bottom:24px}
table{border-collapse:collapse;width:100%;min-width:980px;table-layout:auto}
th,td{border-bottom:1px solid #e8edf4;padding:9px 10px;font-size:13px;line-height:1.45;text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{background:#f8fafc;color:#475467;font-weight:600;white-space:nowrap}
tr:hover td{background:#f9fbff}
a{color:var(--brand);text-decoration:none}a:hover{text-decoration:underline}
.amount{text-align:right;font-variant-numeric:tabular-nums}.warn{color:var(--warn);font-weight:bold}.subject{max-width:420px;line-height:1.45}
</style>`;

  let html = `<!doctype html><meta charset="utf-8"><title>发票归档汇总</title>${style}<main><h1>发票归档汇总</h1>`;
  html += `<div class="summary"><div class="metric">PDF 条目<b>${records.length}</b></div><div class="metric">异常<b>${anomalies.length}</b></div><div class="metric">日期范围<b>${range.label}</b></div><div class="metric">覆盖天数<b>${range.days}</b></div></div>`;
  html += `<div class="tabs"><button class="tab-button active" onclick="showTab('buyer',this)">按购买方分组</button><button class="tab-button" onclick="showTab('time',this)">按邮件时间倒序</button><button class="tab-button" onclick="showTab('anomaly',this)">仅异常项</button></div>`;

  html += `<div id="buyer" class="tab active">`;
  for (const [buyer, items] of byBuyer.entries()) {
    html += `<h2>${htmlEscape(buyer)}</h2><div class="table-wrap"><table><tr><th>销售方</th><th>金额</th><th>后6位</th><th>类型</th><th>月份</th><th>邮件标题</th><th>邮件时间</th><th>文件</th><th>邮件</th></tr>`;
    for (const r of items) {
      html += `<tr><td>${htmlEscape(r.seller)}</td><td class="amount">${htmlEscape(r.amount)}</td><td>${htmlEscape(r.suffix)}</td><td>${htmlEscape(r.type)}</td><td>${htmlEscape(r.month)}</td><td class="subject">${htmlEscape(r.emailSubject || r.subject)}</td><td>${htmlEscape(formatDate(r.emailDate))}</td><td><a href="${htmlEscape(path.relative(path.dirname(outFile), r.targetPath))}">打开</a></td><td>${mailAction(r)}</td></tr>`;
    }
    html += `</table></div>`;
  }
  html += `</div>`;

  html += `<div id="time" class="tab"><div class="table-wrap"><table><tr><th>邮件时间</th><th>邮件标题</th><th>购买方</th><th>销售方</th><th>金额</th><th>类型</th><th>月份</th><th>文件/状态</th><th>邮件/搜索</th></tr>`;
  for (const r of sortedByTime) {
    const isAnomaly = Boolean(r.status);
    const fileCell = r.targetPath ? `<a href="${htmlEscape(path.relative(path.dirname(outFile), r.targetPath))}">打开</a>` : `<span class="warn">${htmlEscape(r.status || r.reason)}</span>`;
    html += `<tr><td>${htmlEscape(formatDate(r.emailDate))}</td><td class="subject">${htmlEscape(r.emailSubject || r.subject)}</td><td>${htmlEscape(r.buyer)}</td><td>${htmlEscape(r.seller)}</td><td class="amount">${htmlEscape(r.amount || '')}</td><td>${htmlEscape(r.type || '')}</td><td>${htmlEscape(r.month || '')}</td><td>${fileCell}</td><td>${mailAction(r, isAnomaly)}</td></tr>`;
  }
  html += `</table></div></div>`;

  html += `<div id="anomaly" class="tab"><div class="table-wrap"><table><tr><th>异常标记</th><th>UID</th><th>邮件标题</th><th>邮件时间</th><th>建议</th><th>文件/复制标题</th></tr>`;
  for (const r of anomalies) {
    const target = r.targetPath ? `<a href="${htmlEscape(path.relative(path.dirname(outFile), r.targetPath))}">打开文件</a> ${copyButton(r.emailSubject || r.subject)}` : copyButton(r.emailSubject || r.subject);
    html += `<tr><td class="warn">${htmlEscape(r.status)}</td><td>${htmlEscape(r.uid)}</td><td class="subject">${htmlEscape(r.emailSubject || r.subject)}</td><td>${htmlEscape(formatDate(r.emailDate))}</td><td>${htmlEscape(r.advice)}</td><td>${target}</td></tr>`;
  }
  html += `</table></div></div>`;

  html += `<script>
function showTab(id,btn){document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.getElementById(id).classList.add('active');document.querySelectorAll('.tab-button').forEach(x=>x.classList.remove('active'));btn.classList.add('active')}
function copyTitle(text){if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(text).then(()=>alert('已复制邮件标题'));return}const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.left='-9999px';document.body.appendChild(ta);ta.focus();ta.select();document.execCommand('copy');ta.remove();alert('已复制邮件标题')}
</script></main>`;
  fs.writeFileSync(outFile, html, 'utf8');
}

function main() {
  const finalFile = findLatest(SCAN_DIR, 'invoice-final-');
  const downloadFile = findLatest(DOWNLOAD_DIR, 'download-results-');
  if (!finalFile) throw new Error('Missing invoice-final JSON. Run step4 first.');
  if (!downloadFile) throw new Error('Missing download-results JSON. Run step2 first.');

  const finalData = JSON.parse(fs.readFileSync(finalFile, 'utf8'));
  const downloadData = JSON.parse(fs.readFileSync(downloadFile, 'utf8'));
  const byUid = new Map((finalData.data || []).map(r => [String(r.emailUid), r]));
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

  const records = [];
  const anomalies = [];
  const uidHasPdf = new Set((downloadData.downloaded || [])
    .filter(item => item.type === 'pdf' || item.type === 'link')
    .map(item => String(item.uid)));
  for (const item of downloadData.downloaded || []) {
    if (item.type === 'ofd') continue;
    if (item.type === 'image' && uidHasPdf.has(String(item.uid))) continue;
    const record = byUid.get(String(item.uid)) || {};
    if (!item.path || !fs.existsSync(item.path)) {
      anomalies.push({
        status: 'link_anomaly',
        uid: item.uid,
        subject: record.subject || item.filename,
        emailSubject: record.subject || item.filename,
        emailDate: record.emailDate,
        advice: '源文件缺失，需从邮箱手动下载',
      });
      continue;
    }
    const copied = copyFile(item, record);
    const row = {
      uid: item.uid,
      emailUid: item.uid,
      subject: record.subject || '',
      emailSubject: record.subject || '',
      emailDate: record.emailDate,
      emailHyperlink: record.emailHyperlink,
      sourcePath: item.path,
      targetPath: copied.targetPath,
      ...copied,
    };
    if (item.type === 'image') {
      anomalies.push({ ...row, status: 'png_anomaly', advice: 'PNG 图片发票，需 OCR 或人工扫码识别金额' });
    } else {
      records.push(row);
    }
  }

  for (const record of finalData.data || []) {
    if (record.needsManualReview && ![...records, ...anomalies].some(r => String(r.uid) === String(record.emailUid))) {
      anomalies.push({
        status: record.manualReason || record.status || 'needs-manual',
        uid: record.emailUid,
        emailUid: record.emailUid,
        subject: record.subject,
        emailSubject: record.subject,
        emailDate: record.emailDate,
        emailHyperlink: record.emailHyperlink,
        advice: record.manualReason === 'LINK_NEED_SCAN' ? '链接发票需人工打开或扫码' : '人工核对邮件',
      });
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceFinalFile: path.relative(ROOT, finalFile),
    sourceDownloadFile: path.relative(ROOT, downloadFile),
    rule: 'archive/{buyer}/{seller}/{amount}_{buyerKeyword}_{invoiceNoLast6}_{type}_{month}.{ext}; PNG => archive/待处理/美团/',
    archived: records.length,
    anomalies: anomalies.length,
    records: records.map(r => ({ ...r, sourcePath: path.relative(ROOT, r.sourcePath), targetPath: path.relative(ROOT, r.targetPath) })),
    anomalyRecords: anomalies.map(r => ({ ...r, sourcePath: r.sourcePath ? path.relative(ROOT, r.sourcePath) : null, targetPath: r.targetPath ? path.relative(ROOT, r.targetPath) : null })),
  };
  fs.writeFileSync(path.join(ARCHIVE_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  renderHtml(records, anomalies, path.join(ARCHIVE_DIR, 'index.html'));
  console.log(`Archived files: ${records.length}`);
  console.log(`Anomalies: ${anomalies.length}`);
  console.log(`Archive: ${ARCHIVE_DIR}`);
  console.log(`Summary: ${path.join(ARCHIVE_DIR, 'index.html')}`);
}

main();
