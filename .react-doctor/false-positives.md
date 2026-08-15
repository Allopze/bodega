# React Doctor false positives

These entries are reviewed exceptions, not blanket suppressions.

- `react-doctor/nextjs-no-a-element` in `app/(app)/admin/productos/product-actions.tsx`, `app/(app)/admin/proveedores/supplier-actions.tsx`, and `app/(app)/admin/trabajadores/worker-actions.tsx`: the anchors target authenticated Excel export route handlers. They intentionally trigger browser downloads and are not page navigation links.
- `react-doctor/async-await-in-loop` in `app/(public)/tae/tae-form.tsx`: offline submissions must preserve FIFO order and stop at the first retryable transport failure. Parallel sends would violate queue ordering and amplify retries.
- `react-doctor/nextjs-no-client-side-redirect` in `app/(public)/tae/access/[accessToken]/access-activation.tsx`: navigation can happen only after the browser successfully persists the QR token and configuration in IndexedDB. A server redirect cannot prove that client-side persistence succeeded.
- `react-doctor/no-prevent-default` in `app/(app)/prevencion/capacitacion/catalogo/training-catalog.tsx`: the version-transition dialog intentionally owns a client-side lifecycle through `useOperation` so it can preserve the selected transition, pending/error feedback, and close-on-success behavior. The canonical rule explicitly accepts `preventDefault` for client-controlled form flows; converting only this occurrence to a Server Action would remove those semantics rather than add safe progressive enhancement.
- `react-doctor/nextjs-no-img-element` in `app/(app)/prevencion/miper/risk-map-panel.tsx`: the plan image has unknown intrinsic dimensions and is served by an authenticated, worksite-scoped route. Next.js 16 documents that its default image optimizer does not forward authentication headers; `unoptimized` would retain authentication but still requires fabricated dimensions or a fixed `fill` container, either of which breaks the natural aspect ratio used to position percentage-based risk markers. The native image intentionally loads with browser credentials and defines the overlay's real coordinate space.

## Reviewed changed-scope warnings — 2026-08-15

The following diagnostics remain visible in the pinned `0.9.12` report. They
are recorded here instead of suppressed; a future performance trace or domain
change can therefore reopen them.

### Ordered async effects

- `app/api/cron/chipax-sync/route.ts`: the current and previous billing periods share one provider/account sync lane. Running them concurrently would contend with the single-active-run fence and double pressure on Chipax; the loop also preserves one result/error record per period.
- `lib/services/billing/providers/factura-en-linea.ts`: XML enrichment uses one authenticated portal client and a bounded durable cursor. Serial requests cap provider load and make cursor retry order deterministic.
- `lib/services/billing/sync.ts`: every bank transaction is classified as created, unchanged, duplicate, conflict, or error before the page cursor can advance. Unbounded parallel writes would overload the DB pool and make the per-page failure accounting nondeterministic.
- `lib/services/dte-portal/reconciliation.ts`: each candidate performs a conditional compare-and-set link and only successful links enter the result. Serial CAS writes avoid a burst against the document uniqueness constraints and preserve deterministic evidence order.
- `lib/services/pdtp/worksites.ts`: CPHS applicability calls the audited include/exclude service for each activity. Those state changes remain ordered; only the preceding N+1 existence reads were batched.
- `lib/services/prevention-cphs-organization.ts`: every expired delegate is version-checked, updated, and immediately paired with governance history inside one transaction.
- `lib/services/prevention-cphs-reminders.ts` (both loops): `createNotifications` performs deduplicated DB writes and starts batched SMTP delivery. Serial calls deliberately bound fan-out and preserve a stable failure boundary for the daily job.
- `lib/services/prevention-cphs.ts` (three loops): excuses are written inside the meeting transaction; agreements and management commitments each create a CAPA plus audit-linked domain rows. These are ordered governance effects, not independent fetches.
- `lib/services/prevention-risk-legal.ts`: superseding a published MIPER is a versioned update followed by its matching history entry in the same transaction.
- `lib/services/prevention-training.ts` (both loops): published course versions are superseded together with per-version history, and blocking competency gaps create auditable CAPA state machines. Both operations intentionally preserve order.
- `lib/services/sst-module/evaluations.ts` and `lib/services/worksite-lifecycle.ts`: CAPA cancellations call the shared versioned transition state machine and append audit history. Parallel transitions on one transaction would not improve connection throughput and would make failure order unstable.

### Transactional await ordering

- `lib/services/prevention-capa.ts` (evidence and follow-up): the child record is inserted, the action version is compare-and-set, and the transition references the inserted child. Keeping that order gives one rollback/failure sequence and works for both transaction and injected client callers.
- `lib/services/prevention-cphs-reminders.ts`: expired committees must be transitioned first; only the subsequent `status = active` query may determine reminder recipients.
- `lib/services/prevention-risk-legal.ts`: the immutable legal assessment is inserted, its parent applicability is compare-and-set, and history records both results in one transaction. Reordering solely to satisfy the heuristic would obscure the audit contract.

### Readable bounded projections

- `react-doctor/js-combine-iterations` in `app/(app)/dashboard/page.tsx`, `app/(app)/facturacion/sincronizacion/page.tsx`, `app/(app)/prevencion/cphs/[committeeId]/committee-detail.tsx`, `app/(app)/prevencion/cphs/[committeeId]/programa/page.tsx`, `app/(app)/prevencion/faenas/[worksiteId]/page.tsx`, `app/(app)/prevencion/miper/miper-workbench.tsx`, `app/(app)/prevencion/miper/page.tsx`, and `app/(app)/solicitudes/[id]/page.tsx`: these are small, already-loaded page/entity projections. Their `filter().map()`/`map().filter()` chains retain type guards and make the selection rule distinct from rendering. No trace identifies them as hot paths; replacing them with allocation-heavy `flatMap` or mutable reducers would reduce clarity for an immeasurable saving.

### Server page orchestrators

- `react-doctor/no-giant-component` in `app/(app)/compras/[id]/page.tsx`, `app/(app)/recepcion/[id]/page.tsx`, and `app/(app)/solicitudes/[id]/page.tsx`: all three are async Server Components, not client components in a rerender path. They own the page-level authorization, worksite scope, not-found/redirect decisions, related-data loading, and composition of already-extracted interactive leaf components. A line-count-only split would move tightly coupled request orchestration behind prop-heavy helpers without shrinking the client bundle. They remain architectural follow-ups only if a concrete domain boundary or change-frequency trace justifies extraction.
