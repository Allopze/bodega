"use client"

import * as React from "react"
import { ContractCoreFields } from "@/components/contracts/contract-core-fields"
import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import {
  Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import { useOperation } from "@/lib/hooks/use-operation"
import type { MandanteOptions } from "@/lib/services/contracts/contracts"
import type { WorksiteContractView } from "@/lib/services/contracts/worksite-view"
import { toast } from "@/lib/toast"
import { createMandanteAction, saveOperationalContractAction } from "./contract-actions"

type ViewContract = WorksiteContractView["contracts"][number]

export interface ContractSheetProps {
  open: boolean
  onClose: () => void
  worksiteId: string
  /** Contrato que se edita; `null` = alta. */
  contract: ViewContract | null
  mandantes: MandanteOptions
}

const STATUS_OPTIONS = [
  { value: "active", label: "Vigente" },
  { value: "suspended", label: "Suspendido" },
  { value: "closed", label: "Cerrado" },
]

const SUGGESTION_PREFIX = "sugerido:"

/**
 * «Nuevo contrato» / «Editar»: nombre, mandante (elegir, tomar una sugerencia o
 * crearlo en línea), vigencia y, al editar, el estado. El código se genera solo y
 * los campos de cobro se editan sólo en Facturación. Una sola vista, sin
 * pestañas: no necesita `stableHeight`.
 */
export function ContractSheet({ open, onClose, ...form }: ContractSheetProps) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent>
        {/* El formulario vive dentro del contenido: al cerrar se desmonta y lo tecleado sin guardar no reaparece. */}
        <ContractForm onClose={onClose} {...form} />
      </SheetContent>
    </Sheet>
  )
}

function ContractForm({ onClose, worksiteId, contract, mandantes }: Omit<ContractSheetProps, "open">) {
  const [clientValue, setClientValue] = React.useState(contract?.clientId ?? "")
  const [extraClients, setExtraClients] = React.useState<{ id: string; rut: string; name: string }[]>([])
  const [status, setStatus] = React.useState<string>(contract?.status ?? "active")
  const { pending, message, fieldErrors, run } = useOperation()

  // Un RUT que ya era cliente vuelve con el mismo id: no se repite en la lista.
  const clients = [...mandantes.clients, ...extraClients.filter((extra) => !mandantes.clients.some((client) => client.id === extra.id))]

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const text = (key: string) => String(data.get(key) ?? "")
    const suggestion = clientValue.startsWith(SUGGESTION_PREFIX)
      ? mandantes.suggestions.find((candidate) => candidate.rut === clientValue.slice(SUGGESTION_PREFIX.length))
      : undefined

    run(async () => {
      // Una sugerencia todavía no es cliente: se crea antes de guardar el contrato que la usa.
      let clientId = clientValue
      if (suggestion) {
        const created = await createMandanteAction({ rut: suggestion.rut, name: suggestion.name })
        if (!created.ok) return created
        clientId = String(created.data?.id ?? "")
      }
      return saveOperationalContractAction({
        ...(contract ? { id: contract.id } : {}),
        worksiteId,
        clientId,
        name: text("name"),
        startDate: text("startDate"),
        endDate: text("endDate"),
        status: contract ? status : "active",
      })
    }, (result) => {
      toast.success(result.message ?? "Contrato guardado")
      onClose()
    })
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <SheetHeader>
        <div>
          <SheetTitle>{contract ? "Editar contrato" : "Nuevo contrato"}</SheetTitle>
          <SheetDescription>
            {contract ? contract.code : "El código se genera al guardar. Los datos de cobro se editan en Facturación."}
          </SheetDescription>
        </div>
        <SheetCloseButton />
      </SheetHeader>

      <SheetBody>
        {message && <p role="alert" className="mb-4 text-sm text-[var(--color-danger)]">{message}</p>}
        <div className="flex flex-col gap-5">
          <ContractCoreFields
            clients={clients}
            defaults={{ name: contract?.name, clientId: contract?.clientId, startDate: contract?.startDate, endDate: contract?.endDate }}
            errors={fieldErrors}
            clientSlot={
              <MandanteField
                clients={clients}
                suggestions={mandantes.suggestions}
                value={clientValue}
                onChange={setClientValue}
                onCreated={(client) => { setExtraClients((current) => [...current, client]); setClientValue(client.id) }}
              />
            }
          />
          {contract && (
            <Field label="Estado" error={fieldErrors.status?.[0]}>
              <OptionSelect value={status} onValueChange={setStatus} options={STATUS_OPTIONS} aria-label="Estado del contrato" />
            </Field>
          )}
        </div>
      </SheetBody>

      <SheetFooter>
        <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
        <SubmitButton label="Guardar" loadingLabel="Guardando..." pending={pending} />
      </SheetFooter>
    </form>
  )
}

interface MandanteFieldProps {
  clients: { id: string; rut: string; name: string }[]
  suggestions: { rut: string; name: string }[]
  value: string
  onChange: (value: string) => void
  onCreated: (client: { id: string; rut: string; name: string }) => void
  "aria-describedby"?: string
}

/**
 * Selector de mandante: los clientes existentes, las sugerencias tomadas de las
 * facturas de venta («aún no es cliente») y un alta en línea con RUT y razón
 * social. El alta se hace al pulsar «Guardar mandante», no al guardar el contrato.
 */
/** Enter en el alta del mandante no debe enviar el formulario del contrato que lo contiene. */
function keepEnterInside(event: React.KeyboardEvent<HTMLInputElement>): void {
  if (event.key === "Enter") event.preventDefault()
}

function MandanteField({ clients, suggestions, value, onChange, onCreated, "aria-describedby": describedBy }: MandanteFieldProps) {
  const [creating, setCreating] = React.useState(false)
  const [rut, setRut] = React.useState("")
  const [name, setName] = React.useState("")
  const mandante = useOperation()

  const options = [
    ...clients.map((client) => ({ value: client.id, label: client.name, hint: client.rut })),
    ...suggestions.map((suggestion) => ({
      value: `${SUGGESTION_PREFIX}${suggestion.rut}`,
      label: suggestion.name,
      hint: `${suggestion.rut} · sugerido por tus facturas de venta`,
    })),
  ]

  function create() {
    mandante.run(() => createMandanteAction({ rut, name }), (result) => {
      onCreated({ id: String(result.data?.id ?? ""), rut: rut.trim(), name: name.trim() })
      toast.success(result.message ?? "Mandante creado")
      setCreating(false)
      setRut("")
      setName("")
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <Combobox
        options={options}
        value={value}
        onChange={onChange}
        placeholder="Busca por nombre o RUT"
        aria-label="Mandante"
        aria-describedby={describedBy}
      />
      {!creating ? (
        <Button type="button" variant="link" size="sm" className="self-start" onClick={() => setCreating(true)}>
          Crear mandante
        </Button>
      ) : (
        <div className="flex flex-col gap-3 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
          {mandante.message && <p role="alert" className="text-sm text-[var(--color-danger)]">{mandante.message}</p>}
          <Field label="RUT del mandante" helper="Ej.: 76.543.210-K">
            <Input value={rut} onChange={(event) => setRut(event.target.value)} onKeyDown={keepEnterInside} autoComplete="off" />
          </Field>
          <Field label="Razón social">
            <Input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={keepEnterInside} autoComplete="off" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>Cancelar</Button>
            <Button type="button" size="sm" loading={mandante.pending} disabled={!rut.trim() || !name.trim()} onClick={create}>
              Guardar mandante
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
