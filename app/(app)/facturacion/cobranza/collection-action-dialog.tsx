"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatMoney } from "@/lib/services/billing/money"
import { recordCollectionActionAction, registerManualPaymentAction } from "./actions"

/**
 * Registrar una gestión de cobranza o un pago sobre una factura.
 *
 * Son dos formularios distintos a propósito: registrar que se llamó al cliente
 * y afirmar que el dinero llegó son actos de naturaleza distinta, exigen
 * permisos distintos (`manage_collections` vs `confirm_payments`) y confundirlos
 * en un solo formulario invitaría a marcar pagos por inercia.
 */
export function CollectionActionDialog({
  invoiceId,
  folio,
  currency,
  outstandingAmount,
  users,
  canConfirmPayments,
  today,
}: {
  invoiceId: string
  folio: number
  currency: string
  outstandingAmount: number
  users: { id: string; name: string }[]
  canConfirmPayments: boolean
  today: string
}) {
  const router = useRouter()
  const [mode, setMode] = useState<"action" | "payment" | null>(null)
  const [isPending, startTransition] = useTransition()
  const [actionType, setActionType] = useState("call")

  function close() {
    setMode(null)
    setActionType("call")
  }

  return (
    <>
      <div className="flex flex-col gap-1 text-xs">
        <button
          type="button"
          onClick={() => setMode("action")}
          className="text-left font-medium text-[var(--color-primary-ink)] hover:underline"
        >
          Registrar gestión
        </button>
        {canConfirmPayments && (
          <button
            type="button"
            onClick={() => setMode("payment")}
            className="text-left font-medium text-[var(--color-primary-ink)] hover:underline"
          >
            Registrar pago
          </button>
        )}
      </div>

      {/* ── Gestión de cobranza ──────────────────────────────────────────── */}
      <Dialog open={mode === "action"} onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Gestión de cobranza · Folio {folio}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            action={(formData) => {
              const commitmentAmount = String(formData.get("commitmentAmount") ?? "")
              startTransition(async () => {
                const result = await recordCollectionActionAction({
                  invoiceId,
                  actionDate: String(formData.get("actionDate") ?? ""),
                  actionType,
                  channel: String(formData.get("channel") ?? "") || null,
                  outcome: String(formData.get("outcome") ?? ""),
                  contactName: String(formData.get("contactName") ?? "") || null,
                  commitmentDate: String(formData.get("commitmentDate") ?? "") || null,
                  commitmentAmount: commitmentAmount === "" ? null : Number(commitmentAmount),
                  nextActionDate: String(formData.get("nextActionDate") ?? "") || null,
                  notes: String(formData.get("notes") ?? "") || null,
                  assigneeUserId: String(formData.get("assigneeUserId") ?? "") || null,
                })
                if (result.ok) {
                  toast.success(result.message)
                  close()
                  router.refresh()
                } else {
                  toast.error(result.message)
                }
              })
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label="Fecha" required>
                <input name="actionDate" type="date" required defaultValue={today} className={inputClass} />
              </Field>
              <Field label="Tipo" required>
                <select
                  name="actionType"
                  value={actionType}
                  onChange={(event) => setActionType(event.target.value)}
                  className={inputClass}
                >
                  <option value="call">Llamada</option>
                  <option value="email">Correo</option>
                  <option value="meeting">Reunión</option>
                  <option value="note">Observación</option>
                  <option value="claim">Reclamo formal</option>
                  <option value="commitment">Compromiso de pago</option>
                  <option value="dispute">Disputa</option>
                </select>
              </Field>
              <Field label="Canal">
                <select name="channel" className={inputClass}>
                  <option value="">Sin especificar</option>
                  <option value="phone">Teléfono</option>
                  <option value="email">Correo</option>
                  <option value="in_person">Presencial</option>
                  <option value="portal">Portal del cliente</option>
                  <option value="letter">Carta</option>
                  <option value="other">Otro</option>
                </select>
              </Field>
              <Field label="Resultado" required>
                <select name="outcome" required defaultValue="contacted" className={inputClass}>
                  <option value="contacted">Contactado</option>
                  <option value="no_answer">Sin respuesta</option>
                  <option value="promised_payment">Prometió pago</option>
                  <option value="disputed">Objetó el cobro</option>
                  <option value="escalated">Escalado</option>
                  <option value="resolved">Resuelto</option>
                  <option value="other">Otro</option>
                </select>
              </Field>
              <Field label="Contacto">
                <input name="contactName" maxLength={160} className={inputClass} />
              </Field>
              <Field label="Responsable">
                <select name="assigneeUserId" className={inputClass}>
                  <option value="">Yo</option>
                  {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                </select>
              </Field>
              <Field
                label="Fecha comprometida"
                hint={actionType === "commitment" ? "Obligatoria para un compromiso de pago." : undefined}
              >
                <input
                  name="commitmentDate"
                  type="date"
                  required={actionType === "commitment"}
                  className={inputClass}
                />
              </Field>
              <Field label="Monto comprometido">
                <input name="commitmentAmount" type="number" min={0} step="0.01" className={inputClass} />
              </Field>
            </div>

            <Field label="Notas">
              <textarea name="notes" rows={2} maxLength={2000} className={inputClass} />
            </Field>
            <Field label="Próxima gestión">
              <input name="nextActionDate" type="date" className={inputClass} />
            </Field>

            <button type="submit" disabled={isPending} className={primaryButtonClass}>
              {isPending ? "Guardando…" : "Registrar gestión"}
            </button>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Pago manual ──────────────────────────────────────────────────── */}
      <Dialog open={mode === "payment"} onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar pago · Folio {folio}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            action={(formData) => {
              startTransition(async () => {
                const result = await registerManualPaymentAction({
                  invoiceId,
                  paymentDate: String(formData.get("paymentDate") ?? ""),
                  amount: Number(formData.get("amount") ?? 0),
                  currency,
                  method: String(formData.get("method") ?? "") || null,
                  notes: String(formData.get("notes") ?? "") || null,
                })
                if (result.ok) {
                  toast.success(result.message)
                  close()
                  router.refresh()
                } else {
                  toast.error(result.message)
                }
              })
            }}
          >
            <p className="rounded-[var(--radius-md)] bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
              Saldo pendiente: <strong className="tabular-nums text-[var(--color-text)]">
                {formatMoney(outstandingAmount, currency)}
              </strong>
              . Registrar un pago acá lo deja <strong>confirmado</strong> y descuenta del saldo de inmediato.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Fecha del pago" required>
                <input name="paymentDate" type="date" required defaultValue={today} className={inputClass} />
              </Field>
              <Field label={`Monto (${currency})`} required>
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  required
                  defaultValue={outstandingAmount}
                  className={inputClass}
                />
              </Field>
            </div>

            <Field label="Medio de pago">
              <input name="method" maxLength={60} placeholder="Transferencia, cheque, factoring…" className={inputClass} />
            </Field>
            <Field label="Notas">
              <textarea name="notes" rows={2} maxLength={1000} className={inputClass} />
            </Field>

            <button type="submit" disabled={isPending} className={primaryButtonClass}>
              {isPending ? "Guardando…" : "Confirmar pago"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

const inputClass =
  "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-text)]"

const primaryButtonClass =
  "w-full rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3 py-2 text-sm font-medium text-[var(--color-primary-contrast)] disabled:opacity-60"

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs font-medium text-[var(--color-text-muted)]">
        {label}{required && <span className="text-[var(--color-danger-ink)]"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-[var(--color-text-subtle)]">{hint}</span>}
    </label>
  )
}
