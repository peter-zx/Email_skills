# Project Design

## Purpose

The project is designed as an agent-operated invoice email workflow, not a one-off crawler.

Code handles deterministic operations:

- IMAP access.
- UID-based mailbox records.
- Source classification.
- Attachment and link download.
- Platform resolver execution.
- PDF text extraction.
- Ledger generation.
- File archiving.

The agent handles judgment:

- Review classification results.
- Identify repeated manual failure patterns.
- Decide whether a new resolver is needed.
- Explain manual handoff tasks clearly.

## Data Flow

```text
Mailbox
  -> step1-email-scan.js
  -> scan-results/emails/emails-{dateTag}.json
  -> step2-classify-invoices.js
  -> scan-results/classified/classified-{dateTag}.json
  -> step2-download-pdf.js
  -> scan-results/staging/{dateTag}/
  -> step3-extract-pdf.js
  -> scan-results/pdf-text-{dateTag}.json
  -> step4-merge-data.js
  -> scan-results/invoice-final-{dateTag}.json
  -> step5-generate-ledger.js
  -> scan-results/发票台账-{dateTag}.xlsx
  -> archive-invoices.js
  -> archive/
```

## Classification Layer

`step2-classify-invoices.js` is the decision boundary between mailbox scanning and source downloading.

It classifies each invoice candidate into a source type:

- `attachment_pdf`
- `attachment_pdf_ofd`
- `attachment_ofd`
- `attachment_image`
- `link_direct_pdf`
- `link_direct_ofd`
- `link_platform_page`
- `link_qrcode_image`
- `link_unknown_page`
- `manual_body`
- `scan_error`

The classification output is intentionally explicit so an agent can inspect and correct the plan before execution.

## Staging Layer

All downloaded files first land in:

```text
scan-results/staging/{dateTag}/
  pdfs/
  ofds/
  images/
  failed/
```

`archive/` is only for final deliverables. It should not be used as a working folder.

## Resolver Layer

`step2-download-pdf.js` executes resolvers.

Current resolver names:

- `direct-pdf`
- `direct-ofd`
- `curl-direct-pdf`
- `curl-direct-ofd`
- `html-link-discovery`
- `nuonuo-api`
- `unknown-link-resolver`

Resolvers should be platform or behavior based. Do not add logic for a single UID. If a repeated pattern appears in manual tasks, generalize it as a resolver.

## Merge Rules

`step4-merge-data.js` uses mailbox UID as the primary key.

Information priority:

1. PDF extraction for invoice facts.
2. Email body fields for missing facts.
3. Filename and subject fallback.
4. Buyer/seller normalization maps.

Final records include:

- source type
- expected action
- platform
- resolver
- PDF extraction fields
- manual review flags

## Manual Handoff

Manual output is not a failure. It is the explicit place where automation stops.

Every manual task should include:

- UID
- email subject
- email date
- known buyer/seller/amount/invoice number
- original link or attachment context
- reason
- recommended action

When there are zero manual tasks, an empty `manual-tasks-*.csv` is still generated with headers.

## Archive Rules

Only PDFs enter the final archive and `index.html`.

```text
archive/{buyer}/{seller}/{amount}_{buyerKeyword}_{invoiceNoLast6}_{type}_{month}.pdf
```

OFD files remain in staging. Image attachments are shown as anomalies only when no PDF for the same UID was successfully processed.

## Safety

Credentials and runtime outputs must not be committed:

- `.env`
- `config/IMAP_CREDENTIALS.js`
- `config/mailboxes.json`
- `scan-results/`
- `archive/`

The skill is restricted to invoice email processing. It must not be used for general mailbox reading.
