"use client"

import * as React from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Combobox } from "@/components/ui/combobox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { officialSourceGate, retireTemplateMessage, rollbackTemplateMessage } from "@/lib/prevention/inspection-catalog-logic"
import { toast } from "@/lib/toast"
import {
  approveInspectionTemplateAction,
  linkInspectionTemplateSourceAction,
  retireInspectionTemplateAction,
  rollbackInspectionTemplateAction,
  setInspectionTemplateParityAction,
} from "../../actions"
import type { DocumentSourceOption, TemplateItem } from "../../_components/catalog-types"
import { FormDialogFooter, OperationError, ReasonField, useFormDialog } from "../../_components/form-dialog"

/**
 * Declara si la transcripción digital coincide con la planilla oficial.
 *
 * Antes esto se afirmaba con una casilla en el diálogo de importación que
 * comparaba la definición consigo misma y sólo sabía decir «sí». Quien no la
 * marcaba dejaba la plantilla en `pending`, y nada podía sacarla de ahí. Acá se
 * declara contra el documento ya vinculado, se pueden enumerar las diferencias,
 * y queda la traza de quién lo hizo.
 */
export function ParityDialog({ item }: { item: TemplateItem }) {
  const initialStatus = item.parityReport?.status === "failed" ? "failed" : "passed"
  const [status, setStatus] = React.useState<"passed" | "failed">(initialStatus)
  // Al abrir se parte de la paridad guardada, no de una elección abandonada.
  const { open, changeOpen, operation } = useFormDialog(() => setStatus(initialStatus))
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button size="sm" variant="secondary">Declarar paridad</Button></DialogTrigger>
    <DialogContent><form className="space-y-4" onSubmit={(event) => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      const toCount = (name: string) => {
        const raw = String(form.get(name) ?? "").trim()
        return raw === "" ? null : Number(raw)
      }
      const differences = String(form.get("differences") ?? "")
        .split("\n").map((line) => line.trim()).filter(Boolean)
      operation.run(() => setInspectionTemplateParityAction({
        templateId: item.id,
        expectedVersion: item.version,
        status,
        expectedItems: toCount("expectedItems"),
        actualItems: toCount("actualItems"),
        differences: status === "failed" ? differences : [],
        reason: String(form.get("reason") ?? ""),
      }), () => {
        toast.success(status === "passed" ? "Paridad declarada: sin diferencias." : "Paridad declarada con diferencias.")
        changeOpen(false)
      })
    }}>
      <DialogHeader>
        <DialogTitle>Paridad de {item.name}</DialogTitle>
        <DialogDescription>
          Contrasta la definición digital con {item.sourceSnapshot?.fileName ?? "el anexo vinculado"}. Sin paridad aprobada el instrumento no puede habilitarse.
        </DialogDescription>
      </DialogHeader>
      <Field label="Resultado" required>
        <Select value={status} onValueChange={(value) => setStatus(value as "passed" | "failed")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="passed">Coincide, sin diferencias</SelectItem>
            <SelectItem value="failed">Tiene diferencias</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ítems del anexo" error={operation.fieldError("expectedItems")}><Input name="expectedItems" type="number" min={0} inputMode="numeric" /></Field>
        <Field label="Ítems transcritos" error={operation.fieldError("actualItems")}><Input name="actualItems" type="number" min={0} inputMode="numeric" /></Field>
      </div>
      {status === "failed" && (
        <Field label="Diferencias, una por línea" required error={operation.fieldError("differences")}>
          <Textarea name="differences" required rows={4} placeholder={"Falta el ítem «Estado del cinturón»\nLa columna N/A no existe en el anexo"} />
        </Field>
      )}
      <ReasonField maxLength={3000} error={operation.fieldError("reason")} />
      <OperationError operation={operation} />
      <FormDialogFooter submitLabel="Guardar paridad" pending={operation.pending} onCancel={() => changeOpen(false)} />
    </form></DialogContent>
  </Dialog>
}

/**
 * Vincula —o cambia— la planilla oficial de un borrador.
 *
 * Sin esto un anexo oficial incorporado sin su archivo no podía aprobarse
 * nunca: aprobar exige la fuente y la paridad, y lo único posible era retirarlo
 * y volver a incorporarlo. Con el checksum conocido sólo se ofrece el archivo
 * que coincide (el servidor rechaza los demás) y viene elegido.
 */
