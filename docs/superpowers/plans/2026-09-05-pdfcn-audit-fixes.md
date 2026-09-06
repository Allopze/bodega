# PDFcn Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every verified defect from the 2026-09-05 PDFcn audit while preserving Chromium behavior and unrelated worktree changes.

**Architecture:** Keep the PDF route and document data source shared. Build PDFcn table fragments explicitly, each with its own caption and header, and choose fragment boundaries with Takumi measurement so variable-height detail rows fit the A4 content area. Make the operational-settings action execute all related writes through one Drizzle transaction by allowing the existing services to use a transaction client.

**Tech Stack:** Next.js 16, React 19, TypeScript, Drizzle/PostgreSQL, Takumi WASM, Vitest, Playwright, Python vendoring script.

**Spec:** 2026-09-05 audit findings in the active conversation.

## Global Constraints

- Do not change the Chromium PDF pipeline or authorization semantics.
- PDFcn must retain the same data and literal strings as `app/(print)/compras/[id]/print/page.tsx`.
- The six document defaults remain `chromium`; only OC continues to support `pdfcn`.
- Do not touch unrelated `trazabilidad*`, `qa/evidence/**`, `prevencion/**`, `pdtp*`, `operational-work-queue*`, or `components/ui/table.tsx` changes.
- Use `apply_patch` for source edits and run each focused test through a red-green cycle.
- Do not commit or modify production data.

---

### Task 1: Add honest PDFcn parity and pagination regressions

**Files:**
- Modify: `lib/__tests__/oc-pdfcn-render.test.ts`
- Modify: `lib/__tests__/oc-pdf-route-engine.test.ts`
- Modify: `lib/__tests__/admin-ops-settings-actions.test.ts`
- Modify: `e2e/pdf-exports.spec.ts`

**Interfaces:**
- Tests assert rendered PDF text, page starts, transaction ordering, and real loader authorization.

- [x] **Step 1: Write failing real-render assertions**

  Add assertions for the table caption, supplier colons, `$` totals, exact branch label, and the column header at the start of every PDFcn page that contains item rows. Add a fixture with a long detail note so a one-row chunk cannot accidentally hide a split.

- [x] **Step 2: Run the focused render test and verify the expected failures**

  Run `PATH=/home/allopze/.nvm/versions/node/v22.13.1/bin:$PATH npx vitest run lib/__tests__/oc-pdfcn-render.test.ts`.

- [x] **Step 3: Add a route authorization regression that executes the loader gate**

  The route test remains focused on mapping the loader's `null` to a 404; a
  separate service-level test executes the real `canAccessWorksite` dependency
  and proves an inaccessible worksite cannot produce data.

- [x] **Step 4: Add action ordering/atomicity assertions**

  Make the action test prove invalid PDF engine input prevents all persistence calls and that the transaction callback is used.

- [x] **Step 5: Make E2E engine checks discriminating**

  Assert a Chromium-only marker and PDFcn-only marker, and assert each multipage page containing item rows starts with the expected header/caption rather than only counting page footers.

### Task 2: Fix PDFcn content parity and explicit table fragments

**Files:**
- Modify: `app/(print)/compras/[id]/print/oc-pdfcn-document.tsx`
- Modify: `app/(print)/compras/[id]/print/oc-pdfcn-render.ts`
- Modify: `lib/pdf/page-options.ts` if shared A4 geometry constants are required

**Interfaces:**
- `OcPdfcnDocument` accepts measured `rowChunks` and renders one table fragment per page.
- `renderOcPdf` measures the intro and candidate tables, then passes explicit chunks to the document.

- [x] **Step 1: Implement the exact literals from the Chromium source**

  Reproduce the branch label/casing and separate value line, add the table caption, add `: ` to supplier key/value rows, and prefix monetary values with `$ `.

- [x] **Step 2: Implement `OcPdfcnItemsTable` with caption plus header**

  Keep the existing vendored flex table unchanged; place the caption and `DataTable` in a local PDFcn table-fragment component so every fragment has the same visible context.

