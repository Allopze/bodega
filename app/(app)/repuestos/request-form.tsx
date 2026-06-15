"use client"

import * as React from "react"
import { useActionState } from "react"
import { Plus, Trash, FloppyDisk, PaperPlaneTilt } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { saveDraftAction, submitRequestAction } from "./actions"
import type { ActionState } from "@/lib/validation/repuestos"
import { toast } from "@/lib/toast"

interface WorksiteOption { id: string; name: string }

interface RepuestoItemState {
  id?:           string
  description:   string
  quantity:      number
  unitOfMeasure: string
  notes:         string
  partNumber:    string
  equipmentName: string
  patent:        string
  brand:         string
  model:         string
}

const EMPTY_ITEM = (): RepuestoItemState => ({
  description:   "",
  quantity:      1,
  unitOfMeasure: "unidad",
  notes:         "",
  partNumber:    "",
  equipmentName: "",
  patent:        "",
  brand:         "",
  model:         "",
})

const UNIT_OPTIONS = [
  { value: "unidad",  label: "Unidad" },
  { value: "par",     label: "Par" },
  { value: "kit",     label: "Kit" },
  { value: "litro",   label: "Litro" },
  { value: "metro",   label: "Metro" },
  { value: "caja",    label: "Caja" },
  { value: "juego",   label: "Juego" },
  { value: "otro",    label: "Otro" },
]

export interface RepuestoFormProps {
  worksites: WorksiteOption[]
  editRequest?: {
    id:            string
    worksiteId:    string
    urgency:       string
    requiredDate:  string
    justification: string | null
    items:         RepuestoItemState[]
  }
}

