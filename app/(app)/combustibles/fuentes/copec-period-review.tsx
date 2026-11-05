"use client"

/**
 * «Cerrar el mes con observaciones» y «Resolver una corrección» en Fuentes de
 * datos (C1 y C2 de la auditoría 2026-11-05).
 *
 * El primero es la salida que faltaba para un mes de Copec con filas inválidas:
 * las válidas ya se proyectaron, así que lo que queda es que una persona lea las
 * inválidas y cierre el mes con su motivo y su nombre (estado terminal
 * `closed_with_issues`, decisión E6). El segundo cierra la revisión de una
 * corrección del proveedor para que la próxima corrida del mes la aplique o la
 * descarte, en vez de volver a marcarla en cada barrido.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { CheckCircle, Warning } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { formatDateTime, formatQty } from "@/lib/utils"
import type { CopecCoverageStatusView, CopecSyncStateView } from "@/lib/combustibles/copec-sync"
import { resolveCopecPeriodWithIssuesAction, resolveCopecRejectionAction } from "./copec-review-actions"

const CHANNEL_LABEL: Record<"TCT" | "TAE", string> = { TCT: "Tarjetas de equipo", TAE: "Abastecimiento TAE" }
const PRODUCT_LABEL: Record<"diesel" | "bluemax", string> = { diesel: "Diésel", bluemax: "BlueMax" }

function monthLabel(monthKey: string): string {
  return new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${monthKey}T00:00:00.000Z`))
}

/** `tct:diesel` → «Tarjetas de equipo · Diésel»: la cuenta nunca se muestra cruda. */
function accountLabel(sourceAccount: string): string {
  const [channel, product] = sourceAccount.split(":")
  const channelLabel = channel === "tct" ? CHANNEL_LABEL.TCT : channel === "tae" ? CHANNEL_LABEL.TAE : null
  const productLabel = product === "diesel" || product === "bluemax" ? PRODUCT_LABEL[product] : null
  return channelLabel && productLabel ? `${channelLabel} · ${productLabel}` : "Copec"
}

/** Una fila de cobertura que se puede cerrar con observaciones. */
function closableRows(coverage: readonly CopecCoverageStatusView[]): CopecCoverageStatusView[] {
  return coverage.filter((row) => row.status !== "closed_with_issues" && (row.canCloseWithIssues || row.status === "incomplete" || row.status === "failed"))
}

