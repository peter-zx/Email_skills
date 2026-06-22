#!/usr/bin/env node
/**
 * merge-link-to-pipeline.js
 * 将 handle-link-invoices.js 的结果合并到主管线
 */
var fs=require('fs'),path=require('path');
var base='C:\\Users\\Administrator\\Desktop\\0608\\finance-scripts';

var results=JSON.parse(fs.readFileSync(path.join(base,'scan-results','link-invoice-results.json'),'utf8'));
var extractFile=path.join(base,'scan-results','pdf-text-2026-06-18.json');
var d=JSON.parse(fs.readFileSync(extractFile,'utf8'));

// 收集已有uid
var existingUids=new Set();
d.results.forEach(function(r){ if(r.uid) existingUids.add(r.uid); });

var added=0;
results.results.forEach(function(r){
  if(!r.invoiceInfo) return;
  if(existingUids.has(r.uid)){ console.log('Skip existing UID',r.uid); return; }
  
  var info=r.invoiceInfo;
  // Clean up names
  var buyer=info.buyer||'';
  var seller=info.seller||'';
  
  // Determine filename
  var pdfDir=path.join(base,'scan-results','downloads','pdfs');
  var pdfFile=null;
  try{
    var files=fs.readdirSync(pdfDir).filter(function(f){return f.startsWith('uid'+r.uid+'_')});
    if(files.length>0) pdfFile=files[0];
  }catch(e){}
  
  d.results.push({
    docType:'发票',
    buyer:buyer,
    seller:seller,
    amount:parseFloat(info.amount)||0,
    date:info.invoiceDate||r.date||'',
    invoiceNo:info.invoiceNo||null,
    taxAmount:null,
    _extracted:'链接发票→自动',
    _reExtracted:true,
    filename:pdfFile||('uid'+r.uid+'.pdf'),
    filepath:pdfFile?path.join(pdfDir,pdfFile):'',
    fullText:'<链接发票，元数据来自邮件正文>',
    rawLength:0,
    extractedAt:new Date().toISOString(),
    _emailSubject:r.subject||'',
    _emailDate:r.date||'',
    _emailFrom:r.from||'',
    uid:r.uid
  });
  
  existingUids.add(r.uid);
  added++;
  console.log('Added UID',r.uid,buyer.substring(0,20),'←',seller.substring(0,20),'¥'+info.amount);
});

if(added>0){
  fs.writeFileSync(extractFile,JSON.stringify(d,null,2),'utf8');
  console.log('\nSaved',added,'new records. Total:',d.results.length);
  
  // Update email data
  var emailFile=path.join(base,'scan-results','emails','emails-v3-1781765398381-20260601-20260618.json');
  if(fs.existsSync(emailFile)){
    var em=JSON.parse(fs.readFileSync(emailFile,'utf8'));
    var emUids=new Set(em.emails.map(function(e){return e.uid}));
    results.results.forEach(function(r){
      if(!emUids.has(r.uid)){
        em.emails.push({
          uid:r.uid,
          subject:r.subject||'',
          date:r.date||'',
          from:r.from||'',
          status:'ok',
          _linkInvoice:true,
          buyer:r.invoiceInfo?r.invoiceInfo.buyer:'',
          seller:r.invoiceInfo?r.invoiceInfo.seller:'',
          amount:r.invoiceInfo?parseFloat(r.invoiceInfo.amount):0
        });
        emUids.add(r.uid);
      }else{
        // Update existing
        var existing=em.emails.find(function(e){return e.uid===r.uid});
        if(existing){
          existing.status='ok';
          existing._linkInvoice=true;
          existing.buyer=r.invoiceInfo?r.invoiceInfo.buyer:'';
          existing.seller=r.invoiceInfo?r.invoiceInfo.seller:'';
          existing.amount=r.invoiceInfo?parseFloat(r.invoiceInfo.amount):0;
        }
      }
    });
    fs.writeFileSync(emailFile,JSON.stringify(em,null,2),'utf8');
    console.log('Updated email file, now',em.emails.length,'emails');
  }
} else {
  console.log('No new records to add (all already exist)');
}
