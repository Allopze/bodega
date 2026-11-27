"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Plus } from "@phosphor-icons/react"
import { createPartsNoteAction } from "@/app/(app)/mantencion/notas-pedido/nueva/actions"
import { SectionCard } from "@/components/mantencion/jefatura/shared/section-card"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Checkbox } from "@/components/ui/checkbox"
import { Combobox } from "@/components/ui/combobox"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import type { NewNoteOptions } from "@/lib/services/mantencion/parts-notes/new-note-options"
import { toast } from "@/lib/toast"
import { formatDateTime } from "@/lib/utils"
import {
  buildNoteInput, changeWorkOrder, changeWorksite, defaultCharge, hasContent, newClientOpId, newDraft, newLine, pruneBlankLines,
  validateDraft, vehicleLabel, NEW_NOTE_MAX_LINES, NEW_NOTE_NOTES_MAX, type DraftLine, type NoteDraft,
} from "./new-note-draft"
import { NewNoteLineEditor } from "./new-note-line-editor"
import { clearDraft, readDraft, writeDraft } from "./new-note-storage"

/**
 * Enter dentro de un campo de texto envía el formulario por omisión: quien escribe «Filtro de aceite» y pulsa Enter para
 * seguir mandaría la nota entera con cantidad 1. Aquí sólo se envía con el botón. Enter en un botón, en la observación
 * (varias líneas) o para elegir una fila de un buscador (que ya lo atendió) no se toca.
 */
function blockEnterSubmit(event: React.KeyboardEvent<HTMLFormElement>) {
  if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault()
}

/**
 * «Nueva nota de pedido» desde el PC (R15): faena, OT opcional, urgencia, observación y las líneas del pedido. Pensada para
 * una conexión inestable y para el celular:
 *
 * - Lo escrito se guarda en el equipo en cada cambio (`new-note-storage.ts`) y se restaura al volver; se borra sólo al crearse
 *   la nota. Un envío que falla (rechazo del servidor o sin conexión) no toca nada: el error se muestra y se puede reintentar.
 * - La `clientOpId` nace con el borrador y viaja en cada reintento: si la primera vez la nota sí se creó pero la respuesta se
 *   perdió, el servidor devuelve la misma nota y no se duplica.
 *
 * Envía de forma imperativa (`useOperation`) y no con `<form action>`: el hook atrapa el fallo de red en vez de dejarlo subir
 * al error boundary (que descartaría la pantalla con todo lo escrito) y el formulario controlado no se vacía al terminar la acción.
 */