export function LinkSourceDialog({ item, documentSources, label }: {
  item: TemplateItem
  documentSources: DocumentSourceOption[]
  label: "Vincular fuente" | "Cambiar fuente"
}) {
  const base = officialSourceGate({ needsOfficialSource: true, officialChecksumSha256: item.officialChecksumSha256, sources: documentSources, selectedId: "" })
  const initialSourceId = base.preselectedId || item.sourceDocumentVersionId || ""
  const [sourceId, setSourceId] = React.useState(initialSourceId)
  const { open, changeOpen, operation } = useFormDialog(() => setSourceId(initialSourceId))
  const gate = officialSourceGate({ needsOfficialSource: true, officialChecksumSha256: item.officialChecksumSha256, sources: documentSources, selectedId: sourceId })

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const revision = String(new FormData(event.currentTarget).get("sourceRevision") ?? "").trim()
    operation.run(() => linkInspectionTemplateSourceAction({
      templateId: item.id,
      expectedVersion: item.version,
      sourceDocumentVersionId: sourceId,
      sourceRevision: revision || undefined,
    }), () => {
      toast.success("Planilla oficial vinculada. La paridad quedó pendiente.")
      changeOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">{label}</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Vincular planilla oficial · {item.name}</DialogTitle>
            <DialogDescription>La paridad se declara contra este archivo. Cambiarlo deja la paridad pendiente otra vez.</DialogDescription>
          </DialogHeader>
          <Field label="Fuente documental de la Biblioteca SST" required error={operation.fieldError("sourceDocumentVersionId")}>
            <Combobox
              id={`link-source-${item.id}`}
              options={gate.candidates.map((source) => ({
                value: source.id,
                label: source.documentCode ?? source.documentTitle,
                hint: source.fileName,
              }))}
              value={sourceId}
              onChange={setSourceId}
              placeholder="Buscar por código o nombre de archivo…"
              aria-label="Fuente documental de la Biblioteca SST"
            />
          </Field>
          {gate.noMatch && (
            <Callout tone="warning">
              No hay en la Biblioteca SST una versión vigente con el checksum del anexo oficial. Súbela en{" "}
              <Link href="/prevencion/documentacion" className="underline">Documentación</Link> y vuelve a vincularla.
            </Callout>
          )}
          <Field label="Revisión impresa" hint="Opcional." error={operation.fieldError("sourceRevision")}>
            <Input name="sourceRevision" placeholder="Ej. Rev. 02" maxLength={120} />
          </Field>
          <OperationError operation={operation} />
          <FormDialogFooter submitLabel="Vincular" pending={operation.pending} disabled={sourceId === ""} onCancel={() => changeOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function RollbackTemplateDialog({ current, previous }: { current: TemplateItem; previous: TemplateItem }) {
  const { open, changeOpen, operation } = useFormDialog()
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button size="sm" variant="secondary">Revertir versión</Button></DialogTrigger>
    <DialogContent><form className="space-y-4" onSubmit={(event) => {
      event.preventDefault()
      const reason = String(new FormData(event.currentTarget).get("reason") ?? "")
      operation.run(() => rollbackInspectionTemplateAction({ currentTemplateId: current.id, previousTemplateId: previous.id, reason }), (result) => {
        toast.success(rollbackTemplateMessage(previous.versionLabel, result.data))
        changeOpen(false)
      })
    }}>
      <DialogHeader><DialogTitle>Volver a {previous.versionLabel}</DialogTitle><DialogDescription>Programas y ejecuciones todavía planificadas volverán a la versión anterior. Las iniciadas o cerradas conservarán {current.versionLabel}.</DialogDescription></DialogHeader>
      <ReasonField label="Motivo de la reversión" error={operation.fieldError("reason")} />
      <OperationError operation={operation} />
      <FormDialogFooter submitLabel="Confirmar reversión" pending={operation.pending} onCancel={() => changeOpen(false)} />
    </form></DialogContent>
  </Dialog>
}

/* ── Aprobar plantilla ─────────────────────────────────────────────────────── */

export function ApproveDialog({ templateId, name, expectedVersion }: { templateId: string; name: string; expectedVersion: number }) {
  const { open, changeOpen, operation } = useFormDialog()

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Aprobar</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            operation.run(() => approveInspectionTemplateAction({ templateId, expectedVersion, reason: form.get("reason") }), () => {
              toast.success("Plantilla aprobada.")
              changeOpen(false)
            })
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Aprobar {name}</DialogTitle>
            <DialogDescription>Congela el contenido y reemplaza la versión aprobada anterior del mismo código.</DialogDescription>
          </DialogHeader>
          <ReasonField error={operation.fieldError("reason")} />
          <OperationError operation={operation} />
          <FormDialogFooter submitLabel="Aprobar" pending={operation.pending} onCancel={() => changeOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Retirar plantilla ─────────────────────────────────────────────────────── */

/**
 * Saca un instrumento de circulación.
 *
 * Borra la fila si nunca se usó; si tiene ejecuciones o programaciones, la
 * marca retirada. Esa asimetría la resuelve el servidor, no esta pantalla: la
 * plantilla guarda el cuestionario congelado con el que se firmaron sus
 * inspecciones, y borrarla las dejaría sin las preguntas que respondieron. Lo
 * que sí hace esta pantalla es decir cuál de las dos cosas pasó, y a cuántas
 * programaciones activas dejó sin generar inspecciones.
 */
export function RetireDialog({ templateId, name }: { templateId: string; name: string }) {
  const { open, changeOpen, operation } = useFormDialog()

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      {/* I-20: una acción destructiva no se ve como una neutra. */}
      <DialogTrigger asChild><Button size="sm" variant="ghost-danger">Retirar</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            operation.run(() => retireInspectionTemplateAction({ templateId, reason: form.get("reason") }), (result) => {
              toast.success(retireTemplateMessage(result.data))
              changeOpen(false)
            })
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Retirar {name}</DialogTitle>
            <DialogDescription>
              Deja de poder programarse y ejecutarse. Si nunca se usó, se elimina. Si tiene inspecciones, queda como «Retirada» con sus respuestas intactas, y sus programaciones dejan de generar inspecciones.
            </DialogDescription>
          </DialogHeader>
          <ReasonField error={operation.fieldError("reason")} />
          <OperationError operation={operation} />
          <FormDialogFooter submitLabel="Retirar plantilla" variant="destructive" pending={operation.pending} onCancel={() => changeOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  )
}
