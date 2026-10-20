"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { PdtpActivityPicker, type PdtpActivityPickerOption } from "@/components/prevention/pdtp-activity-picker"
import {
  changedPdtpAxes,
  numbersAccreditationNotice,
  pdtpSavePayload,
  unmappedPdtpWarning,
} from "@/lib/prevention/inspection-catalog-logic"
import { toast } from "@/lib/toast"
import { setInspectionTemplatePdtpActivitiesAction } from "../../actions"
import type { TemplateItem } from "../../_components/catalog-types"
import { FormDialogFooter, OperationError, useFormDialog } from "../../_components/form-dialog"

/* ── Acreditación PDTP ─────────────────────────────────────────────────────── */

/**
 * Declara qué actividades del programa anual acredita la plantilla. Sin esto
 * el conector `onInspectionCompleted` no hace nada y la inspección jamás llega
 * al PDTP — que fue el estado de todas las plantillas hasta 2026-08-04.
 *
 * Abre con lo que la plantilla acredita hoy —los vínculos del catálogo o, si
 * todavía acredita por número, las actividades equivalentes— y manda **sólo los
 * ejes que la persona cambió**. Mandar siempre los dos vaciaba en silencio el
 * eje que no se tocó, y la plantilla dejaba de acreditar sin que nadie lo notara.
 */
export function PdtpActivitiesDialog({ item, options }: { item: TemplateItem; options: PdtpActivityPickerOption[] }) {
  const preload = { execute: item.pdtpPreloadExecuteIds, review: item.pdtpPreloadReviewIds }
  const [execution, setExecution] = React.useState<string[]>(preload.execute)
  const [review, setReview] = React.useState<string[]>(preload.review)
  const { open, changeOpen, operation } = useFormDialog(() => { setExecution(preload.execute); setReview(preload.review) })
  const changed = changedPdtpAxes({ execute: execution, review }, preload)

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Acreditación PDTP</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            operation.run(
              () => setInspectionTemplatePdtpActivitiesAction({
                templateId: item.id,
                expectedVersion: item.version,
                ...pdtpSavePayload({ execute: execution, review }, preload),
              }),
              () => {
                toast.success("Acreditación PDTP actualizada.")
                changeOpen(false)
              },
            )
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Acreditación PDTP · {item.name}</DialogTitle>
            <DialogDescription>
              Elige qué identidad corporativa acredita la ejecución y cuál acredita la revisión segregada.
            </DialogDescription>
          </DialogHeader>
          {options.length === 0 && (
            <Callout tone="warning">
              No hay actividades publicadas en el catálogo corporativo.
            </Callout>
          )}
          {options.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <PdtpActivityPicker multiple label="Al declarar ejecutada" options={options} value={execution} onChange={setExecution} />
                <AxisNotices
                  fromNumbers={item.pdtpAccreditation.executeSource === "numbers"}
                  numbers={item.pdtpActivityNumbers ?? []}
                  unmapped={item.pdtpUnmappedNumbers.execute}
                />
              </div>
              <div className="space-y-2">
                <PdtpActivityPicker multiple label="Al revisar y cerrar" options={options} value={review} onChange={setReview} />
                <AxisNotices
                  fromNumbers={item.pdtpAccreditation.reviewSource === "numbers"}
                  numbers={item.pdtpReviewActivityNumbers ?? []}
                  unmapped={item.pdtpUnmappedNumbers.review}
                />
              </div>
            </div>
          )}
          <OperationError operation={operation} />
          <FormDialogFooter submitLabel="Guardar" pending={operation.pending} disabled={options.length === 0 || !changed.any} onCancel={() => changeOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Los avisos de un eje que todavía acredita por número: que hoy es así, y qué
 * pasa con los números que no tienen actividad equivalente en el catálogo.
 */
function AxisNotices({ fromNumbers, numbers, unmapped }: { fromNumbers: boolean; numbers: number[]; unmapped: number[] }) {
  if (!fromNumbers) return null
  return (
    <div className="space-y-2">
      <Callout tone="info" className="text-xs">{numbersAccreditationNotice(numbers.map((n) => `N° ${n}`))}</Callout>
      {unmapped.map((n) => (
        <Callout key={n} tone="warning" className="text-xs">{unmappedPdtpWarning(n)}</Callout>
      ))}
    </div>
  )
}
