#!/usr/bin/env node
/**
 * handle-link-invoices.js v2 — 智能链接发票处理器
 *
 * 支持两种发票源：
 *   A. 湖北航天信息 (Aisino@www.fpsaas.cn) — HTML正文内含发票字段 + dzfp.hbbidding.com.cn 中间页
 *   B. 百旺金穗云 (dzfpfwpt@hnfapiao.com) — 正文含下载链接 + 中间页
 *
 * 新增功能：
 *   - 从邮件正文直接提取发票元数据（不再依赖PDF无附件）
 *   - 跟随二阶段链接下载PDF（中间页→真实PDF链接）
 *   - 输出增强邮件JSON供后续环节
 */

const Imap = require('imap');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { getImapConfig, getMailbox } = require('./lib/env');

const BASE = __dirname;
const EMAILS_DIR = path.join(BASE, 'scan-results', 'emails');
const PDF_DIR = path.join(BASE, 'scan-results', 'downloads', 'pdfs');
const OUT_FILE = path.join(BASE, 'scan-results', 'link-invoice-results.json');

if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });

const IMAP_CONFIG = getImapConfig();
const MAILBOX = getMailbox();

// ===== 工具函数 =====
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
      'Accept': 'text/html,application/pdf,*/*',
      ...opts.headers
    };
    const req = mod.get(url, { headers, timeout: opts.timeout || 15000, rejectUnauthorized: false }, res => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        let next = res.headers.location;
        if (!next.startsWith('http')) next = `${u.protocol}//${u.host}${next.startsWith('/') ? '' : '/'}${next}`;
        return resolve(httpGet(next, { ...opts, timeout: (opts.timeout||15000) }));
      }
      const bufs = [];
      res.on('data', c => bufs.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(bufs) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

function stripHtml(html) {
  return (html||'').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

// ===== 邮件正文获取（逐个UID，健壮版） =====
function fetchOneEmailBody(uid) {
  return new Promise((resolve) => {
    const imap = new Imap(IMAP_CONFIG);
    let resolved = false;
    const done = (result) => { if (!resolved) { resolved = true; imap.end(); resolve(result); } };

    imap.once('error', (err) => done({ uid, error: 'imap_error: ' + err.message }));
    imap.once('ready', () => {
      imap.openBox(MAILBOX, true, (err) => {
        if (err) return done({ uid, error: 'openBox: ' + err.message });

        const fetcher = imap.fetch([uid], { bodies: '' });
        let body = '';
        let msgTimer = setTimeout(() => done({ uid, error: 'msg_timeout', bodyLength: body.length }), 45000);

        fetcher.on('message', msg => {
          msg.on('body', stream => {
            stream.on('data', c => { body += c.toString('utf8'); });
            stream.on('end', () => {
              clearTimeout(msgTimer);
              done({ uid, body, bodyLength: body.length });
            });
          });
          msg.on('error', (e) => {
            clearTimeout(msgTimer);
            done({ uid, error: 'msg_error: ' + e.message, bodyLength: body.length });
          });
        });
        fetcher.once('error', (e) => done({ uid, error: 'fetch_error: ' + e.message }));
      });
    });
    imap.connect();
  });
}

// ===== 解析器 =====

function parseInlineInvoice(html, subject, from) {
  const text = stripHtml(html);
  const info = {};
  
  // 模式1：购方名称/销方名称（湖北航天格式）
  let m = text.match(/购方名称[：:]\s*(.+?)(?:\s*销方|$)/);
  if (m) info.buyer = m[1].trim();
  
  m = text.match(/销方名称[：:]\s*(.+?)(?:\s*(?:发票|$))/);
  if (m) info.seller = m[1].trim();
  
  m = text.match(/发票号码[：:]\s*(\d{10,})/);
  if (m) info.invoiceNo = m[1];
  
  m = text.match(/开票日期[：:]\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s*\d{0,2}[:：]?\d{0,2}[:：]?\d{0,2})?)/);
  if (m) info.invoiceDate = m[1].trim();
  
  m = text.match(/开票金额[：:]\s*([\d,.]+)/);
  if (m) info.amount = m[1].replace(/,/g, '');
  
  // 模式2：购买方名称/销售方名称（百旺金穗云 + 通用数电格式）
  if (!info.buyer) {
    m = text.match(/购[买方]方[^：:]*名称[：:]\s*(.+?)(?:\s*(?:统一|金额|销方|发票|$))/);
    if (m) info.buyer = m[1].trim().replace(/\s+/g, '');
  }
  if (!info.seller) {
    m = text.match(/销[售方]方[^：:]*名称[：:]\s*(.+?)(?:\s*(?:统一|金额|购方|发票|$))/);
    if (m) info.seller = m[1].trim().replace(/\s+/g, '');
  }
  
  // 模式3：金额合计（百旺金穗云格式）
  if (!info.amount) {
    m = text.match(/金额合计[：:]\s*([\d,.]+)/);
    if (m) info.amount = m[1].replace(/,/g, '');
  }
  
  // 模式4：从主题提取销方（【湖北张记君君餐饮管理有限公司】格式）
  if (!info.seller && subject) {
    m = subject.match(/【(.+?)】/);
    if (m && m[1].length >= 4 && !/发票|号码|电子/.test(m[1])) info.seller = m[1];
  }
  if (!info.invoiceNo && subject) {
    m = subject.match(/发票号码[：:]\s*(\d{10,})/);
    if (m) info.invoiceNo = m[1];
  }
  
  // 从HTML中提取真正的下载链接（优先href中含download的，排除图片/QR/tracking）
  if (html) {
    // 优先：<a href> 中的 download 链接
    let downloadHrefs = [];
    const hrefRegex = /href=["'](https?:\/\/[^"']+?)["']/gi;
    let hm;
    while ((hm = hrefRegex.exec(html)) !== null) {
      downloadHrefs.push(hm[1].replace(/&amp;/g, '&'));
    }
    
    // 筛选：排除图片、tracking、unsubscribe
    downloadHrefs = downloadHrefs.filter(l =>
      !l.endsWith('.png') && !l.endsWith('.jpg') && !l.endsWith('.gif')
      && !l.includes('etrack01') && !l.includes('unsubscribe')
      && !l.includes('weixin') && !l.includes('mp.weixin')
    );
    
    // 优先选含 download/pdf 的
    let downloadLink = downloadHrefs.find(l => l.includes('download') || l.includes('.pdf'));
    if (!downloadLink) downloadLink = downloadHrefs.find(l => !l.includes('qq.com') && !l.includes('oss-cn'));
    if (!downloadLink && downloadHrefs.length > 0) downloadLink = downloadHrefs[0];
    
    if (downloadLink) info.downloadLink = downloadLink;
    
    // fallback：纯文本中的URL
    if (!info.downloadLink) {
      const textLinks = (text.match(/https?:\/\/[^\s]{10,}/g) || [])
        .filter(l => !l.endsWith('.png') && !l.endsWith('.jpg') && !l.includes('etrack01') && !l.includes('unsubscribe') && !l.includes('qq.com'));
      if (textLinks.length > 0) info.downloadLink = textLinks[0];
    }
  }
  
  // 清理buyer/seller中的杂项文本
  if (info.buyer && info.buyer.length > 30) info.buyer = info.buyer.split(/[，,\s]+/)[0];
  if (info.seller && info.seller.length > 30) info.seller = info.seller.split(/[，,\s]+/)[0];
  // 二次清理：去除明显不是公司名称的后缀
  const cleanup = (s) => {
    if (!s) return s;
    s = s.replace(/\s*购方名称.+$/,'').replace(/\s*金额合计.+$/,'').replace(/\s*发票号码.+$/,'');
    return s.trim();
  };
  if (info.buyer) info.buyer = cleanup(info.buyer);
  if (info.seller) info.seller = cleanup(info.seller);
  
  return Object.keys(info).filter(k => k !== 'downloadLink').length > 0 ? info : null;
}

