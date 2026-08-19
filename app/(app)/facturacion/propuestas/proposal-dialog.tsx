"use client"

import { useMemo, useState, useTransition } from "react"
import { DatePicker } from "@/components/ui/date-picker"
import { OptionSelect } from "@/components/ui/option-select"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { Plus, Trash } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { formatMoney } from "@/lib/services/billing/money"
import { formatPeriodOption, recentPeriods } from "@/components/ui/period-picker"
import { computeProposalTotals } from "@/lib/services/billing/proposal-rules"
import { saveProposalAction } from "./actions"
import { nanoid } from "@/lib/id"

interface Option { id: string; name: string; code?: string }
interface ContractOption { id: string; clientId: string; code: string; name: string; worksiteId: string | null; costCenterId: string | null; currency: string; periodAmount: number | null; clientPoNumber: string | null }

interface ItemDraft {
  key: string
  description: string
  quantity: string
  unit: string
  unitPrice: string
  isExempt: boolean
}

/**
 * Alta de una propuesta de facturación.
 *
 * El total se calcula en vivo con la MISMA función que usa el servidor
 * (`computeProposalTotals`), así que lo que la persona ve antes de guardar es
 * exactamente lo que se va a guardar. Duplicar esa fórmula en el cliente sería
 * la forma más fácil de que ambas cifras se separen con el tiempo.
 */
