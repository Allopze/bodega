"use client"

import { useState, useTransition } from "react"
import { DatePicker } from "@/components/ui/date-picker"
import { DotsThreeVertical } from "@phosphor-icons/react"
import { Button, buttonVariants } from "@/components/ui/button"
import { OptionSelect } from "@/components/ui/option-select"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatMoney } from "@/lib/services/billing/money"
import { recordCollectionActionAction, registerManualPaymentAction } from "./actions"

/**
 * Clave de idempotencia del pago manual (COB-003). `crypto.randomUUID` existe
 * en todo navegador que sirva esta pantalla (contexto seguro); el respaldo usa
 * `getRandomValues`, nunca `Math.random`: una clave adivinable no serviría para
 * distinguir un reintento de un pago nuevo.
 */
function newPaymentRequestId(): string {
  const source: Crypto = globalThis.crypto
  if (typeof source.randomUUID === "function") return source.randomUUID()
  const bytes = source.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

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
  /**
   * COB-003. Dos piezas de estado para el pago manual:
   *
   * - `paymentRequestId` es la clave de idempotencia, UNA por apertura del
   *   diálogo. Se reenvía en cada reintento, así que el doble clic, la doble
   *   pestaña y el reintento por red colapsan sobre la misma fila en la base.
   * - `duplicateWarning` guarda la advertencia de "ya existe un pago idéntico"
   *   para que el segundo envío la reconozca. Antes esto era una ventana de
   *   dos minutos en el servidor: pasada, el mismo pago entraba sin aviso.
   */
  const [paymentRequestId, setPaymentRequestId] = useState<string | null>(null)
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)

  function openPayment() {
    setPaymentRequestId(newPaymentRequestId())
    setDuplicateWarning(null)
    setMode("payment")
  }

  function close() {
    setMode(null)
    setActionType("call")
    setPaymentRequestId(null)
    setDuplicateWarning(null)
  }

  return (
    <>
      {/* Menú por fila en vez de dos links apilados en cada una de las ~20
          filas: mismo par de acciones repetido era puro ruido visual
          (UI/UX 2026-08-05, M5). */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="icon-mobile" variant="ghost" aria-label={`Acciones del folio ${folio}`}>
            <DotsThreeVertical size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setMode("action")}>Registrar gestión</DropdownMenuItem>
          {canConfirmPayments && (
            <DropdownMenuItem onSelect={openPayment}>Registrar pago</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

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
                <DatePicker name="actionDate" defaultValue={today} ariaLabel="Fecha de la gestión" />
              </Field>
              <Field label="Tipo" required>
                <OptionSelect
                  value={actionType}
                  onValueChange={setActionType}
                  options={ACTION_TYPE_OPTIONS}
                  aria-label="Tipo de gestión"
                />
              </Field>
              <Field label="Canal">
                <OptionSelect
                  name="channel"
                  emptyLabel="Sin especificar"
                  options={CHANNEL_OPTIONS}
                  aria-label="Canal"
                />
              </Field>
              <Field label="Resultado" required>
                <OptionSelect
                  name="outcome"
                  defaultValue="contacted"
                  options={OUTCOME_OPTIONS}
                  aria-label="Resultado"
                />
              </Field>
              <Field label="Contacto">
                <Input name="contactName" maxLength={160} />
              </Field>
              <Field label="Responsable">
                <OptionSelect
                  name="assigneeUserId"
                  emptyLabel="Yo"
                  options={users.map((user) => ({ value: user.id, label: user.name }))}
                  aria-label="Responsable"
                />
              </Field>
              <Field
                label="Fecha comprometida"
                hint={actionType === "commitment" ? "Obligatoria para un compromiso de pago." : undefined}
              >
                <DatePicker name="commitmentDate" ariaLabel="Fecha comprometida" />
              </Field>
              <Field label="Monto comprometido">
                <Input name="commitmentAmount" type="number" min={0} step="0.01" />
              </Field>
            </div>

            <Field label="Notas">
              <Textarea name="notes" rows={2} maxLength={2000} className="min-h-0" />
            </Field>
            <Field label="Próxima gestión">
              <DatePicker name="nextActionDate" ariaLabel="Próxima gestión" />
            </Field>

            <button type="submit" disabled={isPending} className={cn(buttonVariants(), "w-full")}>
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
                  clientRequestId: paymentRequestId,
                  // El reconocimiento vale para ESTE envío: sólo va marcado
                  // cuando el operador ya vio la advertencia y volvió a
                  // confirmar.
                  acknowledgeDuplicate: duplicateWarning !== null,
                })
                if (result.ok) {
                  toast.success(result.message)
                  close()
                  router.refresh()
                } else if (result.needsDuplicateAck) {
                  setDuplicateWarning(result.message)
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
                <DatePicker name="paymentDate" defaultValue={today} ariaLabel="Fecha del pago" />
              </Field>
              <Field label={`Monto (${currency})`} required>
                <Input
                  name="amount"
                  type="number"
                  step="0.01"
                  required
                  defaultValue={outstandingAmount}
                />
              </Field>
            </div>

            <Field label="Medio de pago">
              <Input name="method" maxLength={60} placeholder="Transferencia, cheque, factoring…" />
            </Field>
            <Field label="Notas">
              <Textarea name="notes" rows={2} maxLength={1000} className="min-h-0" />
            </Field>

            {duplicateWarning ? (
              <p
                role="alert"
                className="rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[var(--color-warning-soft,var(--color-surface-2))] px-3 py-2 text-xs text-[var(--color-text)]"
              >
                {duplicateWarning}
              </p>
            ) : null}

            <button type="submit" disabled={isPending} className={cn(buttonVariants(), "w-full")}>
              {isPending ? "Guardando…" : duplicateWarning ? "Sí, son dos pagos distintos: registrar" : "Confirmar pago"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

const ACTION_TYPE_OPTIONS = [
  { value: "call",       label: "Llamada" },
  { value: "email",      label: "Correo" },
  { value: "meeting",    label: "Reunión" },
  { value: "note",       label: "Observación" },
  { value: "claim",      label: "Reclamo formal" },
  { value: "commitment", label: "Compromiso de pago" },
  { value: "dispute",    label: "Disputa" },
]

const CHANNEL_OPTIONS = [
  { value: "phone",     label: "Teléfono" },
  { value: "email",     label: "Correo" },
  { value: "in_person", label: "Presencial" },
  { value: "portal",    label: "Portal del cliente" },
  { value: "letter",    label: "Carta" },
  { value: "other",     label: "Otro" },
]

const OUTCOME_OPTIONS = [
  { value: "contacted",        label: "Contactado" },
  { value: "no_answer",        label: "Sin respuesta" },
  { value: "promised_payment", label: "Prometió pago" },
  { value: "disputed",         label: "Objetó el cobro" },
  { value: "escalated",        label: "Escalado" },
  { value: "resolved",         label: "Resuelto" },
  { value: "other",            label: "Otro" },
]


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
