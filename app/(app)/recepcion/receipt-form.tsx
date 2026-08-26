"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { CheckCircle, Warning } from "@phosphor-icons/react"
import { SubmitButton } from "@/components/ui/submit-button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { INITIAL_STATE } from "@/lib/form-state"
import { registerReceiptAction } from "./actions"
import { formatQty } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/operations"
import Link from "next/link"
import { describeStageProgress } from "./receipt-form-progress"
import type { ReceiptOcItem, ReceiptStage } from "./receipt-form.types"

export type { ReceiptOcItem } from "./receipt-form.types"

/* ── Receipt form ─────────────────────────────────────────────────────────────── */

export function ReceiptForm({
  purchaseOrderId,
  orderCode,
  orderWorksiteName,
  officeName,
  items,
  canOffice,
  canFaena,
  deliveryMode = "via_oficina",
  assignment,
}: {
  purchaseOrderId: string
  orderCode:       string
  orderWorksiteName: string
  /** Nombre real de la faena-oficina; nunca un literal (ver officeWorksiteLabel). */
  officeName:      string
  items:           ReceiptOcItem[]
  canOffice:       boolean
  canFaena:        boolean
  deliveryMode?:   "via_oficina" | "directo_faena"
  /** Bloque opcional de asignación, servido por la página y pintado junto al envío. */
  assignment?:     React.ReactNode
}) {
  const getRemaining = React.useCallback((item: ReceiptOcItem, stage: ReceiptStage) => {
    if (stage === "office") return Math.max(0, item.quantity - item.quantityOfficeReceived)
    // Direct-to-faena: cap at the ordered quantity (goods never pass through office).
    if (deliveryMode === "directo_faena") return Math.max(0, item.quantity - item.quantityReceived)
    // Via-oficina: faena caps STRICTLY at what already arrived at office.
    return Math.max(0, item.quantityOfficeReceived - item.quantityReceived)
  }, [deliveryMode])

  // A stage is offered only when the user can perform it AND there is something left to receive.
  // Las OC de despacho directo nunca pasan por oficina. El permiso de oficina
  // no cambia ese contrato: mostrar ese botón enviaba al usuario por un camino
  // que `registerReceipt` debía rechazar en el servidor.
  const officeAvailable = deliveryMode !== "directo_faena"
    && canOffice
    && items.some((i) => getRemaining(i, "office") > 0)
  const faenaAvailable  = canFaena  && items.some((i) => getRemaining(i, "faena")  > 0)

  const [guideNo, setGuideNo] = React.useState<string>("")
  const [notes,   setNotes]   = React.useState<string>("")
  const [stage,   setStage]   = React.useState<ReceiptStage>(officeAvailable ? "office" : "faena")
  const [qtys,    setQtys]    = React.useState<Record<string, number>>({})
  const [rejs,    setRejs]    = React.useState<Record<string, number>>({})
  const [dmgs,    setDmgs]    = React.useState<Record<string, number>>({})

  const [state, action] = useActionState<ActionState, FormData>(registerReceiptAction, INITIAL_STATE)

  const [prevItems, setPrevItems] = React.useState(items)
  const [prevStage, setPrevStage] = React.useState(stage)
  if (items !== prevItems || stage !== prevStage) {
    setPrevItems(items)
    setPrevStage(stage)
    setQtys(Object.fromEntries(items.map((i) => [i.id, getRemaining(i, stage)])))
    setRejs({})
    setDmgs({})
  }

  React.useEffect(() => {
    if (state.ok === false && state.message && state !== INITIAL_STATE) {
      toast.error(state.message)
    }
  }, [state])

  const itemsJson = JSON.stringify(
    items.map((i) => ({
      purchaseOrderItemId: i.id,
      // El mismo fallback que muestra el input (`qtys[id] ?? remaining`). Antes
      // enviaba `?? 0`: el campo mostraba la cantidad pendiente precargada pero,
      // si el usuario no lo tocaba, `qtys` seguía vacío y el payload iba en 0.
      // Con recibido/rechazado/dañado en 0 el schema rechaza la línea, así que
      // aceptar la cantidad sugerida —el camino feliz del formulario que más se
      // usa en faena— fallaba siempre con "Revisa los datos de recepción".
      // Lo que se ve y lo que se envía tienen que ser el mismo número
      // (auditoría UI/UX 2026-07-29, A-37).
      quantityReceived:    qtys[i.id]     ?? getRemaining(i, stage),
      quantityRejected:    rejs[i.id]     ?? 0,
      quantityDamaged:     dmgs[i.id]     ?? 0,
      notes:               null,
    }))
  )
  const progress = describeStageProgress(items, deliveryMode)
  const submitLabel = stage === "office" ? "Registrar llegada a oficina" : "Registrar recepción en faena"
  const pendingLineCount = items.filter((item) => getRemaining(item, stage) > 0).length
  const receivingLineCount = items.filter(
    (item) => ((qtys[item.id] ?? getRemaining(item, stage)) + (rejs[item.id] ?? 0) + (dmgs[item.id] ?? 0)) > 0,
  ).length
  // Una línea está sobre-cargada si recibido+rechazado+dañado excede lo pendiente —
  // antes esto solo se detectaba en el servidor, después de enviar.
  const overBookedItemIds = items
    .filter((item) => {
      const total = (qtys[item.id] ?? getRemaining(item, stage)) + (rejs[item.id] ?? 0) + (dmgs[item.id] ?? 0)
      return total > getRemaining(item, stage)
    })
    .map((item) => item.id)
  const overBookedItemIdSet = new Set(overBookedItemIds)
  const hasOverBooked = overBookedItemIds.length > 0

  return (
    <form action={action} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
      <input type="hidden" name="itemsJson"        value={itemsJson} />
      <input type="hidden" name="stage"            value={stage} />

      {/* `min-w-0` no es cosmético: como grid item hereda `min-width:auto`, así que
          el `min-w-[440px]` de la tabla de ítems fijaba el mínimo de la columna en
          442px. El shell (`main`) tiene `overflow-x-hidden`, de modo que a 390px el
          exceso se recortaba **sin scroll** y la columna "Dañado" quedaba
          inalcanzable. Con el mínimo en 0 la columna cabe y el scroll horizontal
          vuelve a vivir dentro de la tabla (auditoría UI/UX 2026-07-29, A-02). */}
      <div className="min-w-0 space-y-6">
        {/* Header */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field
            label="Guía o factura"
            htmlFor="receiptDispatchGuideNo"
            /* El aviso vivía en la barra lateral, al otro extremo de la pantalla
               del campo que explica. */
            helper={guideNo.trim()
              ? "La guía queda asociada a esta recepción."
              : "Puedes registrar la recepción sin guía si la operación aún no la entrega."}
            error={state.fieldErrors?.dispatchGuideNo?.[0]}
          >
            <Input
              id="receiptDispatchGuideNo"
              name="dispatchGuideNo"
              value={guideNo}
              onChange={(e) => setGuideNo(e.target.value)}
              placeholder="Ej: GD-000123"
              error={!!state.fieldErrors?.dispatchGuideNo}
            />
          </Field>

        <Field label="Tipo de recepción" className="md:col-span-2" error={state.fieldErrors?.stage?.[0]}>
          <div className="grid gap-2 sm:grid-cols-2">
            {deliveryMode !== "directo_faena" && canOffice && (
              <button
                type="button"
                onClick={() => setStage("office")}
                disabled={!officeAvailable}
                aria-pressed={stage === "office"}
                className={`rounded-[var(--radius)] border px-3 py-2 text-left transition-colors disabled:opacity-50 ${stage === "office" ? "border-[var(--color-primary-line)] bg-[var(--color-primary-tint)]" : "border-[var(--color-border)] bg-[var(--color-surface-2)]"}`}
              >
                <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-text)]">
                  {stage === "office" && <CheckCircle size={14} weight="fill" className="shrink-0 text-[var(--color-primary)]" />}
                  <span className="min-w-0 flex-1">Recepción en oficina</span>
                  <span className={`shrink-0 text-xs font-normal tabular-nums ${progress.officeComplete ? "text-[var(--color-success)]" : "text-[var(--color-text-subtle)]"}`}>
                    {progress.office}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                  Proveedor entrega en {officeName}. No suma stock ni cierra ítems.
                </p>
              </button>
            )}
            {canFaena && (
              /* `disabled:opacity-50` dejaba el texto que explica **por qué** no se
                 puede avanzar en 2.08:1, medido (§5.6). La exención de WCAG 1.4.3
                 para controles inactivos no aplica a la instrucción que el usuario
                 necesita leer justamente cuando el control está bloqueado: se
                 atenúa con color, no con opacidad sobre todo el subárbol. */
              <button
                type="button"
                onClick={() => setStage("faena")}
                disabled={!faenaAvailable}
                aria-pressed={stage === "faena"}
                className={`rounded-[var(--radius)] border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed ${stage === "faena" ? "border-[var(--color-primary-line)] bg-[var(--color-primary-tint)]" : "border-[var(--color-border)] bg-[var(--color-surface-2)]"}`}
              >
                <p className={`flex items-center gap-1.5 text-sm font-medium ${faenaAvailable ? "text-[var(--color-text)]" : "text-[var(--color-text-muted)]"}`}>
                  {stage === "faena" && <CheckCircle size={14} weight="fill" className="shrink-0 text-[var(--color-primary)]" />}
                  <span className="min-w-0 flex-1">Recepción en faena</span>
                  <span className={`shrink-0 text-xs font-normal tabular-nums ${progress.faenaComplete ? "text-[var(--color-success)]" : "text-[var(--color-text-subtle)]"}`}>
                    {progress.faena}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                  {faenaAvailable
                    ? deliveryMode === "directo_faena"
                      ? `Proveedor entrega directamente en ${orderWorksiteName}. Actualiza stock y trazabilidad.`
                      : `Oficina distribuye a ${orderWorksiteName}. Actualiza stock y trazabilidad.`
                    : deliveryMode === "directo_faena"
                      ? "No quedan ítems pendientes de recepción en faena."
                      : "Disponible una vez registrada la llegada a oficina."}
                </p>
              </button>
            )}
          </div>
        </Field>
        </div>

        {/* Items table */}
        <div className="flex flex-col gap-2">
          <h2 className="text-h2 text-[var(--color-text)]">
            Ítems de la OC {orderCode}
          </h2>

        <div className="hidden overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] divide-y divide-[var(--color-border)] md:block">
          {/* Header */}
          <div className="grid min-w-[440px] grid-cols-[minmax(0,1fr)_84px_84px_84px] gap-3 px-4 py-2 bg-[var(--color-surface-2)] text-xs font-medium text-[var(--color-text-muted)]">
            <span>Producto</span>
            <span className="text-right">Recibido</span>
            <span className="text-right">Rechazado</span>
            <span className="text-right">Dañado</span>
          </div>

          {items.map((item) => {
            const remaining = getRemaining(item, stage)
            const pending   = remaining > 0
            const overBooked = overBookedItemIdSet.has(item.id)

            return (
              <div key={item.id} className={`grid min-w-[440px] grid-cols-[minmax(0,1fr)_84px_84px_84px] gap-3 px-4 py-3 ${!pending ? "opacity-50" : ""}`}>
                <div>
                  <div className="flex items-center gap-2">
                    {item.productSku && (
                      <span className="font-mono text-[11px] text-[var(--color-text-subtle)] bg-[var(--color-surface-2)] px-1.5 py-0.5 rounded">
                        {item.productSku}
                      </span>
                    )}
                    <span className="text-sm text-[var(--color-text)]">{item.productName}</span>
                  </div>
                  <div className="text-xs text-[var(--color-text-subtle)] mt-0.5">
                    Pedido: {formatQty(item.quantity, item.unitOfMeasure)}
                    {item.quantityOfficeReceived > 0 && ` · En oficina: ${formatQty(item.quantityOfficeReceived, item.unitOfMeasure)}`}
                    {item.quantityReceived > 0 && ` · Ya recibido: ${formatQty(item.quantityReceived, item.unitOfMeasure)}`}
                    {!pending && " · Completamente recibido"}
                  </div>
                  {overBooked && (
                    <p className="text-xs text-[var(--color-danger)] mt-0.5">
                      Recibido + rechazado + dañado supera lo pendiente ({formatQty(remaining, item.unitOfMeasure)}).
                    </p>
                  )}
                </div>

                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max={remaining}
                  value={qtys[item.id] ?? remaining}
                  onChange={(e) => setQtys((p) => ({ ...p, [item.id]: parseFloat(e.target.value) || 0 }))}
                  className="h-7 text-sm tabular-nums text-right"
                  disabled={!pending}
                  error={overBooked}
                  aria-label={`Cantidad a recibir de ${item.productName}`}
                />

                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max={remaining}
                  value={rejs[item.id] ?? 0}
                  onChange={(e) => setRejs((p) => ({ ...p, [item.id]: parseFloat(e.target.value) || 0 }))}
                  className="h-7 text-sm tabular-nums text-right"
                  disabled={!pending}
                  error={overBooked}
                  aria-label={`Cantidad rechazada de ${item.productName}`}
                />

                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max={remaining}
                  value={dmgs[item.id] ?? 0}
                  onChange={(e) => setDmgs((p) => ({ ...p, [item.id]: parseFloat(e.target.value) || 0 }))}
                  className="h-7 text-sm tabular-nums text-right"
                  disabled={!pending}
                  error={overBooked}
                  aria-label={`Cantidad dañada de ${item.productName}`}
                />
              </div>
            )
          })}
        </div>
        <div className="grid gap-3 md:hidden">
          {items.map((item) => {
            const remaining = getRemaining(item, stage)
            const pending = remaining > 0
            const overBooked = overBookedItemIdSet.has(item.id)
            return (
              <fieldset key={item.id} disabled={!pending} className={`rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 ${!pending ? "opacity-60" : ""}`}>
                <legend className="sr-only">Recepción de {item.productName}</legend>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text)]">{item.productName}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                      Pedido: {formatQty(item.quantity, item.unitOfMeasure)} · pendiente: {formatQty(remaining, item.unitOfMeasure)}
                    </p>
                  </div>
                  {item.productSku && <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-text-subtle)]">{item.productSku}</span>}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Field label="Recibido">
                    <Input type="number" inputMode="decimal" step="0.01" min="0" max={remaining} value={qtys[item.id] ?? remaining} onChange={(event) => setQtys((current) => ({ ...current, [item.id]: parseFloat(event.target.value) || 0 }))} error={overBooked} aria-label={`Cantidad recibida de ${item.productName}`} />
                  </Field>
                  <Field label="Rechazado">
                    <Input type="number" inputMode="decimal" step="0.01" min="0" max={remaining} value={rejs[item.id] ?? 0} onChange={(event) => setRejs((current) => ({ ...current, [item.id]: parseFloat(event.target.value) || 0 }))} error={overBooked} aria-label={`Cantidad rechazada de ${item.productName}`} />
                  </Field>
                  <Field label="Dañado">
                    <Input type="number" inputMode="decimal" step="0.01" min="0" max={remaining} value={dmgs[item.id] ?? 0} onChange={(event) => setDmgs((current) => ({ ...current, [item.id]: parseFloat(event.target.value) || 0 }))} error={overBooked} aria-label={`Cantidad dañada de ${item.productName}`} />
                  </Field>
                </div>
                {overBooked && <p className="mt-2 text-xs text-[var(--color-danger)]">La suma supera el saldo pendiente de {formatQty(remaining, item.unitOfMeasure)}.</p>}
                {!pending && <p className="mt-2 text-xs text-[var(--color-text-subtle)]">Completamente recibido en esta etapa.</p>}
              </fieldset>
            )
          })}
        </div>
        <p className="text-xs text-[var(--color-text-subtle)]">
          Registra en <strong>Rechazado</strong> o <strong>Dañado</strong> lo que llegó pero no ingresa a stock. Una línea 100% rechazada va con Recibido en 0.
        </p>
        </div>

        {/* Notes */}
        <Field label="Observaciones de recepción" htmlFor="receiptNotes" error={state.fieldErrors?.notes?.[0]}>
          <Textarea
            id="receiptNotes"
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Estado del embalaje, condiciones de entrega..."
            error={!!state.fieldErrors?.notes}
          />
        </Field>

        {/* Error */}
        {state.ok === false && state.message && state !== INITIAL_STATE && (
          <p className="text-sm text-[var(--color-danger)] flex items-center gap-1.5">
            <Warning size={14} /> {state.message}
          </p>
        )}

        {assignment}

        {/* Submit */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-[var(--color-border)]">
          <Link
            href="/recepcion"
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            Cancelar
          </Link>
          {/* El rótulo sigue a la etapa: en oficina nada "se recibe" —la propia
              tarjeta dice que no suma stock ni cierra ítems—, sólo se registra
              que llegó. Mismo vocabulario que el CTA de la cola de pendientes. */}
          <SubmitButton
            label={submitLabel}
            loadingLabel="Guardando..."
            variant="primary"
            disabled={hasOverBooked}
          />
        </div>
      </div>

      <aside className="h-fit rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-card)] xl:sticky xl:top-6">
        {/* Sólo lo que no está en ningún otro control de la pantalla: la orden
            está en el título y la etapa en el selector (A5). */}
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-subtle)]">Resumen recepción</p>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[var(--color-text-muted)]">Líneas pendientes</span>
            <span className="tabular-nums text-[var(--color-text)]">{pendingLineCount}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[var(--color-text-muted)]">Con cantidad</span>
            <span className="tabular-nums text-[var(--color-text)]">{receivingLineCount}</span>
          </div>
          {hasOverBooked && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--color-danger)]">Líneas con error</span>
              <span className="tabular-nums text-[var(--color-danger)]">{overBookedItemIds.length}</span>
            </div>
          )}
        </div>
      </aside>
    </form>
  )
}
