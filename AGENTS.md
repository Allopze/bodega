<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:export-rule -->
# Export Format Rule

All data exports in this app must use **XLSX** format. Never use CSV for exports. Use a library like `xlsx` or `exceljs` to generate proper `.xlsx` files with formatting support.
<!-- END:export-rule -->

<!-- BEGIN:source-of-truth -->
# Source of truth: `lib/` + `app/`, NOT `modules/` / `core/`

The live business logic is in `lib/services`, `lib/auth`, `lib/validation` and the per-feature `app/(app)/<área>/actions.ts`. The `modules/` and `core/` trees are a **frozen, incomplete** "monolito modular" migration (Fase 0/1). Their `services`/`actions`/`schema`/`validation` copies have **diverged** from `lib/` (the Postgres migration only updated `lib/`) and `app/` does **not** import them, except `modules/registry.ts` (which still drives navigation, the `Permission` type and the seed).

Rules until the migration is properly resumed:

- Make every change in `lib/` + `app/`. Do **not** edit, copy from, or wire up `modules/*/{services,actions,schema,validation}` or `core/*` as if they were current — they are stale.
- `modules/registry.ts` + the `manifest.ts` files are the only live parts; touch those only for nav/permissions/seed.
- See `modules/README.md` and the audit at `.claude/plans/shiny-scribbling-lynx.md` (finding A1) for the reconciliation plan.
<!-- END:source-of-truth -->