export function CopecPeriodReview({ state }: { state: CopecSyncStateView }) {
  const router = useRouter()
  const [closing, setClosing] = React.useState<CopecCoverageStatusView | null>(null)
  const [resolving, setResolving] = React.useState<CopecSyncStateView["openRejections"][number] | null>(null)
  const [decision, setDecision] = React.useState<"resolved" | "dismissed">("resolved")
  const closeOp = useOperation()
  const resolveOp = useOperation()
  const rows = closableRows(state.coverage)
  const rejections = state.openRejections

  if (rows.length === 0 && rejections.length === 0) return null

  return (
    <section aria-labelledby="copec-revision" className="mt-8">
      <div className="mb-3 max-w-3xl">
        <h2 id="copec-revision" className="text-h2 text-[var(--color-text)]">Revisión de Copec</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Lo que quedó esperando una decisión humana. Las filas válidas de un mes con observaciones ya se importaron:
          cerrar el mes no las toca, sólo deja escrito por qué se acepta lo que faltó.
        </p>
      </div>

      {rows.length > 0 ? (
        <>
        <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Meses por cerrar: {monthLabel(state.coverageMonth)}</h3>
        <ul className="mb-4 space-y-2">
          {rows.map((row) => (
            <li key={`${row.channel}:${row.product}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] p-3">
              <div className="min-w-0">
                <p className="font-medium text-[var(--color-text)]">{CHANNEL_LABEL[row.channel]} · {PRODUCT_LABEL[row.product]}</p>
                <p className="text-sm text-[var(--color-text-muted)]">
                  {row.rowsReceived === 0
                    ? "Sin informe recibido para ese mes."
                    : `${formatQty(row.rowsAccepted)} aceptadas, ${formatQty(row.rowsRejected)} rechazadas y ${formatQty(row.rowsPending)} sin asignar de ${formatQty(row.rowsReceived)} filas.`}
                </p>
                {row.closeWithIssuesBlockedReason ? (
                  <p className="text-xs text-[var(--color-text-muted)]">{row.closeWithIssuesBlockedReason}</p>
                ) : null}
              </div>
              {row.canCloseWithIssues ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => { closeOp.setMessage(""); setClosing(row) }}>
                  <Warning size={14} aria-hidden />Cerrar con observaciones
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        </>
      ) : null}

      {rejections.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Correcciones y filas rechazadas por revisar</h3>
          <ul className="space-y-2">
            {rejections.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] p-3">
                <div className="min-w-0">
                  <p className="font-medium text-[var(--color-text)]">{accountLabel(item.sourceAccount)} · {item.sourcePlate ?? "sin patente"}</p>
                  <p className="text-sm text-[var(--color-text-muted)]">{item.message}</p>
                  {item.quantity !== null ? (
                    <p className="text-xs text-[var(--color-text-muted)]">{formatQty(item.quantity)} L · {item.occurredAt ? formatDateTime(item.occurredAt) : "sin fecha"}</p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  {/* Sólo una corrección del proveedor reemplaza evidencia; una fila inválida se marca como revisada. */}
                  {item.isCorrection ? (
                    <Button type="button" variant="secondary" size="sm" onClick={() => { resolveOp.setMessage(""); setDecision("resolved"); setResolving(item) }}>
                      <CheckCircle size={14} aria-hidden />Aprobar corrección
                    </Button>
                  ) : null}
                  <Button type="button" variant="ghost" size="sm" onClick={() => { resolveOp.setMessage(""); setDecision("dismissed"); setResolving(item) }}>
                    {item.isCorrection ? "Descartar" : "Marcar revisada"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ConfirmDialog
        open={closing !== null}
        onOpenChange={(open) => { if (!open && !closeOp.pending) { setClosing(null); closeOp.setMessage("") } }}
        title="¿Cerrar el mes con observaciones?"
        description={closing
          ? `Se cerrará ${CHANNEL_LABEL[closing.channel]} · ${PRODUCT_LABEL[closing.product]} de ${monthLabel(state.coverageMonth)} como «cerrado con observaciones». Es un cierre terminal: la sincronización no volverá a pedir ese mes. Las ${formatQty(closing.rowsRejected)} filas rechazadas quedan registradas en la bitácora con tu motivo.`
          : ""}
        reasonLabel="Evidencia revisada"
        reasonPlaceholder="Ej.: el informe trae una fila con volumen negativo; el resto se importó y se verificó contra el portal de Copec."
        confirmLabel="Cerrar el mes"
        variant="warning"
        loading={closeOp.pending}
        error={closeOp.messageTone === "error" ? closeOp.message || undefined : undefined}
        onConfirm={(reason) => {
          if (!closing) return
          closeOp.run(
            () => resolveCopecPeriodWithIssuesAction({ month: state.coverageMonth, channel: closing.channel, product: closing.product, reason }),
            () => {
              toast.success("Mes cerrado con observaciones")
              setClosing(null)
              router.refresh()
            },
          )
        }}
      />

      <ConfirmDialog
        open={resolving !== null}
        onOpenChange={(open) => { if (!open && !resolveOp.pending) { setResolving(null); resolveOp.setMessage("") } }}
        title={decision === "resolved" ? "¿Aprobar la corrección del proveedor?" : resolving?.isCorrection === false ? "¿Marcar la fila como revisada?" : "¿Descartar la observación?"}
        description={decision === "resolved"
          ? "La próxima sincronización de ese mes reemplaza la carga anterior por la corregida: la original queda como reemplazada y deja de compararse."
          : resolving?.isCorrection === false
            ? "La fila sigue fuera de los consumos importados; queda registrado que alguien la revisó y por qué no se carga."
            : "La evidencia original se mantiene y esta observación se cierra sin cambiar ninguna carga."}
        reasonLabel="Motivo de la decisión"
        reasonPlaceholder={decision === "resolved" ? "Ej.: Copec corrigió la guía; el volumen nuevo coincide con el vale de despacho." : "Ej.: se revisó con el vale de despacho y la carga original es la correcta."}
        confirmLabel={decision === "resolved" ? "Aprobar corrección" : resolving?.isCorrection === false ? "Marcar revisada" : "Descartar observación"}
        variant="warning"
        loading={resolveOp.pending}
        error={resolveOp.messageTone === "error" ? resolveOp.message || undefined : undefined}
        onConfirm={(reason) => {
          if (!resolving) return
          resolveOp.run(
            () => resolveCopecRejectionAction({ rejectionId: resolving.id, decision, reason }),
            () => {
              toast.success(decision === "resolved" ? "Corrección aprobada: se aplicará en la próxima sincronización" : resolving.isCorrection ? "Observación descartada" : "Fila marcada como revisada")
              setResolving(null)
              router.refresh()
            },
          )
        }}
      />
    </section>
  )
}
