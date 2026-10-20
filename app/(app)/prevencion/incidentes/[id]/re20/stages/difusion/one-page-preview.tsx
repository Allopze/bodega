import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/utils"
import { ONE_PAGE_MAX_ROWS, type OnePageModel } from "./model"

function Cell({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs text-[var(--color-text-subtle)]">{label}</dt>
      <dd className="mt-0.5 text-sm text-[var(--color-text)]">{children || <span className="text-[var(--color-text-subtle)]">Sin dato</span>}</dd>
    </div>
  )
}

/** Vista previa del RE-20-06 con la misma estructura de la hoja que se imprime. */
export function OnePagePreview({ page, learning }: { page: OnePageModel; learning: string }) {
  return (
    <figure aria-label="Vista previa del informativo de difusión" className="m-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <span className="font-semibold text-[var(--color-text)]">Informativo de difusión de accidentes</span>
        <span className="font-mono text-xs tabular-nums text-[var(--color-text-muted)]">RE-20-06 · versión 2</span>
      </figcaption>
      <dl className="grid gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-2">
        <Cell label="Resumen del caso" wide><span className="whitespace-pre-wrap">{page.summary}</span></Cell>
        <Cell label="Fecha"><span className="font-mono tabular-nums">{formatDate(page.date)}</span></Cell>
        <Cell label="Potencial del evento">{page.potential}</Cell>
        <Cell label="Subgerencia / área">{page.subManagement}</Cell>
        <Cell label="Área o taller">{page.area}</Cell>
        <Cell label="Lugar" wide>{page.place}</Cell>
        <Cell label="Lesión">{page.injury}</Cell>
        <Cell label="Zona corporal">{page.bodyZone}</Cell>
      </dl>

      <div className="border-t border-[var(--color-border)] px-4 py-4">
        <p className="text-sm font-medium text-[var(--color-text)]">Causas raíz y medidas</p>
        {page.shown.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">Sin medidas todavía: aparecerán aquí cuando el equipo las escriba en la investigación.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-text-subtle)]">
                  <th scope="col" className="py-2 pr-3 font-normal">Causa raíz</th>
                  <th scope="col" className="py-2 pr-3 font-normal">Medida</th>
                  <th scope="col" className="py-2 pr-3 font-normal">Responsable</th>
                  <th scope="col" className="py-2 pr-3 font-normal">Plazo</th>
                  <th scope="col" className="py-2 font-normal">Estatus</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)] align-top">
                {page.shown.map((row, index) => (
                  <tr key={index}>
                    <td className="py-2 pr-3 text-[var(--color-text)]">{row.rootCause || "—"}</td>
                    <td className="py-2 pr-3 text-[var(--color-text)]">{row.measure}</td>
                    <td className="py-2 pr-3 text-[var(--color-text)]">{row.responsible || "—"}</td>
                    <td className="py-2 pr-3 font-mono tabular-nums text-[var(--color-text)]">{row.dueAt ? formatDate(row.dueAt) : "—"}</td>
                    <td className="py-2 text-[var(--color-text)]">{row.status || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {page.hiddenRows > 0 && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <Badge variant="warning">+{page.hiddenRows} {page.hiddenRows === 1 ? "medida" : "medidas"}</Badge>
            El impreso tiene espacio para {ONE_PAGE_MAX_ROWS}: {page.hiddenRows === 1 ? "la última queda" : `las últimas ${page.hiddenRows} quedan`} fuera de la hoja. Agrupa medidas en la investigación si deben verse todas.
          </p>
        )}
      </div>

      <div className="border-t border-[var(--color-border)] px-4 py-4">
        <p className="text-xs text-[var(--color-text-subtle)]">Aprendizaje para otras faenas</p>
        <p className="mt-0.5 whitespace-pre-wrap text-sm text-[var(--color-text)]">{learning.trim() || <span className="text-[var(--color-text-subtle)]">Sin dato</span>}</p>
      </div>
    </figure>
  )
}
