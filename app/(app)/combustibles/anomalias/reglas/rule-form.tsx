"use client"

import { useMemo } from "react"
import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ANOMALY_RULE_SEVERITIES, ANOMALY_RULE_SEVERITY_LABELS, KNOWN_RULE_CODES } from "@/lib/combustibles/validation"
import { createAnomalyRuleAction, updateAnomalyRuleAction } from "./actions"

export interface AnomalyRuleRow {
  id: string
  code: string
  name: string
  description: string | null
  severity: string
  isActive: boolean
  config: string | null
}

/** Extraer un valor numérico del JSON de configuración, o undefined si no existe. */
function configNumValue(config: string | null, key: string): number | undefined {
  if (!config) return undefined
  try {
    const parsed = JSON.parse(config)
    const val = parsed[key]
    return typeof val === "number" ? val : undefined
  } catch { return undefined }
}

export function AnomalyRuleForm({ open, onClose, editRow }: { open: boolean; onClose: () => void; editRow: AnomalyRuleRow | null }) {
  const cfg = editRow?.config ?? null
  const defaultMinSample = useMemo(() => configNumValue(cfg, "minSample"), [cfg])
  const defaultBatchRowLimit = useMemo(() => configNumValue(cfg, "batchRowLimit"), [cfg])

  return (
    <CatalogFormSheet
      open={open}
      onClose={onClose}
      isEdit={Boolean(editRow)}
      entityId={editRow?.id}
      title={editRow ? "Editar regla" : "Nueva regla"}
      description="El código debe coincidir con el que reconoce el motor de detección para que la regla tenga efecto; ver la lista de códigos conocidos abajo."
      create={createAnomalyRuleAction}
      update={updateAnomalyRuleAction}
      submitLabel={editRow ? "Guardar cambios" : "Crear regla"}
      successMessage={editRow ? "Regla actualizada" : "Regla creada"}
    >
      {(state) => <FieldGroup className="gap-4">
        <Field label="Código" htmlFor="rule-code" required error={state.fieldErrors?.code?.[0]} helper={`Códigos reconocidos hoy: ${KNOWN_RULE_CODES.join(", ")}`}>
          <Input id="rule-code" name="code" defaultValue={editRow?.code ?? ""} error={!!state.fieldErrors?.code} />
        </Field>
        <Field label="Nombre" htmlFor="rule-name" required error={state.fieldErrors?.name?.[0]}>
          <Input id="rule-name" name="name" defaultValue={editRow?.name ?? ""} error={!!state.fieldErrors?.name} />
        </Field>
        <Field label="Severidad" htmlFor="rule-severity" required error={state.fieldErrors?.severity?.[0]}>
          <Select name="severity" defaultValue={editRow?.severity ?? "medium"}>
            <SelectTrigger id="rule-severity"><SelectValue /></SelectTrigger>
            <SelectContent>{ANOMALY_RULE_SEVERITIES.map((item) => <SelectItem key={item} value={item}>{ANOMALY_RULE_SEVERITY_LABELS[item]}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Descripción" htmlFor="rule-description">
          <Textarea id="rule-description" name="description" rows={2} defaultValue={editRow?.description ?? ""} />
        </Field>
        <Field label="Muestra mínima (minSample)" htmlFor="rule-min-sample" helper="Observaciones necesarias antes de evaluar la regla. Mínimo 3. Aplica a reglas de rendimiento.">
          <Input id="rule-min-sample" name="minSample" type="number" min={3} step={1}
            defaultValue={defaultMinSample ?? ""} placeholder="Ej: 5" />
        </Field>
        <Field label="Límite de filas (batchRowLimit)" htmlFor="rule-batch-limit" helper="Máximo de filas a escanear por corrida batch. Mínimo 100. Aplica a reglas batch.">
          <Input id="rule-batch-limit" name="batchRowLimit" type="number" min={100} step={100}
            defaultValue={defaultBatchRowLimit ?? ""} placeholder="Ej: 50000" />
        </Field>
        <Field label="Configuración avanzada (JSON)" htmlFor="rule-config" error={state.fieldErrors?.config?.[0]}
          helper='Parámetros adicionales que no tienen campo propio, p. ej. { "margin": 0.05, "thresholdPct": 50 }. minSample y batchRowLimit se configuran arriba.'>
          <Textarea id="rule-config" name="config" rows={3} className="font-mono text-xs"
            defaultValue={editRow?.config ?? "{}"} error={!!state.fieldErrors?.config} />
        </Field>
        <Checkbox id="rule-active" name="isActive" label="Regla activa" defaultChecked={editRow?.isActive ?? true} />
      </FieldGroup>}
    </CatalogFormSheet>
  )
}
