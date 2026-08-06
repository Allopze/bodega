"use client"

import { useState, useTransition } from "react"
import { DatePicker } from "@/components/ui/date-picker"
import { buttonVariants } from "@/components/ui/button"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { saveClientAction, saveContractAction } from "../actions"

interface Option { id: string; name: string; code?: string }

/**
 * Alta de clientes y contratos.
 *
 * Ambos formularios validan en el servidor (Zod + RUT con dígito verificador +
 * unicidad); acá solo se recogen los datos. El botón deshabilitado no es la
 * protección: la acción rechaza igual sin `billing:manage_clients`.
 */
export function ClientContractManager({
  clients,
  worksites,
  costCenters,
  users,
}: {
  clients: Option[]
  worksites: Option[]
  costCenters: Option[]
  users: Option[]
}) {
  return (
    <div className="flex gap-2">
      <ClientDialog users={users} />
      <ContractDialog clients={clients} worksites={worksites} costCenters={costCenters} users={users} />
    </div>
  )
}

function ClientDialog({ users }: { users: Option[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className={secondaryButtonClass}>Nuevo cliente</button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo cliente</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          action={(formData) => {
            startTransition(async () => {
              const terms = String(formData.get("paymentTermsDays") ?? "")
              const result = await saveClientAction({
                rut: String(formData.get("rut") ?? ""),
                name: String(formData.get("name") ?? ""),
                tradeName: String(formData.get("tradeName") ?? "") || null,
                email: String(formData.get("email") ?? "") || null,
                phone: String(formData.get("phone") ?? "") || null,
                address: String(formData.get("address") ?? "") || null,
                paymentTermsDays: terms === "" ? null : Number(terms),
                defaultCurrency: String(formData.get("defaultCurrency") ?? "CLP"),
                ownerUserId: String(formData.get("ownerUserId") ?? "") || null,
                isActive: true,
                notes: String(formData.get("notes") ?? "") || null,
              })
              if (result.ok) {
                toast.success(result.message)
                setOpen(false)
                router.refresh()
              } else {
                toast.error(result.message)
              }
            })
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="RUT" required>
              <input name="rut" required placeholder="76.543.210-K" className={inputClass} />
            </Field>
            <Field label="Razón social" required>
              <input name="name" required className={inputClass} />
            </Field>
            <Field label="Nombre de fantasía">
              <input name="tradeName" className={inputClass} />
            </Field>
            <Field label="Correo">
              <input name="email" type="email" className={inputClass} />
            </Field>
            <Field label="Teléfono">
              <input name="phone" className={inputClass} />
            </Field>
            <Field label="Dirección">
              <input name="address" className={inputClass} />
            </Field>
            <Field label="Plazo de pago (días)" hint="Se usa para calcular el vencimiento cuando el documento no lo declara.">
              <input name="paymentTermsDays" type="number" min={0} max={365} className={inputClass} />
            </Field>
            <Field label="Moneda habitual">
              <select name="defaultCurrency" defaultValue="CLP" className={inputClass}>
                <option value="CLP">CLP</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </Field>
            <Field label="Responsable comercial">
              <select name="ownerUserId" className={inputClass}>
                <option value="">Sin asignar</option>
                {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Notas">
            <textarea name="notes" rows={2} className={inputClass} />
          </Field>
          <button type="submit" disabled={isPending} className={buttonVariants()}>
            {isPending ? "Guardando…" : "Crear cliente"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ContractDialog({
  clients,
  worksites,
  costCenters,
  users,
}: {
  clients: Option[]
  worksites: Option[]
  costCenters: Option[]
  users: Option[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className={buttonVariants()} disabled={clients.length === 0}>
          Nuevo contrato
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo contrato</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          action={(formData) => {
            startTransition(async () => {
              const terms = String(formData.get("paymentTermsDays") ?? "")
              const amount = String(formData.get("periodAmount") ?? "")
              const result = await saveContractAction({
                code: String(formData.get("code") ?? ""),
                clientId: String(formData.get("clientId") ?? ""),
                name: String(formData.get("name") ?? ""),
                worksiteId: String(formData.get("worksiteId") ?? "") || null,
                costCenterId: String(formData.get("costCenterId") ?? "") || null,
                clientPoNumber: String(formData.get("clientPoNumber") ?? "") || null,
                startDate: String(formData.get("startDate") ?? "") || null,
                endDate: String(formData.get("endDate") ?? "") || null,
                currency: String(formData.get("currency") ?? "CLP"),
                paymentTermsDays: terms === "" ? null : Number(terms),
                billingCycle: String(formData.get("billingCycle") ?? "monthly"),
                periodAmount: amount === "" ? null : Number(amount),
                ownerUserId: String(formData.get("ownerUserId") ?? "") || null,
                status: "active",
                notes: String(formData.get("notes") ?? "") || null,
              })
              if (result.ok) {
                toast.success(result.message)
                setOpen(false)
                router.refresh()
              } else {
                toast.error(result.message)
              }
            })
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Código" required>
              <input name="code" required placeholder="CTR-2026-0001" className={inputClass} />
            </Field>
            <Field label="Cliente" required>
              <select name="clientId" required className={inputClass}>
                <option value="">Selecciona…</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </Field>
            <Field label="Nombre del contrato" required>
              <input name="name" required className={inputClass} />
            </Field>
            <Field label="Faena" hint="Déjalo vacío si el contrato cubre varias faenas.">
              <select name="worksiteId" className={inputClass}>
                <option value="">Transversal</option>
                {worksites.map((worksite) => <option key={worksite.id} value={worksite.id}>{worksite.name}</option>)}
              </select>
            </Field>
            <Field label="Centro de costo">
              <select name="costCenterId" className={inputClass}>
                <option value="">Sin asignar</option>
                {costCenters.map((center) => (
                  <option key={center.id} value={center.id}>{center.code} — {center.name}</option>
                ))}
              </select>
            </Field>
            <Field label="OC marco del cliente">
              <input name="clientPoNumber" className={inputClass} />
            </Field>
            <Field label="Inicio">
              <DatePicker name="startDate" ariaLabel="Inicio del contrato" />
            </Field>
            <Field label="Término">
              <DatePicker name="endDate" ariaLabel="Término del contrato" />
            </Field>
            <Field label="Ciclo de facturación">
              <select name="billingCycle" defaultValue="monthly" className={inputClass}>
                <option value="monthly">Mensual</option>
                <option value="milestone">Por hito</option>
                <option value="none">Sin calendario</option>
              </select>
            </Field>
            <Field label="Moneda">
              <select name="currency" defaultValue="CLP" className={inputClass}>
                <option value="CLP">CLP</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </Field>
            <Field label="Monto del período" hint="Déjalo vacío si el cobro es variable.">
              <input name="periodAmount" type="number" min={0} step="0.01" className={inputClass} />
            </Field>
            <Field label="Plazo de pago (días)">
              <input name="paymentTermsDays" type="number" min={0} max={365} className={inputClass} />
            </Field>
            <Field label="Administrador del contrato">
              <select name="ownerUserId" className={inputClass}>
                <option value="">Sin asignar</option>
                {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Notas">
            <textarea name="notes" rows={2} className={inputClass} />
          </Field>
          <button type="submit" disabled={isPending} className={buttonVariants()}>
            {isPending ? "Guardando…" : "Crear contrato"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const inputClass =
  "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-text)]"


const secondaryButtonClass =
  "rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"

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
