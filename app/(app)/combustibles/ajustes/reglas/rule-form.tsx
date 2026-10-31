"use client"

import * as React from "react"
import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  BATCH_ROW_LIMIT_PARAMETER,
  describeRuleTrigger,
  isBatchRuleCode,
  isKnownRuleCode,
  mergeRuleParameters,
  parseRuleConfig,
  ruleParametersFor,
  ruleParameterValue,
  type RuleParameter,
} from "@/lib/combustibles/control/catalogs"
import { ANOMALY_RULE_SEVERITIES, ANOMALY_RULE_SEVERITY_LABELS, KNOWN_RULE_CODES } from "@/lib/combustibles/validation"
import type { ActionState } from "@/lib/validation/masters"
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

const decimalText = (value: number) => String(value).replace(".", ",")

export function AnomalyRuleForm({ open, onClose, editRow, existingCodes = [] }: {
  open: boolean
  onClose: () => void
  editRow: AnomalyRuleRow | null
  /** Códigos que ya tienen regla: la lista de sugerencias al crear no los repite. */
  existingCodes?: readonly string[]
}) {
  return (
    <CatalogFormSheet
      open={open}
      onClose={onClose}
      isEdit={Boolean(editRow)}
      entityId={editRow?.id}
      title={editRow ? "Editar regla" : "Nueva regla"}
      description={editRow
        ? "Cambia la gravedad, cuándo se activa o si está activa. Los casos que ya se abrieron no cambian."
        : "Elige el código que reconoce el motor de detección; con otro código la regla no tiene efecto."}
      create={createAnomalyRuleAction}
      update={updateAnomalyRuleAction}
      submitLabel={editRow ? "Guardar cambios" : "Crear regla"}
      successMessage={editRow ? "Regla actualizada" : "Regla creada"}
    >
      {(state) => <RuleFields state={state} editRow={editRow} existingCodes={existingCodes} />}
    </CatalogFormSheet>
  )
}

