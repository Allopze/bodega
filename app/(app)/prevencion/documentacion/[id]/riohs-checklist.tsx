"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useOperation } from "@/lib/hooks/use-operation"
import { assessRiohsCompleteness, RIOHS_SECTIONS } from "@/lib/prevention/riohs"
import { setRiohsSectionsAction } from "../actions/riohs"
import { assignSstDocumentToWorkforceAction } from "../actions/distribution"

/**
 * Contenido mínimo del Reglamento Interno (DS 44 art. 58, más arts. 59 a 61).
 *
 * Es la llave del gate de publicación: `publishDocumentVersion` rechaza un
 * RIOHS al que le falte cualquier capítulo obligatorio, así que sin esta
 * pantalla el documento no se podría publicar nunca.
 */
export function RiohsChecklist({ documentId, currentVersionId, sections, canManage, canDistribute }: {
  documentId: string
  /** Sólo la versión vigente se puede distribuir. */
  currentVersionId: string | null
  sections: string[]
  canManage: boolean
  canDistribute: boolean
}) {
  const router = useRouter()
  const operation = useOperation()
  const distribution = useOperation()
  const [checked, setChecked] = React.useState<string[]>(sections)

  const completeness = assessRiohsCompleteness(checked)
  const dirty = checked.length !== sections.length || checked.some((id) => !sections.includes(id))

  function toggle(id: string, on: boolean) {
    setChecked((current) => on ? [...current, id] : current.filter((item) => item !== id))
  }

  function save() {
    operation.run(() => setRiohsSectionsAction({ documentId, sections: checked }), () => router.refresh())
  }

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Contenido mínimo del Reglamento Interno</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            DS 44 arts. 58 a 61. No se puede publicar una versión a la que le falte un capítulo obligatorio.
          </p>
        </div>
        <Badge variant={completeness.complete ? "success" : "warning"}>
          {completeness.percent}% declarado
        </Badge>
      </div>

      {!completeness.complete && (
        <p role="status" className="mt-3 rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-3 text-sm">
          Faltan {completeness.missing.length} capítulo(s) obligatorio(s) para poder publicar.
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {RIOHS_SECTIONS.map((section) => {
          const isChecked = checked.includes(section.id)
          return (
            <li key={section.id}>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={isChecked}
                  disabled={!canManage}
                  onChange={(event) => toggle(section.id, event.target.checked)}
                />
                <span>
                  <span className={isChecked ? undefined : "text-[var(--color-text-muted)]"}>{section.title}</span>
                  <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">{section.legalBasis}</span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      {canManage && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="button" onClick={save} disabled={operation.pending || !dirty}>Guardar contenido</Button>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
        </div>
      )}

      {canDistribute && currentVersionId && (
        <div className="mt-4 border-t border-[var(--color-border)] pt-4">
          <p className="text-sm">
            El DS 44 art. 56 exige entregar el reglamento a <strong>todas</strong> las personas
            trabajadoras. La asignación masiva alcanza a la dotación activa de la faena del
            documento y omite a quien ya lo tiene.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={distribution.pending}
              onClick={() => distribution.run(
                () => assignSstDocumentToWorkforceAction({
                  documentId,
                  versionId: currentVersionId,
                  assignmentReason: "Entrega del Reglamento Interno de Higiene y Seguridad (DS 44 art. 56).",
                }),
                () => router.refresh(),
              )}
            >
              Asignar a toda la dotación
            </Button>
            {distribution.message && <p role="status" className="text-sm">{distribution.message}</p>}
          </div>
        </div>
      )}
    </section>
  )
}