function parseIntermediatePage(html) {
  // 匹配PDF下载链接（ifpxz.hbbidding.com.cn 格式）
  let m = html.match(/href=["'](https?:\/\/[^"']*?name=download[^"']*?t=1[^"']*?)["']/i);
  if (m) return m[1].replace(/&amp;/g, '&');
  
  // 其他可能的download link模式
  m = html.match(/href=["'](https?:\/\/[^"']*?(?:download|\.pdf)[^"']*?)["']/i);
  if (m) return m[1].replace(/&amp;/g, '&');
  
  return null;
}

// ===== 主流程 =====
async function main() {
  const args = process.argv.slice(2);
  const targetUid = args.length > 0 ? parseInt(args[0]) : null;
  
  // 1. 收集候选邮件
  const emailFiles = fs.readdirSync(EMAILS_DIR).filter(f => f.endsWith('.json'));
  const candidates = [];
  const seen = new Set();
  
  for (const fn of emailFiles) {
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(EMAILS_DIR, fn), 'utf8')); }
    catch(e) { continue; }
    
    const list = data.emails || data.results || (Array.isArray(data) ? data : []);
    if (!Array.isArray(list)) continue;
    
    for (const em of list) {
      if (targetUid) {
        if (em.uid !== targetUid) continue;
      } else {
        if (em.status !== 'needs-manual' && em.status !== 'pending-link') continue;
        const from = (em.from || '').toLowerCase();
        if (!from.includes('aisino') && !from.includes('fpsaas') 
          && !from.includes('dzfpfwpt') && !from.includes('hnfapiao')
          && !from.includes('百旺') && !from.includes('航天')) continue;
      }
      if (seen.has(em.uid)) continue;
      seen.add(em.uid);
      candidates.push(em);
    }
  }

  console.log(`链接发票候选: ${candidates.length} 封`);
  if (candidates.length === 0) {
    console.log('无候选。可指定UID: node handle-link-invoices.js <uid>');
    return;
  }

  const results = [];

  for (let i = 0; i < candidates.length; i++) {
    const em = candidates[i];
    console.log(`\n━━━ [${i+1}/${candidates.length}] UID ${em.uid}: ${em.subject || '(无主题)'} ━━━`);
    
    let body = em.body || '';
    
    // 2. 获取正文（如果为空或太短）
    if (body.length < 100) {
      console.log('  获取正文...');
      const fetched = await fetchOneEmailBody(em.uid);
      if (fetched.error) {
        console.log('  获取失败:', fetched.error);
        results.push({ uid: em.uid, status: 'fetch_failed', error: fetched.error });
        continue;
      }
      body = fetched.body;
      console.log('  获取成功:', fetched.bodyLength, 'bytes');
      await sleep(1000); // 避免IMAP限速
    }
    
    if (body.length < 100) {
      console.log('  正文仍然太短:', body.length);
      results.push({ uid: em.uid, status: 'body_too_short' });
      continue;
    }

    // 3. 解析为结构化邮件
    let parsed;
    try {
      parsed = await new Promise((res, rej) => {
        simpleParser(body, (err, r) => { if (err) rej(err); else res(r); });
      });
    } catch(e) {
      console.log('  simpleParser失败, 使用裸文本:', e.message);
    }

    const html = parsed ? (parsed.html || '') : '';
    const rawHtml = html || body;
    
    // 4. 提取内嵌元数据
    const subj = parsed ? parsed.subject : em.subject;
    const info = parseInlineInvoice(rawHtml, subj, em.from);
    if (!info) {
      console.log('  ❌ 未提取到元数据');
      results.push({ uid: em.uid, status: 'no_metadata', bodyPreview: stripHtml(rawHtml).substring(0, 200) });
      continue;
    }
    
    console.log(`  📋 ${info.buyer||'?'} ← ${info.seller||'?'} | ¥${info.amount||'?'}`);
    if (info.downloadLink) console.log(`  🔗 ${info.downloadLink}`);

    // 5. 跟随链接下载PDF
    if (info.downloadLink) {
      try {
        console.log('  访问链接页...');
        const page = await httpGet(info.downloadLink);
        const ct = (page.headers['content-type'] || '').toLowerCase();
        
        if (ct.includes('pdf') || ct.includes('octet')) {
          // 直接PDF
          const fn = `uid${em.uid}_${(info.seller||'unknown').replace(/[\/\\:*?"<>|]/g,'_').substring(0,40)}_${info.amount||'NA'}.pdf`;
          const fp = path.join(PDF_DIR, fn);
          fs.writeFileSync(fp, page.body);
          console.log(`  ✅ PDF直链: ${fn} (${page.body.length}B)`);
          info.downloadedPdf = fp;
        } else {
          // 中间页
          const pageHtml = page.body.toString('utf8');
          const realUrl = parseIntermediatePage(pageHtml);
          
          if (realUrl) {
            console.log(`  🔗 真实PDF: ${realUrl.substring(0,80)}...`);
            const pdfResp = await httpGet(realUrl, { timeout: 30000 });
            
            if (pdfResp.status === 200) {
              const fn = `uid${em.uid}_${(info.seller||'unknown').replace(/[\/\\:*?"<>|]/g,'_').substring(0,40)}_${info.amount||'NA'}.pdf`;
              const fp = path.join(PDF_DIR, fn);
              fs.writeFileSync(fp, pdfResp.body);
              console.log(`  ✅ PDF下载: ${fn} (${pdfResp.body.length}B)`);
              info.downloadedPdf = fp;
            } else {
              console.log(`  ❌ PDF下载失败 status=${pdfResp.status}`);
            }
          } else {
            console.log(`  ⚠️ 未找到真实PDF链接，页长${pageHtml.length}B`);
            // 保存中间页供调试
            const hp = path.join(PDF_DIR, `uid${em.uid}_intermediate.html`);
            fs.writeFileSync(hp, pageHtml, 'utf8');
            console.log(`  中间页已保存: ${hp}`);
          }
        }
      } catch(e) {
        console.log(`  ❌ 链接处理异常: ${e.message}`);
      }
    }

    results.push({
      uid: em.uid,
      date: em.date,
      subject: parsed ? parsed.subject : em.subject,
      from: em.from,
      invoiceInfo: info,
      status: info.downloadedPdf ? 'pdf_downloaded' : 'meta_only'
    });
  }

  // 6. 输出
  const output = { generatedAt: new Date().toISOString(), total: results.length, results };
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const ok = results.filter(r => r.invoiceInfo);
  const pdf = results.filter(r => r.invoiceInfo && r.invoiceInfo.downloadedPdf);
  console.log(`完成: ${results.length}封 | 含元数据: ${ok.length} | 已下载PDF: ${pdf.length}`);
  console.log(`结果: ${OUT_FILE}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