function RuleFields({ state, editRow, existingCodes }: { state: ActionState; editRow: AnomalyRuleRow | null; existingCodes: readonly string[] }) {
  // Todo es controlado: tras un envío rechazado React 19 reinicia los campos no controlados y
  // quien editaba perdería lo escrito.
  const [code, setCode] = React.useState(editRow?.code ?? "")
  const [name, setName] = React.useState(editRow?.name ?? "")
  const [severity, setSeverity] = React.useState(editRow?.severity ?? "medium")
  const [description, setDescription] = React.useState(editRow?.description ?? "")
  const [isActive, setIsActive] = React.useState(editRow?.isActive ?? true)
  const [configText, setConfigText] = React.useState(editRow?.config ?? "{}")
  const baseConfig = React.useMemo(() => parseRuleConfig(configText), [configText])
  const parameters = ruleParametersFor(code)
  const batchRule = isBatchRuleCode(code)
  const catalogCode = Boolean(editRow && isKnownRuleCode(editRow.code))

  // Valor escrito en cada campo de parámetro; vacío = «usa el valor del sistema».
  const [values, setValues] = React.useState<Record<string, string>>(() => {
    const config = parseRuleConfig(editRow?.config) ?? {}
    const initial: Record<string, string> = {}
    for (const parameter of [...ruleParametersFor(editRow?.code ?? ""), BATCH_ROW_LIMIT_PARAMETER]) {
      const value = ruleParameterValue(parameter, config)
      initial[parameter.key] = value === undefined ? "" : decimalText(value)
    }
    return initial
  })

  // La frase que verá quien mire la tabla, con lo que está escrito ahora.
  const preview = React.useMemo(() => {
    if (baseConfig === null || !code) return null
    const merged = mergeRuleParameters(parameters, baseConfig, values)
    return Object.keys(merged.errors).length > 0 ? null : describeRuleTrigger(code, JSON.stringify(merged.config))
  }, [baseConfig, code, parameters, values])

  const renderParameter = (parameter: RuleParameter) => {
    const error = state.fieldErrors?.[`param:${parameter.key}`]?.[0]
    const id = `rule-param-${parameter.key}`
    return (
      <Field key={parameter.key} label={parameter.label} htmlFor={id} helper={`${parameter.helper} Vacío: ${decimalText(parameter.defaultValue)}.`} error={error}>
        <Input
          id={id}
          name={`param:${parameter.key}`}
          inputMode="decimal"
          value={values[parameter.key] ?? ""}
          onChange={(event) => setValues((current) => ({ ...current, [parameter.key]: event.target.value }))}
          placeholder={decimalText(parameter.defaultValue)}
          error={!!error}
          className="max-w-40 font-mono tabular-nums"
        />
      </Field>
    )
  }

  const unusedCodes = KNOWN_RULE_CODES.filter((item) => !existingCodes.includes(item))

  return (
    <FieldGroup className="gap-4">
      {editRow ? null : (
        <>
          <Field label="Código" htmlFor="rule-code" required error={state.fieldErrors?.code?.[0]} helper="En minúsculas, con guion bajo. Escribe o elige uno de los que reconoce el motor.">
            <Input id="rule-code" name="code" list="rule-known-codes" value={code} onChange={(event) => setCode(event.target.value)} error={!!state.fieldErrors?.code} autoComplete="off" />
          </Field>
          <datalist id="rule-known-codes">{unusedCodes.map((item) => <option key={item} value={item} />)}</datalist>
        </>
      )}
      <Field label="Nombre" htmlFor="rule-name" required error={state.fieldErrors?.name?.[0]}>
        <Input id="rule-name" name="name" value={name} onChange={(event) => setName(event.target.value)} error={!!state.fieldErrors?.name} />
      </Field>
      <Field label="Gravedad" htmlFor="rule-severity" required error={state.fieldErrors?.severity?.[0]} helper="Se aplica a los casos nuevos.">
        <Select name="severity" value={severity} onValueChange={setSeverity}>
          <SelectTrigger id="rule-severity"><SelectValue /></SelectTrigger>
          <SelectContent>{ANOMALY_RULE_SEVERITIES.map((item) => <SelectItem key={item} value={item}>{ANOMALY_RULE_SEVERITY_LABELS[item]}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Descripción" htmlFor="rule-description" error={state.fieldErrors?.description?.[0]}>
        <Textarea id="rule-description" name="description" rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
      </Field>

      {parameters.length > 0 ? (
        <fieldset className="space-y-4 rounded-xl border border-[var(--color-border)] p-4">
          <legend className="px-1 text-sm font-semibold text-[var(--color-text)]">¿Cuándo se activa?</legend>
          {parameters.map(renderParameter)}
          {preview ? <p className="text-sm text-[var(--color-text-muted)]" aria-live="polite">Así se leerá en la lista: {preview}</p> : null}
        </fieldset>
      ) : code ? (
        <p className="text-sm text-[var(--color-text-muted)]">{describeRuleTrigger(code, configText)}{isKnownRuleCode(code) ? " No tiene parámetros que ajustar." : ""}</p>
      ) : null}

      <Checkbox id="rule-active" name="isActive" label="Regla activa" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />

      <details className="rounded-xl border border-[var(--color-border)] p-4 [&_summary]:cursor-pointer" open={Boolean(state.fieldErrors?.config || state.fieldErrors?.code) || undefined}>
        <summary className="text-sm font-semibold text-[var(--color-text)]">Avanzado: código y configuración en JSON</summary>
        <div className="mt-4 space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">Sólo para administración del sistema. El código de una regla del catálogo no se puede cambiar.</p>
          {editRow ? (
            <Field label="Código" htmlFor="rule-code" error={state.fieldErrors?.code?.[0]} helper={catalogCode ? "Es una regla del catálogo: el motor la reconoce por este código." : "Debe coincidir con el que reconoce el motor para que la regla tenga efecto."}>
              <Input id="rule-code" name="code" value={code} onChange={(event) => setCode(event.target.value)} readOnly={catalogCode} error={!!state.fieldErrors?.code} className="font-mono text-xs" />
            </Field>
          ) : null}
          {batchRule ? renderParameter(BATCH_ROW_LIMIT_PARAMETER) : null}
          <Field
            label="Configuración (JSON)"
            htmlFor="rule-config"
            error={state.fieldErrors?.config?.[0]}
            helper='Parámetros sin campo propio, p. ej. excepciones por tipo de equipo. Los campos de arriba tienen prioridad sobre el JSON.'
          >
            <Textarea id="rule-config" name="config" rows={4} className="font-mono text-xs" value={configText} onChange={(event) => setConfigText(event.target.value)} error={!!state.fieldErrors?.config} />
          </Field>
        </div>
      </details>
    </FieldGroup>
  )
}