export function ProposalDialog({
  clients,
  contracts,
  worksites,
  costCenters,
  defaultPeriod,
}: {
  clients: { id: string; name: string; rut: string }[]
  contracts: ContractOption[]
  worksites: Option[]
  costCenters: Option[]
  defaultPeriod?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const [clientId, setClientId] = useState("")
  const [contractId, setContractId] = useState("")
  const [currency, setCurrency] = useState("CLP")
  // Controlados: como no controlados, su `defaultValue` se congela en el primer
  // render (cuando todavía no hay contrato elegido) y la faena y el centro de
  // costo del contrato nunca se precargaban — se guardaban en null.
  const [worksiteId, setWorksiteId] = useState("")
  const [costCenterId, setCostCenterId] = useState("")
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()])

  const availableContracts = clientId
    ? contracts.filter((contract) => contract.clientId === clientId)
    : contracts
  const selectedContract = contracts.find((contract) => contract.id === contractId)

  const parsedItems = useMemo(
    () => items
      .filter((item) => item.description.trim() !== "")
      .map((item) => ({
        description: item.description.trim(),
        quantity: Number(item.quantity) || 0,
        unit: item.unit || null,
        unitPrice: Number(item.unitPrice) || 0,
        isExempt: item.isExempt,
      })),
    [items],
  )
  const totals = useMemo(() => computeProposalTotals(parsedItems), [parsedItems])

  function reset() {
    setClientId("")
    setContractId("")
    setCurrency("CLP")
    setWorksiteId("")
    setCostCenterId("")
    setItems([emptyItem()])
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <button type="button" className={buttonVariants()} disabled={clients.length === 0}>
          Nueva propuesta
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva propuesta de facturación</DialogTitle>
        </DialogHeader>

        <form
          className="space-y-4"
          action={(formData) => {
            // El select ya no es nativo: `required` del navegador no bloquea el
            // envío, así que el cliente se valida acá (y en el servidor).
            if (!clientId) {
              toast.error("Selecciona un cliente")
              return
            }
            if (!String(formData.get("servicePeriod") ?? "")) {
              toast.error("Selecciona el período de servicio")
              return
            }
            if (parsedItems.length === 0) {
              toast.error("Agrega al menos un ítem con descripción")
              return
            }
            startTransition(async () => {
              const result = await saveProposalAction({
                clientId,
                contractId: contractId || null,
                worksiteId: String(formData.get("worksiteId") ?? "") || null,
                costCenterId: String(formData.get("costCenterId") ?? "") || null,
                servicePeriod: String(formData.get("servicePeriod") ?? ""),
                serviceFrom: String(formData.get("serviceFrom") ?? "") || null,
                serviceTo: String(formData.get("serviceTo") ?? "") || null,
                currency,
                clientPoNumber: String(formData.get("clientPoNumber") ?? "") || null,
                missingDocuments: String(formData.get("missingDocuments") ?? "") || null,
                observations: String(formData.get("observations") ?? "") || null,
                items: parsedItems,
              })
              if (result.ok) {
                toast.success(result.message)
                setOpen(false)
                reset()
                router.refresh()
              } else {
                toast.error(result.message)
              }
            })
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cliente" required>
              <OptionSelect
                value={clientId}
                onValueChange={(value) => { setClientId(value); setContractId(""); setWorksiteId(""); setCostCenterId("") }}
                options={clients.map((client) => ({ value: client.id, label: client.name }))}
                aria-label="Cliente"
              />
            </Field>

            <Field label="Contrato">
              <OptionSelect
                value={contractId}
                onValueChange={(value) => {
                  setContractId(value)
                  const contract = contracts.find((entry) => entry.id === value)
                  if (contract) {
                    setCurrency(contract.currency)
                    // Sólo se siembra lo que la persona puede ver: `worksites` llega
                    // recortado por alcance y `listActiveContracts` no filtra por
                    // alcance, así que un contrato puede apuntar a una faena ajena.
                    // Sembrarla sería un id invisible que el servidor rechaza.
                    setWorksiteId(worksites.some((entry) => entry.id === contract.worksiteId) ? contract.worksiteId! : "")
                    setCostCenterId(costCenters.some((entry) => entry.id === contract.costCenterId) ? contract.costCenterId! : "")
                  }
                }}
                emptyLabel="Sin contrato"
                options={availableContracts.map((contract) => ({
                  value: contract.id,
                  label: `${contract.code} · ${contract.name}`,
                }))}
                aria-label="Contrato"
              />
            </Field>

            <Field label="Período de servicio" required>
              {/* Select propio en vez de <input type="month">: el nativo se
                  rinde según el locale del navegador (UI/UX 2026-08-05, M8),
                  como ya se resolvió en filtros y datos internos. */}
              <OptionSelect
                name="servicePeriod"
                defaultValue={defaultPeriod ?? ""}
                options={recentPeriods(24).map((value) => ({ value, label: formatPeriodOption(value) }))}
                aria-label="Período de servicio"
              />
            </Field>

            <Field label="Faena">
              <OptionSelect
                name="worksiteId"
                value={worksiteId}
                onValueChange={setWorksiteId}
                emptyLabel="Sin faena"
                options={worksites.map((worksite) => ({ value: worksite.id, label: worksite.name }))}
                aria-label="Faena"
              />
            </Field>

            <Field label="Desde">
              <DatePicker name="serviceFrom" ariaLabel="Servicio desde" />
            </Field>
            <Field label="Hasta">
              <DatePicker name="serviceTo" ariaLabel="Servicio hasta" />
            </Field>

            <Field label="Centro de costo">
              <OptionSelect
                name="costCenterId"
                value={costCenterId}
                onValueChange={setCostCenterId}
                emptyLabel="Sin asignar"
                options={costCenters.map((center) => ({
                  value: center.id,
                  label: `${center.code} · ${center.name}`,
                }))}
                aria-label="Centro de costo"
              />
            </Field>

            <Field label="Moneda">
              <OptionSelect
                value={currency}
                onValueChange={setCurrency}
                options={[
                  { value: "CLP", label: "CLP" },
                  { value: "USD", label: "USD" },
                  { value: "EUR", label: "EUR" },
                ]}
                aria-label="Moneda"
              />
            </Field>

            <Field label="OC del cliente">
              <Input name="clientPoNumber" defaultValue={selectedContract?.clientPoNumber ?? ""} />
            </Field>
          </div>

          {/* ── Ítems ─────────────────────────────────────────────────────── */}
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-[var(--color-text-muted)]">Ítems a cobrar</legend>
            {items.map((item, index) => (
              <div key={item.key} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-end gap-2">
                <label className="block">
                  <span className="sr-only">Descripción del ítem {index + 1}</span>
                  <Input
                    value={item.description}
                    onChange={(event) => updateItem(setItems, item.key, { description: event.target.value })}
                    placeholder="Descripción del servicio"
                  />
                </label>
                <label className="block w-20">
                  <span className="mb-0.5 block text-[10px] text-[var(--color-text-muted)]">Cant.</span>
                  <Input
                    type="number" min="0" step="0.0001" value={item.quantity}
                    onChange={(event) => updateItem(setItems, item.key, { quantity: event.target.value })}
                  />
                </label>
                <label className="block w-32">
                  <span className="mb-0.5 block text-[10px] text-[var(--color-text-muted)]">Precio unit.</span>
                  <Input
                    type="number" min="0" step="0.01" value={item.unitPrice}
                    onChange={(event) => updateItem(setItems, item.key, { unitPrice: event.target.value })}
                  />
                </label>
                <div className="pb-2">
                  <Checkbox
                    label="Exento"
                    checked={item.isExempt}
                    onChange={(event) => updateItem(setItems, item.key, { isExempt: event.target.checked })}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setItems((current) => current.length === 1 ? current : current.filter((entry) => entry.key !== item.key))}
                  disabled={items.length === 1}
                  aria-label={`Quitar ítem ${index + 1}`}
                  className="pb-2 text-[var(--color-text-muted)] disabled:opacity-40"
                >
                  <Trash size={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setItems((current) => [...current, emptyItem()])}
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary-ink)]"
            >
              <Plus size={12} /> Agregar ítem
            </button>
          </fieldset>

          {/* ── Totales calculados ────────────────────────────────────────── */}
          <dl className="grid grid-cols-3 gap-3 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] px-3 py-2 text-sm">
            <div>
              <dt className="text-xs text-[var(--color-text-muted)]">Neto estimado</dt>
              <dd className="tabular-nums text-[var(--color-text)]">{formatMoney(totals.net, currency)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-text-muted)]">IVA estimado</dt>
              <dd className="tabular-nums text-[var(--color-text)]">{formatMoney(totals.tax, currency)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-text-muted)]">Total estimado</dt>
              <dd className="font-semibold tabular-nums text-[var(--color-text)]">{formatMoney(totals.total, currency)}</dd>
            </div>
          </dl>
          {totals.exempt > 0 && (
            <p className="text-xs text-[var(--color-text-subtle)]">
              Incluye {formatMoney(totals.exempt, currency)} exentos de IVA.
            </p>
          )}

          <Field label="Documentos faltantes" hint="Si hay algo pendiente, la propuesta no se podrá marcar lista para facturar.">
            <Input name="missingDocuments" maxLength={1000} />
          </Field>

          <Field label="Observaciones">
            <Textarea name="observations" rows={2} maxLength={2000} className="min-h-0" />
          </Field>

          <p className="text-xs text-[var(--color-text-subtle)]">
            Aprobar una propuesta no emite ningún documento tributario: la emisión sigue siendo manual en el portal.
          </p>

          <button type="submit" disabled={isPending} className={cn(buttonVariants(), "w-full")}>
            {isPending ? "Guardando…" : "Crear propuesta"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function emptyItem(): ItemDraft {
  return {
    // Sólo es key de React, nunca se persiste. `nanoid` y no `crypto.randomUUID`
    // porque este último no existe fuera de un contexto seguro (http:// por IP).
    key: nanoid(),
    description: "",
    quantity: "1",
    unit: "",
    unitPrice: "",
    isExempt: false,
  }
}

function updateItem(
  setItems: React.Dispatch<React.SetStateAction<ItemDraft[]>>,
  key: string,
  patch: Partial<ItemDraft>,
) {
  setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)))
}

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
