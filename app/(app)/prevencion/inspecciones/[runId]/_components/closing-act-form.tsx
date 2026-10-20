"use client"

import * as React from "react"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { formatSignatureRole, type ClosingActSpec } from "@/lib/prevention/inspections"
import type { InspectionDraftApi } from "../_hooks/use-inspection-draft"

/**
 * El acta de cierre que declara la plantilla, mientras se edita: resultado,
 * restricciones y nombre de quien firma. Lo escrito vive en el borrador
 * (`updateClosing`), no aquí.
 */
export function ClosingActForm({ closingAct, closing, updateClosing }: {
  closingAct: ClosingActSpec
  closing: InspectionDraftApi["closing"]
  updateClosing: InspectionDraftApi["updateClosing"]
}) {
  return (
    // `id`: el resumen del progreso («acta incompleta») salta aquí.
    <section id="acta-cierre" className="scroll-mt-20 space-y-3">
      <h2 className="text-h2">{closingAct.title}</h2>
      <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
        <Field label="Resultado" required>
          <Select value={closing.result || "__unset__"} onValueChange={(value) => updateClosing((c) => ({ ...c, result: value === "__unset__" ? "" : value }))}>
            <SelectTrigger aria-label="Resultado del acta"><SelectValue placeholder="Sin declarar" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__unset__">Sin declarar</SelectItem>
              {closingAct.resultOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        {closingAct.hasRestrictions && (
          <Field label="Restricciones" hint="Opcional.">
            <Textarea
              value={closing.restrictions ?? ""}
              onChange={(event) => updateClosing((c) => ({ ...c, restrictions: event.target.value }))}
              maxLength={3000}
              aria-label="Restricciones del acta"
            />
          </Field>
        )}
        {closing.signatures.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2">
            {closing.signatures.map((signature, index) => (
              /* Sin `htmlFor` a propósito: el `Input` ya declara su
               * `aria-label` abajo, y pasarlo haría que `Field` inyecte un
               * `aria-labelledby` que lo pisa —el nombre accesible pasaría
               * de "Firma de prevencionista" a "Firma: prevencionista"— y
               * rompe a todo el que localice el campo por su nombre. */
              <Field key={signature.role} label={`Firma: ${formatSignatureRole(signature.role)}`} hint="Nombre de quien firma.">
                <Input
                  value={signature.name}
                  onChange={(event) => updateClosing((c) => ({
                    ...c,
                    signatures: c.signatures.map((item, i) => i === index ? { ...item, name: event.target.value } : item),
                  }))}
                  maxLength={200}
                  aria-label={`Firma de ${formatSignatureRole(signature.role)}`}
                />
              </Field>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
