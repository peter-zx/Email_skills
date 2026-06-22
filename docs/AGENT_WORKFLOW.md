# Agent-driven invoice email workflow

This project is not meant to be a brittle crawler. It is a small toolset that gives an agent reliable evidence and repeatable actions for invoice-email work.

## Goal

Use lightweight Node.js tools for deterministic work:

- IMAP scanning and UID tracking.
- Attachment download.
- Link following and platform-specific invoice download.
- PDF text extraction.
- Excel ledger and archive generation.

Use the agent or LLM for judgment:

- Decide whether a message is invoice-related when subject/body are ambiguous.
- Interpret unusual email wording or partially structured body text.
- Decide whether a failed link is a new platform type, expired link, QR-code/image flow, or manual-only case.
- Summarize manual tasks clearly for the user.

## Processing contract

Every invoice candidate should end in exactly one of these states:

- `auto-pdf`: PDF attachment or downloaded PDF was extracted and archived.
- `auto-link-pdf`: no attachment, but a link resolver downloaded a PDF.
- `auto-image-anomaly`: image/PNG invoice source was preserved and marked for OCR/manual review.
- `manual-link`: link exists, but current resolvers cannot download the PDF.
- `manual-body`: invoice-like email exists, but the body/links/files are insufficient.
- `error`: IMAP or parsing failed; rerun or inspect manually.

The agent should treat missing records as a bug. A hard-to-process email is still a record and must appear in `manual-tasks-*.csv` and `archive/index.html`.

## Current source types

1. Direct PDF attachment
   - Deterministic.
   - Download attachment by UID.
   - Extract PDF fields.
   - Archive as PDF.

2. PDF plus OFD attachment
   - Prefer PDF for ledger and archive.
   - Keep OFD in download cache only.
   - Do not show OFD duplicates in `archive/index.html`.

3. Direct PDF/OFD link
   - Follow redirects.
   - If response is PDF/OFD, save it.
   - Mark resolver as `direct-pdf` or `direct-ofd`.

4. HTML landing page with visible download link
   - Fetch landing page.
   - Discover PDF/OFD links from `href`, `src`, and download-like URLs.
   - Mark resolver as `html-link-discovery`.

5. Platform API landing page
   - Example: Nuonuo/JSS `nnfp.jss.com.cn`.
   - Follow short link to landing URL.
   - Call the same JSON endpoint used by the front-end.
   - Download `invoiceSimpleVo.url` as PDF.
   - Mark resolver as `nuonuo-api`.

6. QR-code or image-only flow
   - Preserve the image source.
   - Mark `png_anomaly` or `link_anomaly`.
   - Show the original email subject and copy/search action in HTML.

## Agent loop

1. Ask for scope: date range and mailbox profile.
2. Run `npm run doctor` and `npm run check`.
3. Run the pipeline, or run individual stages:
   - `step1-email-scan.js`
   - `step2-classify-invoices.js`
   - `step2-download-pdf.js`
   - `step3-extract-pdf.js`
   - `step4-merge-data.js`
   - `step5-generate-ledger.js`
   - `archive-invoices.js`
4. Inspect `classified/classified-{dateTag}.json` before download when debugging:
   - attachment PDF
   - PDF plus OFD
   - direct PDF link
   - platform landing page
   - QR/image link
   - manual/unknown
5. Inspect summary numbers:
   - scanned invoice candidates
   - classified source types
   - downloaded PDFs
   - link resolver successes/failures
   - complete records
   - manual tasks
6. If manual tasks exist, group them by reason:
   - expired/protected link
   - QR/image flow
   - no body extracted
   - missing amount/buyer/seller
   - parser error
7. For each new repeated manual pattern, add or improve a resolver.
8. Rerun only the necessary stages.
9. Report what was automatic, what is manual, and where the files are.

## Staging contract

All downloaded source files must first land in:

```text
scan-results/staging/{dateTag}/
  pdfs/
  ofds/
  images/
  failed/
```

PDF extraction reads from `staging/{dateTag}/pdfs`. The archive step copies final PDFs from staging into the human-facing `archive/` tree. `archive/` is a deliverable folder, not a processing workspace.

## Resolver design

Link resolvers should be generalized by platform or behavior, not by single email.

Each resolver should answer:

- Can this resolver handle the final URL or HTML?
- What evidence did it use?
- What file did it download?
- What resolver name should be recorded?
- If it failed, is the failure retryable or manual?

Current resolver names:

- `direct-pdf`
- `direct-ofd`
- `html-link-discovery`
- `nuonuo-api`
- `unknown-link-resolver`

When adding a new resolver, preserve the raw source link, final URL, resolver name, and error message in `download-results-*.json`.

## Manual handoff quality

Manual records must be useful without reading raw JSON:

- email UID
- email subject
- email date
- sender
- known buyer/seller/amount/invoice number/date
- original link(s)
- failure reason
- recommended action

The HTML summary should show PDF records by default and isolate anomalies in a separate tab.

## Safety boundary

This skill is limited to invoice email processing. The agent must not use it for general mailbox reading, personal correspondence, marketing analysis, or unrelated searches.

Credentials must stay local in `.env` or `config/IMAP_CREDENTIALS.js`.
