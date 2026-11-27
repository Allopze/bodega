import { Warning } from "@phosphor-icons/react/dist/ssr"
import { plural } from "@/lib/mantencion/format"
import { groupItems, type CheckDetail, type DetailItem } from "@/lib/services/mantencion/looker/equipment-check-summary"
import { formatDate, formatPercent, formatQty } from "@/lib/utils"
import { CheckEvidence } from "./check-evidence"

const SECTION_TITLE = "text-eyebrow text-[var(--color-text)]"

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-[var(--color-text)]">{children}</dd>
    </div>
  )
}

/** Un ítem que no se hizo, destacado en el tono de «pendiente» (como «No realizado» del registro) con su sistema y su motivo. */
function NotDoneItem({ item }: { item: DetailItem }) {
  return (
    <li className="rounded-[var(--radius-md)] border border-[var(--color-signal-line)] bg-[var(--color-signal-tint)] px-3 py-2">
      <p className="text-sm text-[var(--color-text)]">
        <strong className="font-semibold text-[var(--color-signal-ink)]">No realizado:</strong> {item.name}
      </p>
      <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
        {item.system ?? "Sin sistema"} ·{" "}
        {item.reason ? <>Motivo: {item.reason}</> : <span>Sin motivo en el formulario</span>}
      </p>
    </li>
  )
}

/** Detalle de la pauta elegida: lo que no se hizo primero, lo hecho por sistema, lo que no aplica, la evidencia y las observaciones. */
export function CheckDetailView({ detail, equipment }: { detail: CheckDetail; equipment: string }) {
  const grouped = groupItems(detail.items)
  const done = detail.items.filter((item) => item.state === "realizado").length

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Fact label="Pauta">{detail.level}</Fact>
        <Fact label="Fecha"><span className="font-mono">{formatDate(detail.date)}</span></Fact>
        <Fact label="Mecánico">{detail.mechanic ?? "Sin mecánico"}</Fact>
        <Fact label="Cumplimiento">
          {detail.percent == null ? "Sin dato" : <span className="font-mono tabular-nums">{formatPercent(detail.percent, 1)}</span>}
          <span className="block text-2xs text-[var(--color-text-muted)]">
            {formatQty(detail.done)} hechos · {formatQty(detail.notDone)} sin hacer · {formatQty(detail.notApplicable)} no aplican
          </span>
        </Fact>
      </dl>

      {detail.itemDetail !== "full" && (
        <p className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-3 py-2 text-xs text-[var(--color-warning-ink)]">
          <Warning size={14} weight="fill" className="mt-px shrink-0" aria-hidden />
          {detail.itemDetail === "not_done_only"
            ? "El formulario no trae el detalle por ítem: sólo se conocen los nombres de los que no se hicieron."
            : "El formulario no trae el detalle por ítem: sólo se conocen las cantidades."}
        </p>
      )}

      {grouped.notDone.length > 0 && (
        <section aria-label="Ítems que no se hicieron">
          <h4 className={SECTION_TITLE}>Lo que no se hizo ({grouped.notDone.length})</h4>
          <ul className="mt-2 space-y-2">
            {grouped.notDone.map((item) => <NotDoneItem key={item.name} item={item} />)}
          </ul>
        </section>
      )}

      {done > 0 && (
        <section aria-label="Ítems realizados">
          <h4 className={SECTION_TITLE}>Lo que se hizo ({done})</h4>
          <div className="mt-2 space-y-3">
            {grouped.doneBySystem.map((group) => (
              <div key={group.system}>
                <p className="text-xs font-semibold text-[var(--color-text-muted)]">{group.system} · {plural(group.items.length, "ítem", "ítems")}</p>
                <ul className="mt-1 gap-x-6 text-sm text-[var(--color-text)] sm:columns-2">
                  {group.items.map((item) => <li key={item.name} className="break-inside-avoid py-0.5">{item.name}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {grouped.notApplicable.length > 0 && (
        <details className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2">
          <summary className="min-h-8 cursor-pointer text-xs font-semibold text-[var(--color-text-muted)]">
            No aplica en este nivel ({grouped.notApplicable.length})
          </summary>
          <ul className="mt-2 gap-x-6 text-sm text-[var(--color-text-muted)] sm:columns-2">
            {grouped.notApplicable.map((item) => <li key={item.name} className="break-inside-avoid py-0.5">{item.name}</li>)}
          </ul>
        </details>
      )}

      <section aria-label="Evidencia">
        <h4 className={SECTION_TITLE}>Evidencia</h4>
        <div className="mt-2"><CheckEvidence detail={detail} equipment={equipment} /></div>
      </section>

      <section aria-label="Observaciones del mecánico">
        <h4 className={SECTION_TITLE}>Observaciones del mecánico</h4>
        <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--color-text)]">{detail.observations ?? "Sin observaciones."}</p>
      </section>
    </div>
  )
}
