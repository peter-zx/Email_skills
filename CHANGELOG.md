# Changelog

## v0.3.0 - 2026-06-22

### Added

- Seven-stage agent workflow:
  1. scan
  2. classify
  3. download to staging
  4. extract PDF
  5. merge
  6. ledger
  7. archive
- `step2-classify-invoices.js` for source-type classification before download.
- Central staging workspace:
  `scan-results/staging/{dateTag}/pdfs|ofds|images|failed`.
- Link resolver evidence fields in download/final records:
  `sourceType`, `expectedAction`, `platform`, `resolver`.
- Nuonuo/JSS resolver using `/scan2/getIvcDetailShow.do`.
- Tax bureau/Baiwang direct PDF handling for `Wjgs=PDF` links, with curl fallback.
- HTML body fallback in mailbox scanning.
- Folded/RFC encoded-word subject decoding.
- Empty `manual-tasks-*.csv` generation when there are no manual tasks.
- Project documentation:
  - `README.md`
  - `docs/AGENT_WORKFLOW.md`
  - `docs/PROJECT_DESIGN.md`

### Changed

- `run-all.js` now runs the full seven-stage workflow and includes archive generation.
- PDF extraction reads staged PDFs first.
- Archive output shows only PDFs; OFD files are retained in staging but excluded from `archive/index.html`.
- Buyer normalization maps Rongai variants to `武汉市硚口区融爱日用品经营部（个体工商户）`.
- Image attachments in emails that already have a successful PDF are not treated as anomalies.

### Fixed

- Fixed truncated folded email subjects, including forwarded Nuonuo messages.
- Fixed HTML-only invoice emails where `parsed.text` was empty.
- Fixed attachment emails previously marked as `error` when batch fetch missed body/attachments; scanner retries per UID.
- Fixed Baiwang/tax-bureau direct PDF links appearing after QR-code image links.
- Fixed Nuonuo platform links that require API resolution instead of simple HTML scraping.

### Verification

Tested with date range `2026-06-16` to `2026-06-22`:

- invoice candidates: 23
- staged PDFs: 23
- extracted PDFs: 23
- complete final records: 23
- manual tasks: 0
- archived PDFs: 23
- archive anomalies: 0

Specific regressions verified:

- UID 5845 Baiwang/tax-bureau link downloaded via `curl-direct-pdf`.
- UID 5865 attachment PDF detected and processed.
- UID 5866 forwarded Nuonuo subject decoded fully and resolved via `nuonuo-api`.
