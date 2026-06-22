# Email Invoice Pipeline

Agent-friendly QQ/IMAP invoice email processor.

This project provides lightweight Node.js tools for an AI agent to manage invoice-related emails only: scan invoice candidates, classify source types, download invoice files, extract PDF fields, generate an Excel ledger, and archive PDFs by buyer and seller.

## Safety Notice

This tool reads mailbox metadata, subjects, invoice-related message bodies, links, and attachments in the requested date range. Use mailbox app passwords or authorization codes. Keep credentials local in `.env` or `config/IMAP_CREDENTIALS.js`; never commit them.

AI and PDF extraction can be wrong. Generated ledgers are assistance artifacts, not accounting, tax, legal, or audit advice. Review high-value invoices and any manual/anomaly records.

The skill is limited to invoice email workflows. It should not be used for general mailbox reading.

## Quick Start

```bash
npm install
npm run setup
npm run doctor
npm run check
npm run run -- 2026-06-16 2026-06-22
```

Outputs:

- `scan-results/classified/classified-{dateTag}.json`
- `scan-results/staging/{dateTag}/pdfs`
- `scan-results/downloads/download-results-{dateTag}.json`
- `scan-results/pdf-text-{dateTag}.json`
- `scan-results/invoice-final-{dateTag}.json`
- `scan-results/发票台账-{dateTag}.xlsx`
- `archive/index.html`

## Pipeline

1. `step1-email-scan.js`
   Scan the mailbox and cache invoice candidate emails by UID.

2. `step2-classify-invoices.js`
   Classify every candidate before downloading:
   `attachment_pdf`, `attachment_pdf_ofd`, `link_direct_pdf`, `link_platform_page`, `attachment_image`, `manual_body`, etc.

3. `step2-download-pdf.js`
   Execute the classification plan and download source files into:
   `scan-results/staging/{dateTag}/pdfs|ofds|images|failed`.

4. `step3-extract-pdf.js`
   Extract buyer, seller, amount, invoice number, date, and tax amount from staged PDFs.

5. `step4-merge-data.js`
   Merge email metadata, classification, download evidence, and PDF extraction by UID.

6. `step5-generate-ledger.js`
   Generate the Excel ledger.

7. `archive-invoices.js`
   Archive final PDFs and generate `archive/index.html`.

## Supported Source Types

- PDF attachments.
- PDF plus OFD attachments, with PDF preferred for ledger/archive.
- Direct PDF links.
- Tax bureau/Baiwang links such as `Wjgs=PDF`.
- Nuonuo/JSS platform links via front-end JSON API.
- Generic HTML pages containing PDF/OFD download links.
- Image/QR-code flows as manual/anomaly records.

## Archive Rule

```text
archive/{buyer}/{seller}/{amount}_{buyerKeyword}_{invoiceNoLast6}_{type}_{month}.pdf
```

OFD files are retained in staging for traceability but do not appear in the PDF archive/index.

## Agent Contract

Every invoice candidate must become one of:

- archived PDF record
- saved anomaly/manual record
- explicit error with reason

The agent should inspect `classified-*.json`, `download-results-*.json`, and `manual-tasks-*.csv` after each run. Repeated manual failures should become new resolvers, not silent misses.

See [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md) and [docs/PROJECT_DESIGN.md](docs/PROJECT_DESIGN.md).