export function NewNoteForm({ userId, options, initial }: {
  userId: string
  options: NewNoteOptions
  /** Valores que trae el enlace (`?ot=`); un borrador guardado manda sobre ellos. */
  initial?: { worksiteId?: string; workOrderId?: string }
}) {
  const router = useRouter()
  const op = useOperation()
  const [draft, setDraft] = React.useState<NoteDraft>(() => newDraft(options, initial))
  const [ready, setReady] = React.useState(false)
  const [restoredAt, setRestoredAt] = React.useState<string | null>(null)
  const [attempted, setAttempted] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const [storageFailed, setStorageFailed] = React.useState(false)
  const lineCounter = React.useRef(1)
  const focusLine = React.useRef<string | null>(null)
  const restored = React.useRef(false)

  // El borrador se lee después de montar (no al renderizar): servidor y primer render del cliente tienen que coincidir.
  React.useEffect(() => {
    if (restored.current) return
    restored.current = true
    const stored = readDraft(userId, options)
    if (stored) {
      setDraft(stored.draft.clientOpId ? stored.draft : { ...stored.draft, clientOpId: newClientOpId() })
      lineCounter.current = stored.draft.lines.length
      setRestoredAt(stored.savedAt)
    } else {
      setDraft((current) => ({ ...current, clientOpId: newClientOpId() }))
    }
    setReady(true)
  }, [userId, options])

  React.useEffect(() => {
    if (!ready || done) return
    if (hasContent(draft)) setStorageFailed(!writeDraft(userId, draft))
    else clearDraft(userId)
  }, [draft, ready, done, userId])

  // Una línea recién agregada recibe el foco: con teclado o con el celular se sigue escribiendo sin buscarla.
  React.useEffect(() => {
    if (!focusLine.current) return
    document.getElementById(`np-line-${focusLine.current}-description`)?.focus()
    focusLine.current = null
  }, [draft.lines])

  const set = (patch: Partial<NoteDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setDraft((current) => ({ ...current, lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) }))

  function addLine() {
    const key = `l${++lineCounter.current}`
    focusLine.current = key
    setDraft((current) => (current.lines.length >= NEW_NOTE_MAX_LINES
      ? current
      : { ...current, lines: [...current.lines, newLine(key, defaultCharge(options, current.workOrderId))] }))
  }

  function discard() {
    clearDraft(userId)
    lineCounter.current = 1
    setDraft({ ...newDraft(options, initial), clientOpId: newClientOpId() })
    setRestoredAt(null)
    setAttempted(false)
    op.setMessage("")
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (op.pending || done) return
    // Las líneas que quedaron vacías no son un pedido: se quitan antes de validar para que los errores apunten a la línea que se ve.
    const next = { ...pruneBlankLines(draft), clientOpId: draft.clientOpId || newClientOpId() }
    setDraft(next)
    setAttempted(true)
    if (Object.keys(validateDraft(next)).length > 0) return
    op.run(
      () => createPartsNoteAction(buildNoteInput(next)),
      (result) => {
        const noteId = String(result.data?.noteId ?? "")
        clearDraft(userId)
        setDone(true)
        toast.success(result.message ?? "Nota creada.")
        router.replace(noteId ? `/mantencion/notas-pedido/${noteId}` : "/mantencion/notas-pedido")
      },
      (result) => {
        // El id de este borrador ya creó una nota para otra orden (el primer envío llegó pero su respuesta se perdió y después se
        // cambió la OT): reintentar con él chocaría para siempre. Se le da un id nuevo y se avisa, para que decida con la bandeja a la vista.
        if (!/^Ese identificador/.test(result.message ?? "")) return
        setDraft((current) => ({ ...current, clientOpId: newClientOpId() }))
        op.setMessage("Una nota con estos mismos datos ya se había enviado, para otra orden de trabajo. Revisa la bandeja de notas de pedido; si igual quieres crear ésta, vuelve a enviarla.", "error")
      },
    )
  }

  const worksiteOptions = React.useMemo(() => options.worksites.map((item) => ({ value: item.id, label: item.name })), [options.worksites])
  const orderOptions = React.useMemo(
    () => options.workOrders.filter((item) => item.worksiteId === draft.worksiteId).map((item) => ({ value: item.id, label: item.folio, hint: item.equipment })),
    [options.workOrders, draft.worksiteId],
  )
  const chargeOptions = React.useMemo(() => [
    ...options.vehicles.filter((item) => item.worksiteId === draft.worksiteId).map((item) => ({ value: `v:${item.id}`, label: vehicleLabel(item), hint: item.typeName })),
    ...options.costCenters.filter((item) => item.worksiteId === draft.worksiteId).map((item) => ({ value: `c:${item.id}`, label: `Centro de costo · ${item.name}`, hint: item.code })),
  ], [options.vehicles, options.costCenters, draft.worksiteId])
  const supplierOptions = React.useMemo(
    () => options.suppliers.map((item) => ({ value: item.id, label: item.name, hint: item.rut ?? undefined })),
    [options.suppliers],
  )

  // Errores: los del cliente (una vez intentado el envío) y los que devolvió el servidor, por la ruta del campo.
  const clientErrors = attempted ? validateDraft(draft) : {}
  const error = (field: string) => clientErrors[field] ?? op.fieldError(field)
  const lineError = (index: number, field: string) => {
    const at = (name: string) => error(`lines.${index}.${name}`)
    if (field === "charge") return at("chargeVehicleId") ?? at("chargeCostCenterId")
    if (field === "supplierId") return at("suggestedSupplierId")
    if (field === "unit") return at("unitOfMeasure") ?? at("unit")
    return at(field)
  }
  const hasClientErrors = Object.keys(clientErrors).length > 0
  const singleWorksite = options.worksites.length === 1
  const busy = op.pending || done

  return (
    <form onSubmit={submit} onKeyDown={blockEnterSubmit} noValidate aria-label="Nueva nota de pedido" className="flex flex-col gap-4">
      {restoredAt && (
        <Callout tone="info">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Recuperamos lo que dejaste escrito el {formatDateTime(restoredAt)}.</span>
            <Button type="button" variant="secondary" size="sm" onClick={discard} disabled={busy}>Empezar de nuevo</Button>
          </div>
        </Callout>
      )}

      <SectionCard title="Datos de la nota">
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Faena" required htmlFor="np-faena" error={error("worksiteId")} helper={singleWorksite ? "Es la única faena de tu alcance." : undefined}>
              {singleWorksite ? (
                <Input id="np-faena" value={options.worksites[0]!.name} readOnly />
              ) : (
                <OptionSelect
                  id="np-faena"
                  options={worksiteOptions}
                  value={draft.worksiteId}
                  placeholder="Elige la faena"
                  onValueChange={(worksiteId) => setDraft((current) => changeWorksite(current, worksiteId, options))}
                />
              )}
            </Field>
            <Field
              label="Orden de trabajo (opcional)"
              htmlFor="np-orden"
              error={error("workOrderId")}
              helper={draft.worksiteId && orderOptions.length === 0 ? "No hay órdenes abiertas en esta faena: la nota queda sin orden." : "Si el pedido es para una orden en curso, elígela."}
            >
              <Combobox
                id="np-orden"
                options={orderOptions}
                value={draft.workOrderId}
                onChange={(workOrderId) => setDraft((current) => changeWorkOrder(current, workOrderId, options))}
                clearLabel="Sin orden de trabajo"
                placeholder="Busca por folio o equipo"
                disabled={!draft.worksiteId}
              />
            </Field>
          </div>
          <div>
            <Checkbox
              id="np-urgente"
              label="Es urgente"
              aria-describedby="np-urgente-ayuda"
              checked={draft.urgent}
              onChange={(event) => set({ urgent: event.target.checked })}
            />
            <p id="np-urgente-ayuda" className="ml-6 text-xs text-(--color-text-subtle)">Márcala si el equipo está detenido o el repuesto no puede esperar.</p>
          </div>
          <Field label="Observación (opcional)" htmlFor="np-observacion" error={error("notes")}>
            <Textarea
              id="np-observacion"
              rows={3}
              maxLength={NEW_NOTE_NOTES_MAX}
              value={draft.notes}
              onChange={(event) => set({ notes: event.target.value })}
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Repuestos" description={`Lo que necesitas pedir. Hasta ${NEW_NOTE_MAX_LINES} por nota.`}>
        <ol className="flex flex-col gap-3">
          {draft.lines.map((line, index) => (
            <NewNoteLineEditor
              key={line.key}
              index={index}
              line={line}
              chargeOptions={chargeOptions}
              supplierOptions={supplierOptions}
              canRemove={draft.lines.length > 1}
              errors={(field) => lineError(index, field)}
              onChange={(patch) => updateLine(line.key, patch)}
              onRemove={() => setDraft((current) => ({ ...current, lines: current.lines.filter((item) => item.key !== line.key) }))}
            />
          ))}
        </ol>
        {error("lines") && <p role="alert" className="mt-2 text-xs text-(--color-danger)">{error("lines")}</p>}
        <div className="mt-3">
          <Button type="button" variant="secondary" size="sm" onClick={addLine} disabled={busy || draft.lines.length >= NEW_NOTE_MAX_LINES}>
            <Plus size={14} className="mr-1.5" aria-hidden /> Agregar repuesto
          </Button>
        </div>
      </SectionCard>

      {hasClientErrors && <Callout tone="danger" role="alert">Revisa los campos marcados.</Callout>}
      {op.message && (
        <Callout tone="danger" role="alert" title={op.message}>
          Lo que escribiste sigue aquí y puedes volver a enviarlo: la nota no se duplica.
        </Callout>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-(--color-text-subtle)" role="status">
          {storageFailed ? "No se pudo guardar el borrador en este navegador." : "Lo que escribes se guarda en este equipo hasta que envíes la nota."}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => router.back()} disabled={busy}>Cancelar</Button>
          <Button type="submit" loading={busy}>Enviar nota</Button>
        </div>
      </div>
    </form>
  )
}
