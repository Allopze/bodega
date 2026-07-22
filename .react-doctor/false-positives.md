# React Doctor false positives

These entries are reviewed exceptions, not blanket suppressions.

- `react-doctor/nextjs-no-a-element` in `app/(app)/admin/productos/product-actions.tsx`, `app/(app)/admin/proveedores/supplier-actions.tsx`, and `app/(app)/admin/trabajadores/worker-actions.tsx`: the anchors target authenticated Excel export route handlers. They intentionally trigger browser downloads and are not page navigation links.
- `react-doctor/async-await-in-loop` in `app/(public)/tae/tae-form.tsx`: offline submissions must preserve FIFO order and stop at the first retryable transport failure. Parallel sends would violate queue ordering and amplify retries.
- `react-doctor/nextjs-no-client-side-redirect` in `app/(public)/tae/access/[accessToken]/access-activation.tsx`: navigation can happen only after the browser successfully persists the QR token and configuration in IndexedDB. A server redirect cannot prove that client-side persistence succeeded.