- [x] **Step 3: Implement measured row chunking**

  Use Takumi `measure()` on the same table fragment and an A4 content-width wrapper. Reserve the measured company/supplier intro for the first page, pack the largest fitting row prefix, and place subsequent fragments behind `breakBefore: "page"`. Keep each fragment `breakInside: "avoid"` when it fits.

- [x] **Step 4: Run the render regression and verify it passes**

  Run the focused render test again and inspect a generated 45-row PDF with PyMuPDF to confirm every item page starts with caption and column headers.

### Task 3: Make operational-settings persistence atomic

**Files:**
- Modify: `lib/services/system-settings.ts`
- Modify: `lib/services/dispatch-guides.ts`
- Modify: `app/(app)/admin/parametros-operativos/actions.ts`
- Modify: `lib/__tests__/system-settings-pdf-engine.test.ts`
- Modify: `lib/__tests__/admin-ops-settings-actions.test.ts`

**Interfaces:**
- Existing service functions accept an optional structural DB/transaction client while preserving current default calls.
- `saveOperationalSettingsAction` runs office, numeric, PDF-engine writes, and their audits inside `db.transaction`.

- [x] **Step 1: Run the newly added atomicity test and verify it fails**

  Use a transaction mock whose callback exposes a transaction client; send valid numeric data plus `pdfEngine.oc=basura` and assert no transaction persistence is committed.

- [x] **Step 2: Thread the client through readers, writers, and audits**

  Replace transaction-incompatible relational reads with `select`-based readers where necessary, pass the same client to `recordAudit`, and leave default service callers on `db`.

- [x] **Step 3: Wrap the action in one transaction**

  Import `db`, execute all three settings operations in the callback, and keep permission validation before the transaction.

- [x] **Step 4: Run settings tests and verify the atomicity behavior**

  Run `PATH=/home/allopze/.nvm/versions/node/v22.13.1/bin:$PATH npx vitest run lib/__tests__/system-settings-pdf-engine.test.ts lib/__tests__/admin-ops-settings-actions.test.ts`.

### Task 4: Harden the vendoring script

**Files:**
- Modify: `scripts/vendor-pdfcn.py`
- Modify: `components/pdf/README.md`

**Interfaces:**
- The script fails nonzero on incomplete registry fetches, validates every destination after normalization within `components/pdf`, and records pinned source metadata.

- [x] **Step 1: Add script-level tests or deterministic checks that fail on the current behavior**

  Exercise destination normalization and a simulated fetch failure without writing into the repository.

- [x] **Step 2: Normalize and constrain remote targets**

  Resolve each target against the repository root and reject paths outside `components/pdf` before creating directories or opening files.

- [x] **Step 3: Fail closed on incomplete generation and pin provenance**

  Track item/extra failures, return a nonzero exit status when any source is missing, and record the registry revision/source hashes in the README or generated metadata.

- [x] **Step 4: Run the script in a disposable directory and compare output**

  Confirm it writes the expected 27 source files and fails on a controlled invalid target/fetch condition.

### Task 5: Full verification and React diagnostics

**Files:**
- No source files unless verification exposes a regression.

- [x] **Step 1: Run targeted tests and E2E**

  Run the PDF/settings Vitest files and `E2E_SKIP_BUILD=true npm run test:e2e -- pdf-exports.spec.ts`.

- [x] **Step 2: Run lint, build, and standalone WASM checks**

  Run `npm run lint`, `npm run build`, verify `.next/standalone/node_modules/takumi-pdf/pkg/takumi_pdf_wasm_bg.wasm`, and import `takumi-pdf` from `.next/standalone`.

- [x] **Step 3: Run React Doctor on changed React files**

  Run `npx react-doctor@latest --verbose --scope changed` and investigate any regression in the changed PDFcn React tree.

- [x] **Step 4: Review the diff and report remaining gaps**

  Use `git diff --check` and scoped `git status --short`; do not claim completion until every audit finding has a corresponding passing regression or an explicitly verified non-applicability.
