"use client"

import { useState, useTransition } from "react"
import { DatePicker } from "@/components/ui/date-picker"
import { OptionSelect } from "@/components/ui/option-select"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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
              <Input name="rut" required placeholder="76.543.210-K" />
            </Field>
            <Field label="Razón social" required>
              <Input name="name" required />
            </Field>
            <Field label="Nombre de fantasía">
              <Input name="tradeName" />
            </Field>
            <Field label="Correo">
              <Input name="email" type="email" />
            </Field>
            <Field label="Teléfono">
              <Input name="phone" />
            </Field>
            <Field label="Dirección">
              <Input name="address" />
            </Field>
            <Field label="Plazo de pago (días)" hint="Se usa para calcular el vencimiento cuando el documento no lo declara.">
              <Input name="paymentTermsDays" type="number" min={0} max={365} />
            </Field>
            <Field label="Moneda habitual">
              <OptionSelect
                name="defaultCurrency"
                defaultValue="CLP"
                options={CURRENCY_OPTIONS}
                aria-label="Moneda habitual"
              />
            </Field>
            <Field label="Responsable comercial">
              <OptionSelect
                name="ownerUserId"
                emptyLabel="Sin asignar"
                options={userOptions(users)}
                aria-label="Responsable comercial"
              />
            </Field>
          </div>
          <Field label="Notas">
            <Textarea name="notes" rows={2} className="min-h-0" />
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
            // El select ya no es nativo, así que `required` del navegador no
            // bloquea el envío: el cliente se valida acá (y en el servidor).
            const clientId = String(formData.get("clientId") ?? "")
            if (!clientId) {
              toast.error("Selecciona un cliente")
              return
            }
            startTransition(async () => {
              const terms = String(formData.get("paymentTermsDays") ?? "")
              const amount = String(formData.get("periodAmount") ?? "")
              const result = await saveContractAction({
                code: String(formData.get("code") ?? ""),
                clientId,
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
              <Input name="code" required placeholder="CTR-2026-0001" />
            </Field>
            <Field label="Cliente" required>
              <OptionSelect
                name="clientId"
                options={clients.map((client) => ({ value: client.id, label: client.name }))}
                aria-label="Cliente"
              />
            </Field>
            <Field label="Nombre del contrato" required>
              <Input name="name" required />
            </Field>
            <Field label="Faena" hint="Déjalo vacío si el contrato cubre varias faenas.">
              <OptionSelect
                name="worksiteId"
                emptyLabel="Transversal"
                options={worksites.map((worksite) => ({ value: worksite.id, label: worksite.name }))}
                aria-label="Faena"
              />
            </Field>
            <Field label="Centro de costo">
              <OptionSelect
                name="costCenterId"
                emptyLabel="Sin asignar"
                options={costCenters.map((center) => ({
                  value: center.id,
                  label: `${center.code} · ${center.name}`,
                }))}
                aria-label="Centro de costo"
              />
            </Field>
            <Field label="OC marco del cliente">
              <Input name="clientPoNumber" />
            </Field>
            <Field label="Inicio">
              <DatePicker name="startDate" ariaLabel="Inicio del contrato" />
            </Field>
            <Field label="Término">
              <DatePicker name="endDate" ariaLabel="Término del contrato" />
            </Field>
            <Field label="Ciclo de facturación">
              <OptionSelect
                name="billingCycle"
                defaultValue="monthly"
                options={[
                  { value: "monthly",   label: "Mensual" },
                  { value: "milestone", label: "Por hito" },
                  { value: "none",      label: "Sin calendario" },
                ]}
                aria-label="Ciclo de facturación"
              />
            </Field>
            <Field label="Moneda">
              <OptionSelect
                name="currency"
                defaultValue="CLP"
                options={CURRENCY_OPTIONS}
                aria-label="Moneda"
              />
            </Field>
            <Field label="Monto del período" hint="Déjalo vacío si el cobro es variable.">
              <Input name="periodAmount" type="number" min={0} step="0.01" />
            </Field>
            <Field label="Plazo de pago (días)">
              <Input name="paymentTermsDays" type="number" min={0} max={365} />
            </Field>
            <Field label="Administrador del contrato">
              <OptionSelect
                name="ownerUserId"
                emptyLabel="Sin asignar"
                options={userOptions(users)}
                aria-label="Administrador del contrato"
              />
            </Field>
          </div>
          <Field label="Notas">
            <Textarea name="notes" rows={2} className="min-h-0" />
          </Field>
          <button type="submit" disabled={isPending} className={buttonVariants()}>
            {isPending ? "Guardando…" : "Crear contrato"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const CURRENCY_OPTIONS = [
  { value: "CLP", label: "CLP" },
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
]

function userOptions(users: Option[]) {
  return users.map((user) => ({ value: user.id, label: user.name }))
}

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
