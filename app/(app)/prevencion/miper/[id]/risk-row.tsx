import { CaretRight } from "@phosphor-icons/react/dist/ssr"
import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { Checkbox } from "@/components/ui/checkbox"
import { CONTROLLED_STATUS_LABEL, type EntryChange, type MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import { WorkspaceLink } from "./workspace-nav"

const chip = "rounded-full px-2 py-0.5 text-xs font-medium"

/** Una fila de riesgo: peligro, riesgo · daño, clasificación, estado y marcas (spec §5.3). Lleva al editor. */
export function RiskRow({ entry, href, issueCount, observed, change, showPosition }: {
  entry: MiperEntrySnapshot; href: string; issueCount: number; observed: boolean; change: EntryChange | null; showPosition: boolean
}) {
  // Un peligro en blanco («   ») es un peligro vacío: ni título vacío ni nombre accesible cortado.
  const hazard = entry.hazard?.trim() || null
  return (
    <WorkspaceLink href={href} aria-label={`Riesgo #${entry.rowNumber}: ${hazard ?? "peligro sin describir"}`}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)] md:grid-cols-[minmax(0,1.6fr)_auto_auto_auto_auto]">
      <div className="min-w-0">
        <p className="text-sm font-semibold"><span className="mr-1.5 tabular-nums text-[var(--color-text-subtle)]">#{entry.rowNumber}</span>{hazard ?? "Peligro sin describir"}</p>
        <p className="text-xs text-[var(--color-text-subtle)]">{[entry.risk, entry.probableDamage].filter(Boolean).join(" · ") || "Sin riesgo ni daño"}{showPosition && entry.position ? <> · <span>{entry.position}</span></> : null}</p>
      </div>
      <div className="col-start-1 flex flex-wrap items-center gap-1.5 md:col-start-auto">
        <RiskClassificationBadge classification={entry.classification} magnitude={entry.magnitude} size="sm" />
        {entry.controlledStatus && <span className={`${chip} bg-[var(--color-surface-2)] text-[var(--color-text-muted)]`}>Controlado: {CONTROLLED_STATUS_LABEL[entry.controlledStatus]}</span>}
      </div>
      <span className="col-start-1 text-xs tabular-nums text-[var(--color-text-subtle)] md:col-start-auto">{entry.controls.length} medida{entry.controls.length === 1 ? "" : "s"}</span>
      <div className="col-start-1 flex flex-wrap gap-1.5 md:col-start-auto">
        {issueCount > 0
          ? <span className={`${chip} bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]`}>{issueCount} pendiente{issueCount === 1 ? "" : "s"}</span>
          : <span className={`${chip} bg-[var(--color-success-tint)] text-[var(--color-success-ink)]`}>Completo</span>}
        {observed && <span className={`${chip} bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]`}>Observado</span>}
        {change && change.kind !== "removed" && <span className={`${chip} bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]`}>{change.kind === "added" ? "Nueva" : "Modificada"}</span>}
      </div>
      <CaretRight aria-hidden className="row-span-1 row-start-1 col-start-2 size-4 text-[var(--color-text-subtle)] md:col-start-auto md:row-start-auto" />
    </WorkspaceLink>
  )
}

/**
 * Una fila de riesgo con su casilla de selección (Fase D). La casilla va AL LADO
 * del enlace, nunca dentro: un control dentro de un `<a>` es HTML inválido y su
 * clic abriría el editor. Sin `selection` (fuera del modo «Seleccionar») es la
 * fila de siempre.
 */
export function SelectableRiskRow({ selection, ...row }: Parameters<typeof RiskRow>[0] & { selection: { checked: boolean; onToggle: () => void } | null }) {
  if (!selection) return <RiskRow {...row} />
  const hazard = row.entry.hazard?.trim() || "peligro sin describir"
  return (
    <div className="flex items-center gap-2">
      <Checkbox label={`Seleccionar el riesgo #${row.entry.rowNumber}: ${hazard}`} labelHidden checked={selection.checked} onChange={selection.onToggle} />
      <div className="min-w-0 flex-1"><RiskRow {...row} /></div>
    </div>
  )
}
