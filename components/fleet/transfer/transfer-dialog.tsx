"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import { transferVehiclesAction } from "@/app/(app)/flota/traslados/actions"
import { transferDateError } from "@/lib/fleet/transfer-rules"
import { useOperation } from "@/lib/hooks/use-operation"
import { nameKey } from "@/lib/mantencion/normalize"
import type { TransferCandidate, TransferOutcome } from "@/lib/services/fleet-transfers"
import { toast } from "@/lib/toast"
import { TransferEquipmentList } from "./transfer-equipment-list"
import { transferSummaryText } from "./transfer-summary"

type Failure = Extract<TransferOutcome, { ok: false }>
type FieldErrors = NonNullable<Failure["fieldErrors"]>

/**
 * «Trasladar equipos» (modal). Un solo registro para 1 a N equipos: faena de destino, desde cuándo,
 * motivo y quién autoriza, y debajo los equipos agrupados por su faena actual. Los que ya están en el
 * destino no se listan. El buscador es propio del modal (la barra superior filtra la página, no el
 * contenido de un diálogo). El servidor valida todo de nuevo y es todo o nada: sus errores por campo
 * y por fila se muestran donde se corrigen.
 */
export function TransferDialog({ open, onOpenChange, candidates, worksites, window, initialVehicleId }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  candidates: TransferCandidate[]
  worksites: Array<{ id: string; name: string }>
  window: { min: string; max: string }
  initialVehicleId?: string
}) {
  const router = useRouter()
  const [toWorksiteId, setToWorksiteId] = React.useState("")
  const [effectiveDate, setEffectiveDate] = React.useState(window.max)
  const [reason, setReason] = React.useState("")
  const [authorizedBy, setAuthorizedBy] = React.useState("")
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(initialVehicleId ? [initialVehicleId] : []))
  const [query, setQuery] = React.useState("")
  const [typeName, setTypeName] = React.useState("")
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({})
  const [rowErrors, setRowErrors] = React.useState<Record<string, string>>({})
  const { pending, message, run } = useOperation()

  const destination = worksites.find((site) => site.id === toWorksiteId) ?? null
  // Lo que ya está en el destino no se traslada: ni se lista, ni se envía aunque se hubiera marcado antes.
  const selectable = React.useMemo(() => candidates.filter((item) => item.worksiteId !== toWorksiteId), [candidates, toWorksiteId])
  const types = React.useMemo(
    () => [...new Set(selectable.map((item) => item.typeName))].sort((a, b) => a.localeCompare(b, "es")).map((value) => ({ value, label: value })),
    [selectable],
  )
  const visible = React.useMemo(() => {
    const needle = nameKey(query)
    return selectable.filter((item) =>
      (!typeName || item.typeName === typeName)
      && (!needle || nameKey(`${item.code} ${item.plate} ${item.typeName} ${item.brand ?? ""}`).includes(needle)))
  }, [selectable, query, typeName])
  const chosen = React.useMemo(() => selectable.filter((item) => selected.has(item.vehicleId)).map((item) => item.vehicleId), [selectable, selected])

  // El motivo que el servidor daría para la fecha de cada equipo marcado («Llegó a su faena actual el …»),
  // calculado antes de enviar: quien traslada lo ve bajo la fila y el botón espera a que se corrija.
  const dateErrors = React.useMemo(() => {
    const errors: Record<string, string> = {}
    for (const item of selectable) {
      if (!selected.has(item.vehicleId)) continue
      const error = transferDateError(effectiveDate, window.max, item.stayStartedOn)
      if (error) errors[item.vehicleId] = error
    }
    return errors
  }, [selectable, selected, effectiveDate, window.max])
  const hasDateErrors = Object.keys(dateErrors).length > 0

  function setMany(ids: string[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      for (const id of ids) { if (on) next.add(id); else next.delete(id) }
      return next
    })
  }

  function submit() {
    setFieldErrors({})
    setRowErrors({})
    run(
      async () => {
        const outcome = await transferVehiclesAction({ toWorksiteId, effectiveDate, reason, authorizedBy, vehicleIds: chosen })
        if (!outcome.ok) {
          setFieldErrors(outcome.fieldErrors ?? {})
          setRowErrors(outcome.rowErrors ?? {})
          // Un equipo con error oculto por el buscador o el tipo no se vería: se muestran todos.
          if (outcome.rowErrors && Object.keys(outcome.rowErrors).length > 0) { setQuery(""); setTypeName("") }
          return { ok: false, message: outcome.message }
        }
        return { ok: true, message: outcome.message, data: { notice: outcome.data.manualImportNotice } }
      },
      (result) => {
        toast.success(result.message ?? "Traslado registrado.", {
          action: { label: "Ver traslados", onClick: () => router.push("/flota/traslados") },
        })
        const notice = result.data?.notice
        if (typeof notice === "string" && notice) toast(notice, { duration: 10_000 })
        onOpenChange(false)
        router.refresh()
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(90dvh,48rem)] max-w-2xl flex-col overflow-hidden p-0">
        <DialogHeader className="mb-0 px-6 pt-6">
          <DialogTitle>Trasladar equipos</DialogTitle>
          <DialogDescription>
            Elige a qué faena pasan, desde qué día cuentan allí y marca los equipos. Queda registrado quién lo autorizó.
          </DialogDescription>
        </DialogHeader>
        <div className="grid shrink-0 gap-3 px-6 pt-3 sm:grid-cols-2">
          <Field label="A la faena" htmlFor="trf-to-worksite" required error={fieldErrors.toWorksiteId}>
            <OptionSelect
              options={worksites.map((site) => ({ value: site.id, label: site.name }))}
              id="trf-to-worksite" placeholder="Elige la faena" value={toWorksiteId} onValueChange={setToWorksiteId}
              error={Boolean(fieldErrors.toWorksiteId)}
            />
          </Field>
          <Field label="Desde el" required helper="El día del traslado ya cuenta en la faena nueva." error={fieldErrors.effectiveDate}>
            <DatePicker value={effectiveDate} onChange={setEffectiveDate} min={window.min} max={window.max} error={Boolean(fieldErrors.effectiveDate)} />
          </Field>
          <Field label="Motivo" required error={fieldErrors.reason}>
            <Textarea
              rows={2} className="min-h-0" value={reason} maxLength={2000} placeholder="Por qué se trasladan"
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <Field label="Autorizado por" required error={fieldErrors.authorizedBy}>
            <Input value={authorizedBy} maxLength={200} placeholder="Nombre de quien autoriza" onChange={(event) => setAuthorizedBy(event.target.value)} />
          </Field>
        </div>
        <div className="flex shrink-0 flex-wrap items-end gap-2 px-6 pt-4">
          <Input
            type="search" aria-label="Buscar por código, patente o marca" placeholder="Código, patente o marca" value={query}
            className="h-11 w-full text-xs sm:h-8 sm:w-52" onChange={(event) => setQuery(event.target.value)}
          />
          <OptionSelect aria-label="Filtrar por tipo de equipo" className="h-11 w-full text-xs sm:h-8 sm:w-44" emptyLabel="Todos los tipos" options={types} value={typeName} onValueChange={setTypeName} />
        </div>
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto border-y border-[var(--color-border)] px-6 py-2">
          <TransferEquipmentList
            candidates={visible} selected={selected} toWorksiteName={destination?.name ?? ""} effectiveDate={effectiveDate}
            rowErrors={rowErrors} dateErrors={dateErrors} initialVehicleId={initialVehicleId} onToggle={setMany}
          />
        </div>
        {(fieldErrors.vehicleIds || message) && (
          <p role="alert" className="px-6 pt-2 text-sm text-[var(--color-danger-ink)]">
            {[fieldErrors.vehicleIds, message].filter(Boolean).join(" ")}
          </p>
        )}
        <DialogFooter className="mt-0 items-center gap-3 px-6 py-4">
          <p className="mr-auto text-sm text-[var(--color-text)]" aria-live="polite">
            {transferSummaryText(chosen.length, destination?.name ?? null, effectiveDate)}
          </p>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
          <Button onClick={submit} loading={pending} disabled={chosen.length === 0 || hasDateErrors}>Trasladar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
