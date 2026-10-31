"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ArrowSquareOut, Lock } from "@phosphor-icons/react"
import { Callout } from "@/components/ui/callout"
import { Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { FuelInboxItem } from "@/lib/combustibles/inbox/detail-types"
import { fuelEquipmentHref } from "@/lib/combustibles/routes"
import { formatDateTime } from "@/lib/utils"
import { CaseActions } from "./case-actions"
import { DecideLoadButtons } from "./decide-load-buttons"
import { InboxEvidence } from "./inbox-evidence"
import { InboxRowBadges } from "./inbox-row-badges"
import { LinkPlateForm } from "./link-plate-form"
import { ReopenDecisionButton } from "./reopen-decision-button"
import { ResolveRequestForm } from "./resolve-request-form"

const QUESTION: Record<FuelInboxItem["row"]["kind"], string> = {
  carga: "¿Esta carga cuenta para el rendimiento del equipo?",
  patente: "¿A qué equipo corresponde esta patente?",
  caso: "Caso abierto por una regla de detección",
  pedido: "Pedido de revisión de una persona",
}

const EFFECT: Partial<Record<FuelInboxItem["row"]["kind"], string>> = {
  carga: "Mientras nadie decide, sus litros cuentan, pero no entra a los promedios del equipo. Tu decisión queda registrada con tu nota.",
}

/**
 * La hoja de decisión de la bandeja. Se abre con `?item=<tipo>:<id>`: es la
 * propia URL la que dice qué está abierto, así que recargar, volver atrás o
 * compartir el enlace llevan a la misma hoja. Cerrarla quita sólo ese parámetro.
 *
 * Cada tipo muestra el dato que lo explica y lo que se puede hacer con él, según
 * los permisos de la sesión (`canAct` de la fila ya trae permiso + alcance).
 * `stableHeight` mantiene la caja del mismo alto cuando aparece la nota o cambia
 * la vista de un caso.
 */
export function InboxDetailSheet({ item, canReviewCases, canResolveCases }: { item: FuelInboxItem; canReviewCases: boolean; canResolveCases: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { row } = item

  function close() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("item")
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const decided = row.decided
  const load = item.extras.load
  const label = row.kind === "carga" ? `${row.equipmentLabel}, ${row.datum}` : row.equipmentLabel
  const kindCase = item.extras.case

  return (
    <Sheet open onOpenChange={(open) => { if (!open) close() }}>
      <SheetContent stableHeight className="sm:max-w-xl">
        <SheetHeader>
          <div className="min-w-0">
            {/* Un caso cerrado dice su desenlace («Descartado») y no repite su estado al lado. */}
            <InboxRowBadges
              className="mb-2"
              label={row.kind === "caso" ? row.reasonLabel : row.title}
              kind={row.kind}
              severity={row.severity}
              caseStatus={kindCase?.status}
              decided={decided}
            />
            <SheetTitle>{row.equipmentLabel}{row.worksiteName ? ` · ${row.worksiteName}` : ""}</SheetTitle>
            <SheetDescription>{QUESTION[row.kind]}</SheetDescription>
          </div>
          <SheetCloseButton />
        </SheetHeader>

        <SheetBody className="space-y-5">
          {row.kind !== "caso" && row.kind !== "pedido" ? <p className="text-sm font-medium text-[var(--color-text)]">{row.datum}</p> : null}
          <InboxEvidence evidence={item.evidence} loadHref={row.href} />

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {row.href ? (
              <Link href={row.href} className="inline-flex items-center gap-1 font-medium text-[var(--color-primary)] hover:underline">
                {row.kind === "patente" ? "Abrir el lote" : "Abrir la carga"} <ArrowSquareOut size={14} aria-hidden />
              </Link>
            ) : null}
            {row.vehicleId && row.kind !== "patente" ? (
              <Link href={fuelEquipmentHref(row.vehicleId)} className="inline-flex items-center gap-1 font-medium text-[var(--color-primary)] hover:underline">
                Ficha del equipo <ArrowSquareOut size={14} aria-hidden />
              </Link>
            ) : null}
          </div>

          {item.history.length > 0 ? (
            <ol aria-label="Historial" className="space-y-2 border-l border-[var(--color-border)] pl-4">
              {item.history.map((entry, index) => (
                <li key={`${entry.at}-${index}`} className="text-sm">
                  <span className="font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{formatDateTime(entry.at)}</span>
                  <p className="text-[var(--color-text)]">
                    {entry.byName ? <span className="font-medium">{entry.byName}: </span> : null}
                    {entry.text}
                  </p>
                </li>
              ))}
            </ol>
          ) : null}

          {decided ? (
            <div className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm">
              <p className="font-medium text-[var(--color-text)]">
                {decided.outcome} · {decided.byName ?? "Sin responsable"} · {formatDateTime(decided.at)}
              </p>
              {decided.note ? <p className="text-[var(--color-text-muted)]">«{decided.note}»</p> : null}
            </div>
          ) : null}

          {row.kind === "carga" && load?.voided ? (
            <Callout tone="info" icon={<Lock size={16} aria-hidden />}>La carga está anulada: no hay nada que decidir.</Callout>
          ) : !row.canAct ? (
            <Callout tone="info" icon={<Lock size={16} aria-hidden />}>
              Puedes ver esto. {row.kind === "patente" ? "Vincular patentes requiere el permiso de gestión de equipos." : row.kind === "caso" ? "Trabajar un caso requiere el permiso de revisión de anomalías." : row.kind === "pedido" ? "Resolver un pedido requiere el permiso de revisión de cargas." : "Decidir si una carga cuenta requiere el permiso de aprobación de cargas marcadas."}
            </Callout>
          ) : null}

          {row.kind === "carga" && load && row.canAct ? (
            load.reviewStatus === "flagged" ? (
              <DecideLoadButtons loadIds={[row.id]} reasonCodes={row.reasonCodes} label={label} onDone={close} />
            ) : load.reviewStatus === "approved" || load.reviewStatus === "rejected" ? (
              <ReopenDecisionButton loadId={row.id} label={label} />
            ) : null
          ) : null}

          {row.kind === "caso" ? <CaseActions item={item} canReview={canReviewCases} canResolve={canResolveCases} /> : null}

          {row.kind === "patente" && item.extras.plate && row.canAct ? (
            <LinkPlateForm batchId={item.extras.plate.batchId} plate={item.extras.plate.plate} options={item.extras.plate.vehicleOptions} onDone={close} />
          ) : null}

          {row.kind === "pedido" && item.extras.request?.status === "open" && row.canAct ? (
            <ResolveRequestForm markId={item.extras.request.id} onDone={close} />
          ) : null}

          {!decided && EFFECT[row.kind] ? <p className="text-xs text-[var(--color-text-muted)]">{EFFECT[row.kind]}</p> : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