export function RepuestoForm({ worksites, editRequest }: RepuestoFormProps) {
  const [requestId, setRequestId] = React.useState<string | undefined>(editRequest?.id)
  const [worksiteId,    setWorksiteId]    = React.useState(editRequest?.worksiteId ?? worksites[0]?.id ?? "")
  const [urgency,       setUrgency]       = React.useState(editRequest?.urgency ?? "normal")
  const [requiredDate,  setRequiredDate]  = React.useState(editRequest?.requiredDate ?? "")
  const [justification, setJustification] = React.useState(editRequest?.justification ?? "")
  const [items,         setItems]         = React.useState<RepuestoItemState[]>(
    editRequest?.items?.length ? editRequest.items : [EMPTY_ITEM()]
  )

  const [draftState, draftAction, draftPending] = useActionState(
    async (prev: ActionState, formData: FormData): Promise<ActionState & { requestId?: string }> => {
      const res = await saveDraftAction(prev, formData)
      if (res.ok) {
        if (res.requestId) setRequestId(res.requestId)
        toast.success(res.message ?? "Borrador guardado")
      } else {
        toast.error(res.message ?? "Error al guardar")
      }
      return res
    },
    { ok: false },
  )

  const [submitState, submitFormAction, submitPending] = useActionState(
    submitRequestAction,
    { ok: false },
  )
  React.useEffect(() => {
    if (submitState.ok === false && submitState.message) {
      toast.error(submitState.message)
    }
  }, [submitState])

  const addItem = () => setItems((prev) => [...prev, EMPTY_ITEM()])
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx))
  const updateItem = (idx: number, patch: Partial<RepuestoItemState>) =>
    setItems((prev) => prev.map((item, i) => i === idx ? { ...item, ...patch } : item))

  const itemsJson = JSON.stringify(
    items.map((item, i) => ({
      ...(item.id ? { id: item.id } : {}),
      description:   item.description,
      quantity:      Number(item.quantity),
      unitOfMeasure: item.unitOfMeasure,
      sortOrder:     i,
      notes:         item.notes || null,
      partNumber:    item.partNumber || null,
      equipmentName: item.equipmentName || null,
      patent:        item.patent || null,
      brand:         item.brand || null,
      model:         item.model || null,
    }))
  )

  const isEditable = !editRequest || ["draft", "returned"].includes(editRequest?.id ? "draft" : "draft")

  return (
    <div className="space-y-8">
      {/* Header fields */}
      <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Datos generales</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Faena" required>
            <Select
              value={worksiteId}
              onValueChange={setWorksiteId}
              disabled={!!editRequest}
            >
              {worksites.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
          </Field>

          <Field label="Urgencia" required>
            <Select value={urgency} onValueChange={setUrgency}>
              <option value="normal">Normal</option>
              <option value="high">Alta</option>
              <option value="critical">Crítica</option>
            </Select>
          </Field>

          <Field label="Fecha requerida" required>
            <Input
              type="date"
              value={requiredDate}
              onChange={(e) => setRequiredDate(e.target.value)}
            />
          </Field>

          <Field
            label="Justificación (si adjuntas menos de 3 cotizaciones)"
            helper="Explica por qué no fue posible obtener 3 cotizaciones"
          >
            <Input
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Proveedor único, urgencia, mercado limitado..."
              maxLength={500}
            />
          </Field>
        </div>
      </section>

      {/* Items */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Repuestos solicitados
            <span className="ml-2 text-[var(--color-text-subtle)] font-normal">({items.length})</span>
          </h2>
          <Button type="button" variant="secondary" size="sm" onClick={addItem}>
            <Plus weight="bold" size={14} />
            Agregar repuesto
          </Button>
        </div>

        {items.map((item, idx) => (
          <div
            key={idx}
            className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--color-text-subtle)] uppercase tracking-wide">
                Repuesto {idx + 1}
              </span>
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  className="h-7 w-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger-ink)] transition-colors"
                  aria-label="Eliminar repuesto"
                >
                  <Trash size={14} />
                </button>
              )}
            </div>

            {/* Part description */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Descripción del repuesto" required className="sm:col-span-2">
                <Input
                  value={item.description}
                  onChange={(e) => updateItem(idx, { description: e.target.value })}
                  placeholder="Ej: Filtro de aceite, Correa de distribución..."
                  maxLength={200}
                />
              </Field>
              <Field label="N° de Parte">
                <Input
                  value={item.partNumber}
                  onChange={(e) => updateItem(idx, { partNumber: e.target.value })}
                  placeholder="OEM o fabricante"
                  maxLength={80}
                />
              </Field>
            </div>

            {/* Quantity */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cantidad" required>
                <Input
                  type="number"
                  min={0.001}
                  step="any"
                  value={item.quantity}
                  onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                />
              </Field>
              <Field label="Unidad">
                <Select
                  value={item.unitOfMeasure}
                  onValueChange={(v) => updateItem(idx, { unitOfMeasure: v })}
                >
                  {UNIT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </Select>
              </Field>
            </div>

            {/* Equipment info */}
            <div className="pt-2 border-t border-[var(--color-border)]">
              <p className="text-xs font-medium text-[var(--color-text-subtle)] mb-3">Equipo asociado</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Equipo / Máquina" className="sm:col-span-2">
                  <Input
                    value={item.equipmentName}
                    onChange={(e) => updateItem(idx, { equipmentName: e.target.value })}
                    placeholder="Ej: Retroexcavadora, Camión grúa..."
                    maxLength={150}
                  />
                </Field>
                <Field label="Patente / Código interno">
                  <Input
                    value={item.patent}
                    onChange={(e) => updateItem(idx, { patent: e.target.value })}
                    placeholder="Ej: ABCD-12"
                    maxLength={20}
                  />
                </Field>
                <Field label="Marca">
                  <Input
                    value={item.brand}
                    onChange={(e) => updateItem(idx, { brand: e.target.value })}
                    placeholder="Ej: Caterpillar, Volvo..."
                    maxLength={80}
                  />
                </Field>
                <Field label="Modelo">
                  <Input
                    value={item.model}
                    onChange={(e) => updateItem(idx, { model: e.target.value })}
                    placeholder="Ej: 320D, FH16..."
                    maxLength={80}
                  />
                </Field>
                <Field label="Observaciones">
                  <Input
                    value={item.notes}
                    onChange={(e) => updateItem(idx, { notes: e.target.value })}
                    placeholder="Detalle adicional..."
                    maxLength={300}
                  />
                </Field>
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Actions */}
      <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-2">
        {/* Hidden inputs shared between both forms */}
        {/* Save draft form */}
        <form action={draftAction} className="contents">
          <input type="hidden" name="id" value={requestId ?? ""} />
          <input type="hidden" name="worksiteId" value={worksiteId} />
          <input type="hidden" name="urgency" value={urgency} />
          <input type="hidden" name="requiredDate" value={requiredDate} />
          <input type="hidden" name="justification" value={justification} />
          <input type="hidden" name="itemsJson" value={itemsJson} />
          <Button type="submit" variant="secondary" size="default" disabled={draftPending}>
            <FloppyDisk size={16} />
            {draftPending ? "Guardando…" : "Guardar borrador"}
          </Button>
        </form>

        {/* Submit form */}
        <form action={submitFormAction} className="contents">
          <input type="hidden" name="requestId" value={requestId ?? ""} />
          <Button
            type="submit"
            variant="primary"
            size="default"
            disabled={submitPending || !requestId}
            title={!requestId ? "Guarda el borrador antes de enviar" : undefined}
          >
            <PaperPlaneTilt size={16} />
            {submitPending ? "Enviando…" : "Enviar a aprobación"}
          </Button>
        </form>
      </div>
    </div>
  )
}
