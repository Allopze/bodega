"use client"

import { useState, useTransition } from "react"
import { DatePicker } from "@/components/ui/date-picker"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import { formatPeriodOption, recentPeriods } from "@/components/ui/period-picker"
import {
  confirmInvoiceLinkAction,
  linkInvoiceAction,
  rejectInvoiceLinkAction,
  updateInvoiceInternalDataAction,
} from "../../actions"

interface Option { id: string; name: string }
interface ContractOption extends Option { clientId: string; code: string }

/**
 * Panel de datos internos de la factura: lo único editable de esta pantalla.
 *
 * Separado del resto a propósito — todo lo que se puede tocar acá es una
 * decisión de Chome (a quién se le cobra, cuándo vence según el contrato, quién
 * responde por la cobranza). Los datos tributarios quedan fuera del formulario.
 */
export function InvoiceInternalPanel({
  invoiceId,
  dueDate,
  dueDateSource,
  ownerUserId,
  collectionStatus,
  notes,
  clients,
  contracts,
  worksites,
  users,
  links,
}: {
  invoiceId: string
  dueDate: string | null
  dueDateSource: string | null
  ownerUserId: string | null
  collectionStatus: string
  notes: string | null
  clients: { id: string; name: string; rut: string }[]
  contracts: ContractOption[]
  worksites: Option[]
  users: Option[]
  links: { id: string; status: string; label: string }[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [clientId, setClientId] = useState("")

  // Solo se ofrecen contratos del cliente elegido: un contrato de otro cliente
  // sería un vínculo inconsistente, y el backend lo rechaza igual.
  const availableContracts = clientId
    ? contracts.filter((contract) => contract.clientId === clientId)
    : contracts

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Datos internos</h2>
        <p className="text-xs text-[var(--color-text-muted)]">
          Lo que administra Chome. No modifica el documento tributario.
        </p>
      </header>

      {/* ── Vínculo con la operación ─────────────────────────────────────── */}
      {/* El estado actual va ANTES del formulario: con los selects "Sin
          cliente…" arriba, la factura parecía no tener vínculo aunque hubiera
          uno confirmado (UI/UX 2026-08-05, M6). */}
      <p className="text-xs font-medium text-[var(--color-text-muted)]">Vínculo con la operación</p>
      {links.length > 0 ? (
        <ul className="space-y-1.5 py-2 text-xs">
          {links.map((link) => (
            <li key={link.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[var(--color-text)]">{link.label}</span>
              <span className="flex shrink-0 gap-1.5">
                {link.status === "suggested" && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => run(() => confirmInvoiceLinkAction(link.id))}
                    className="font-medium text-[var(--color-primary-ink)] hover:underline"
                  >
                    Confirmar
                  </button>
                )}
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    if (!confirm("¿Descartar este vínculo? Queda registrado en el historial.")) return
                    run(() => rejectInvoiceLinkAction(link.id))
                  }}
                  className="text-[var(--color-text-muted)] hover:underline"
                >
                  Descartar
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-2 text-xs text-[var(--color-text-subtle)]">Sin vínculo todavía.</p>
      )}

      <details open={links.length === 0} className="border-b border-[var(--color-border)] pb-3">
        <summary className="cursor-pointer text-xs font-medium text-[var(--color-primary-ink)] hover:underline">
          Agregar vínculo
        </summary>
      <form
        className="mt-2 space-y-2"
        action={(formData) => {
          const worksiteId = String(formData.get("worksiteId") ?? "")
          const contractId = String(formData.get("contractId") ?? "")
          const servicePeriod = String(formData.get("servicePeriod") ?? "")
          const clientPoNumber = String(formData.get("clientPoNumber") ?? "")
          run(() => linkInvoiceAction({
            invoiceId,
            clientId: clientId || null,
            contractId: contractId || null,
            worksiteId: worksiteId || null,
            servicePeriod: servicePeriod || null,
            clientPoNumber: clientPoNumber || null,
          }))
        }}
      >
        <Field label="Cliente">
          <select name="clientId" value={clientId} onChange={(event) => setClientId(event.target.value)} className={inputClass}>
            <option value="">Sin cliente</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Contrato">
          <select name="contractId" className={inputClass}>
            <option value="">Sin contrato</option>
            {availableContracts.map((contract) => (
              <option key={contract.id} value={contract.id}>{contract.code} — {contract.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Faena">
          <select name="worksiteId" className={inputClass}>
            <option value="">Sin faena</option>
            {worksites.map((worksite) => (
              <option key={worksite.id} value={worksite.id}>{worksite.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Período de servicio">
          {/* Select propio: el <input type="month"> nativo depende del locale
              del navegador (UI/UX 2026-08-05, M8). */}
          <select name="servicePeriod" defaultValue="" className={inputClass}>
            <option value="">Sin período</option>
            {recentPeriods(24).map((value) => (
              <option key={value} value={value}>{formatPeriodOption(value)}</option>
            ))}
          </select>
        </Field>

        <Field label="OC del cliente">
          <input type="text" name="clientPoNumber" maxLength={120} placeholder="Número entregado por el cliente" className={inputClass} />
        </Field>

        <button type="submit" disabled={isPending} className={cn(buttonVariants(), "w-full")}>
          Agregar vínculo
        </button>
      </form>
      </details>

      {/* ── Vencimiento, responsable y estado de cobranza ────────────────── */}
      <form
        className="space-y-2 pt-3"
        action={(formData) => {
          const newDueDate = String(formData.get("dueDate") ?? "")
          run(() => updateInvoiceInternalDataAction({
            invoiceId,
            dueDate: newDueDate || null,
            ownerUserId: String(formData.get("ownerUserId") ?? "") || null,
            collectionStatus: String(formData.get("collectionStatus") ?? "none"),
            notes: String(formData.get("notes") ?? "") || null,
          }))
        }}
      >
        <Field label="Fecha de vencimiento">
          <DatePicker name="dueDate" defaultValue={dueDate ?? ""} ariaLabel="Fecha de vencimiento" />
        </Field>
        <p className="text-xs text-[var(--color-text-subtle)]">
          {dueDateSource === "manual"
            ? "Fijada a mano: ninguna sincronización la va a cambiar."
            : "Al guardarla a mano queda fija y la sincronización deja de moverla."}
        </p>

        <Field label="Responsable de cobranza">
          <select name="ownerUserId" defaultValue={ownerUserId ?? ""} className={inputClass}>
            <option value="">Sin asignar</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Estado de cobranza">
          <select name="collectionStatus" defaultValue={collectionStatus} className={inputClass}>
            <option value="none">Sin gestión</option>
            <option value="in_progress">En gestión</option>
            <option value="committed">Compromiso de pago</option>
            <option value="disputed">En disputa</option>
            <option value="closed">Gestión cerrada</option>
            <option value="written_off">Castigada</option>
          </select>
        </Field>

        <Field label="Notas internas">
          <textarea name="notes" defaultValue={notes ?? ""} rows={3} maxLength={2000} className={inputClass} />
        </Field>

        <button type="submit" disabled={isPending} className={cn(buttonVariants(), "w-full")}>
          Guardar datos internos
        </button>
      </form>
    </section>
  )
}

const inputClass =
  "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-text)]"


function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs font-medium text-[var(--color-text-muted)]">{label}</span>
      {children}
    </label>
  )
}
