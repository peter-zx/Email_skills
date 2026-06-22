---
name: email-invoice-pipeline
description: Process invoice-related emails from an IMAP mailbox, download invoice attachments or invoice links, extract PDF invoice fields, merge records by QQ mailbox UID, generate manual review tasks, create Excel invoice ledgers, and archive source invoice files. Use when the user asks in English or Chinese to check mailbox invoices, scan recent invoice emails, download invoice files, process 发票/电子发票/数电发票/报销票据 from email, create 发票台账, or handle 最近7天/本月/指定日期范围的邮箱发票. Use only for invoice email discovery, invoice attachment download, invoice PDF extraction, invoice ledger generation, link-invoice handling, PNG invoice anomaly handling, and invoice archiving workflows; do not use this skill for unrelated email reading, general mailbox analysis, personal correspondence, marketing emails, or non-invoice tasks.
---

# Email Invoice Pipeline

Use this skill only for invoice-related email processing. If the user asks for unrelated mailbox work, decline and explain that this skill is limited to invoice emails and invoice-ledger workflows.

## Required First Message

Before live mailbox access, clearly tell the user:

- The agent will access mailbox metadata, subjects, message bodies, links, and attachments within the requested date range.
- Email credentials or app passwords are sensitive. Prefer mailbox app passwords / authorization codes and revoke them after use if needed.
- AI extraction can be wrong. The generated ledger is an assistance artifact, not accounting, tax, legal, or audit advice.
- The user must review high-value invoices, manual tasks, missing fields, and any records marked `needsManualReview`.
- The agent should only process invoice-related messages and should not inspect unrelated emails beyond what is technically needed for filtering.

Continue only after the user authorizes the mailbox run and provides or confirms local credential configuration.

## Setup

After cloning the repository:

```bash
npm install
npm run setup
```

`npm run setup` lets the user choose or enter a mailbox profile. It writes credentials only to local `.env`, which must remain git-ignored.

Preferred project-specific credential file:

```bash
copy config/IMAP_CREDENTIALS.example.js config/IMAP_CREDENTIALS.js
```

Edit `config/IMAP_CREDENTIALS.js` locally. This file is git-ignored and must not be committed.

Run:

```bash
npm run doctor
npm run check
```

## Core Pipeline

Run the 7-step pipeline:

```bash
npm run run -- 2026-06-01 2026-06-18
```

The pipeline steps are:

1. `step1-email-scan.js`: scan QQ mailbox by date range and cache invoice email metadata.
2. `step2-classify-invoices.js`: classify invoice candidates into attachment, link, platform, QR/image, and manual buckets.
3. `step2-download-pdf.js`: execute the classification plan and download source files into `scan-results/staging/{dateTag}/`.
4. `step3-extract-pdf.js`: parse staged PDFs with `pdf2json` and extract buyer, seller, amount, invoice number, and invoice date.
5. `step4-merge-data.js`: merge email metadata, classification, download results, and PDF extraction by UID.
6. `step5-generate-ledger.js`: generate Excel ledger with 4 sheets.
7. `archive-invoices.js`: archive final PDFs and generate `archive/index.html`.

## Archive

After the core pipeline, archive source files:

```bash
npm run archive -- 20260601-20260618
```

Archive rules:

- Normal PDF/OFD: `archive/{buyer}/{seller}/{amount}_{buyerKeyword}_{invoiceNoLast6}_{type}_{month}.{ext}`
- PNG/image invoice: `archive/待处理/美团/`
- Summary: `archive/index.html` with a top summary area and three tabs: buyer grouping, email-time ordering, anomalies.

## Outputs

Look under `scan-results/`:

- `emails/emails-{dateTag}.json`: invoice-candidate emails.
- `classified/classified-{dateTag}.json`: classification plan for every invoice candidate.
- `staging/{dateTag}/pdfs`: centralized downloaded PDF source files.
- `staging/{dateTag}/ofds`: OFD source files kept for traceability.
- `staging/{dateTag}/images`: image/QR-code source files kept for manual/OCR handling.
- `downloads/download-results-{dateTag}.json`: downloaded PDF/OFD/image/link results.
- `pdf-text-{dateTag}.json`: extracted PDF text and fields.
- `invoice-final-{dateTag}.json`: merged invoice records.
- `manual-tasks-{dateTag}.csv`: rows requiring human review.
- `发票台账-{dateTag}.xlsx`: Excel ledger.

Archive outputs:

- `archive/`: classified source invoice files.
- `archive/manifest.json`: archive manifest.
- `archive/index.html`: clickable summary with anomalies and mail links.

## Operating Rules For Agents

- Keep all credentials in `.env` or `config/IMAP_CREDENTIALS.js`; never commit these files or paste secrets into output.
- Process the smallest date range that satisfies the task.
- Prefer `npm run doctor` before live runs.
- If live mailbox access fails, report the precise failing stage and stop.
- Treat `manual-tasks-*.csv` and archive anomalies as required human review, not a failure.
- Do not expand scope from invoice emails to general mailbox search.

## Agent Judgment Loop

This skill should be used as an agent-operated toolset, not as a fixed crawler.

The scripts perform deterministic work: scan, download, parse, merge, archive, and generate ledgers. The agent is responsible for judgment:

- Check whether every invoice-like email became either an archived PDF record or a manual task.
- Inspect repeated manual failures and decide whether they represent a new source type.
- Add or improve a link resolver only when a pattern is repeated or clearly platform-specific.
- Never silently drop a hard email; preserve it as a manual task with UID, subject, date, links, known fields, and failure reason.

Current link resolver categories:

- `direct-pdf`: URL or redirect returns a PDF.
- `direct-ofd`: URL or redirect returns an OFD.
- `html-link-discovery`: landing page contains a PDF/OFD link.
- `nuonuo-api`: Nuonuo/JSS invoice landing page requires calling the front-end JSON API.
- `unknown-link-resolver`: downloaded by a resolver that has not identified itself.

For the full business workflow and extension rules, read `docs/AGENT_WORKFLOW.md`.
