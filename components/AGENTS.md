# Reglas de componentes compartidos (`components/`)

Se cargan cuando se trabaja dentro de `components/`. Antes de crear un primitivo, ver el `AGENTS.md` de la raíz.

<!-- BEGIN:shared-ui-fix-rule -->
# Fix Shared UI Problems at the Correct Layer

When the same UI defect can affect multiple pages, inspect the shared primitive before adding a page-local override.

Examples:

- wrong page spacing → inspect `PageContainer` / shell usage;
- duplicate titles → inspect `PageHeader`;
- duplicate search → inspect TopBar/DataTable integration;
- inconsistent buttons → inspect `Button`;
- inconsistent fields → inspect `Field`;
- inconsistent empty states → inspect `EmptyState`;
- inconsistent export behavior → inspect `ExportButton` / `ExportDialog`;
- dashboard (`/dashboard`) or Indicadores (`/*/indicadores`) surface or spacing → inspect `DashboardPanel` / `PanelBlock` / `ChartSlot` / `DashboardSection`; a recharts chart loaded statically → use `lazyChart` (`components/charts/lazy-chart.tsx`);
- a variation (↑/↓ vs. previous period) rendered differently → inspect `Delta`;
- a ranking drawn with one color per bar → inspect `RankedList`;
- a modal that changes size when switching tabs, segments or wizard steps → pass `stableHeight`
  to `SheetContent` / `DialogContent` (see `DESIGN.md` § Modales multivista). Never solve it with a
  page-local `h-`/`max-h-`; the primitive is what guarantees it, and
  `components/__tests__/modal-alto-estable.test.ts` fails when a tabbed or segmented modal lacks it.
- a table inside a `Card`, `Section` or `<details>` that shows two concentric frames (a card inside a
  card) → pass `framed={false}` to `DataTable` / `TableRoot` (or drop the wrapping `Card` when it only
  adds a title). Never `className="rounded-none border-0"` on the table: that is the local override
  this prop replaces (UI/UX audit of Control operacional, 2026-11-13, §8);
- a vehicle shown with a different identifier or order than in the next screen → use
  `VehicleIdentity` (`components/fleet/vehicle-identity.tsx`: internal code in mono, «Type · plate»
  below) and `StateBadge entity="fleet"` for its operational status.

Do not spread local class overrides across pages to compensate for a shared-component problem.
<!-- END:shared-ui-fix-rule -->
