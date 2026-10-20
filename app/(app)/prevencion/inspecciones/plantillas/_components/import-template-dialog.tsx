"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Combobox } from "@/components/ui/combobox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { INSPECTION_KIND_LABELS } from "@/lib/prevention/inspections"
import { officialSourceGate } from "@/lib/prevention/inspection-catalog-logic"
import { toast } from "@/lib/toast"
import { importInspectionTemplateAction } from "../../actions"
import {
  coverageLabel,
  type DocumentSourceOption,
  type ImportableDefinition,
  type TemplateItem,
} from "../../_components/catalog-types"
import { FormDialogFooter, OperationError, useFormDialog } from "../../_components/form-dialog"

/* ── Incorporar plantilla ─────────────────────────────────────────────────── */

/** Centinela de "sin actividad": `Select` reserva el string vacío. */
const NO_ACTIVITY = "__none__"

export function ImportTemplateDialog({ importable, templates, documentSources }: {
  importable: ImportableDefinition[]
  templates: TemplateItem[]
  documentSources: DocumentSourceOption[]
}) {
  const versionsByDefinition = React.useMemo(() => {
    const map = new Map<string, { approved?: TemplateItem; latest?: TemplateItem }>()
    for (const template of templates) {
      if (!template.sourceDefinitionCode) continue
      const entry = map.get(template.sourceDefinitionCode) ?? {}
      if (template.status === "approved") entry.approved = template
      if (!entry.latest) entry.latest = template
      map.set(template.sourceDefinitionCode, entry)
    }
    return map
  }, [templates])
  const [code, setCode] = React.useState(importable[0]?.code ?? "")
  /*
   * Lo que la persona cambió a mano, atado a la definición para la que lo
   * cambió. Cambiar de definición vuelve a los valores propios de la nueva —el
   * tipo y la fuente preseleccionada salen de ella— sin un efecto que pise lo
   * escrito cuando llegan props nuevas.
   */
  const [kindEdit, setKindEdit] = React.useState<{ code: string; value: string } | null>(null)
  const [sourceEdit, setSourceEdit] = React.useState<{ code: string; id: string } | null>(null)
  /** Actividad elegida cuando la definición sirve a más de una. */
  const [activityEdit, setActivityEdit] = React.useState<{ code: string; value: string } | null>(null)
  const { open, changeOpen, operation } = useFormDialog(() => {
    setCode(importable[0]?.code ?? "")
    setKindEdit(null)
    setSourceEdit(null)
    setActivityEdit(null)
  })
  const definition = importable.find((item) => item.code === code)
  const existing = versionsByDefinition.get(code)
  const ambiguous = (definition?.pdtpActivities.length ?? 0) > 1

  // Una auditoría o una observación no son «inspección»: el tipo sale de la definición.
  const kind = kindEdit?.code === code ? kindEdit.value : definition?.defaultKind ?? "inspection"
  const activity = activityEdit?.code === code ? activityEdit.value : NO_ACTIVITY
  const gateInput = {
    needsOfficialSource: definition?.needsOfficialSource ?? false,
    officialChecksumSha256: definition?.officialChecksumSha256 ?? null,
    sources: documentSources,
  }
  // Un anexo oficial llega con su planilla elegida si la Biblioteca la tiene.
  const sourceVersionId = sourceEdit?.code === code ? sourceEdit.id : officialSourceGate({ ...gateInput, selectedId: "" }).preselectedId
  const gate = officialSourceGate({ ...gateInput, selectedId: sourceVersionId })

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const versionLabel = String(form.get("versionLabel") ?? "").trim()
    const sourceRevision = String(form.get("sourceRevision") ?? "").trim()
    operation.run(() => importInspectionTemplateAction({
      definitionCode: code,
      kind,
      versionLabel: versionLabel || undefined,
      sourceDocumentVersionId: sourceVersionId || undefined,
      sourceRevision: sourceRevision || undefined,
      // Sólo se manda cuando hay que desempatar. Omitirlo deja que el servicio
      // aplique el cableado por defecto, que es el caso de las nueve
      // definiciones con una sola actividad.
      ...(ambiguous && activity !== NO_ACTIVITY ? { pdtpActivityNumbers: [Number(activity)] } : {}),
    }), () => {
      toast.success("Plantilla incorporada como borrador.")
      changeOpen(false)
    })
  }

  // El diálogo sigue montado tras incorporar: parte de cero al abrir.
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button size="sm">Incorporar borrador</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Incorporar nueva versión como borrador</DialogTitle>
            <DialogDescription>
              Se crea como borrador: todavía no puede programarse ni ejecutarse. Para habilitarla, alguien con permiso de aprobación —puedes ser tú— la revisa y la aprueba.
            </DialogDescription>
          </DialogHeader>
          <Field label="Definición del catálogo SST">
            <Select value={code} onValueChange={setCode}><SelectTrigger aria-label="Definición del catálogo SST"><SelectValue /></SelectTrigger><SelectContent>{importable.map((item) => <SelectItem key={item.code} value={item.code}>{item.title}</SelectItem>)}</SelectContent></Select>
          </Field>
          {/* Combobox y no Select: la Biblioteca SST sembrada son 99+ versiones
              y en una lista desplegable sin buscar no se encuentra ninguna. El
              nombre del archivo viaja como `hint` para que también se pueda
              buscar por él, que suele ser lo que la persona recuerda. */}
          <Field
            label="Fuente documental de la Biblioteca SST"
            required={gate.required}
            hint={gate.required
              ? "Obligatoria: este instrumento transcribe un anexo oficial."
              : "Opcional: este instrumento no transcribe un anexo oficial."}
            error={operation.fieldError("sourceDocumentVersionId")}
          >
            <Combobox
              id="import-source-version"
              options={gate.candidates.map((source) => ({
                value: source.id,
                label: source.documentCode ?? source.documentTitle,
                hint: source.fileName,
              }))}
              value={sourceVersionId}
              onChange={(value) => setSourceEdit({ code, id: value })}
              placeholder="Buscar por código o nombre de archivo…"
              // Obligatoria no se puede dejar vacía: sin «limpiar», sólo se cambia de archivo.
              clearLabel={gate.required ? undefined : "Sin fuente vinculada"}
            />
          </Field>
          {gate.noMatch && (
            <Callout tone="warning">
              No hay en la Biblioteca SST una versión vigente con el checksum del anexo oficial. Súbela en Documentación; también puedes vincularla después con «Vincular fuente».
            </Callout>
          )}
          {sourceVersionId !== "" && <>
            <Field label="Revisión impresa"><Input name="sourceRevision" placeholder="Ej. Rev. 02" maxLength={120} /></Field>
            <p className="text-xs text-[var(--color-text-muted)]">La paridad con el anexo se declara después, desde «Declarar paridad» en el catálogo. Hasta entonces la plantilla no puede habilitarse.</p>
          </>}
          {definition && (
            <p className="text-xs text-[var(--color-text-subtle)]">
              {definition.sections} secciones · {definition.items} ítems · {coverageLabel(definition.coverage)}
              {definition.coverage.criticalityInert && " · sin gravedad por ítem, ningún hallazgo alcanzará criticidad alta."}
            </p>
          )}
          {/* Qué acredita en el programa anual. Una sola actividad se cablea
              sola; dos exigen elegir, porque la misma definición de EPP la
              ejecutan el JT (n=64) y el PRF (n=65) por separado. */}
          {definition && (definition.pdtpActivities.length === 1 && definition.pdtpActivities[0] ? (
            <p className="text-xs text-[var(--color-text-subtle)]">
              Acredita la actividad PDTP <span className="font-mono">N° {definition.pdtpActivities[0].n}</span> — {definition.pdtpActivities[0].name}.
            </p>
          ) : definition.pdtpActivities.length > 1 ? (
            // La misma definición de EPP la ejecutan el JT (n=64) y el PRF
            // (n=65) por separado: cablear las dos haría que un run de uno
            // cerrara la ocurrencia del otro, así que se elige una.
            <Field
              label="Actividad del PDTP que acredita"
              hint="Esta definición sirve a más de una; elige la del responsable que la va a ejecutar."
            >
              <Select value={activity} onValueChange={(value) => setActivityEdit({ code, value })}>
                <SelectTrigger aria-label="Actividad del PDTP que acredita"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ACTIVITY}>No acredita</SelectItem>
                  {definition.pdtpActivities.map((item) => (
                    <SelectItem key={item.n} value={String(item.n)}>N° {item.n} — {item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <p className="text-xs text-[var(--color-text-subtle)]">
              No acredita ninguna actividad del programa anual.
            </p>
          ))}
          {existing?.approved && (
            <Callout tone="info" className="text-xs">
              Ya hay una versión vigente de esta definición: <span className="font-mono">{existing.approved.versionLabel}</span>.
              El nuevo borrador no reemplaza esta versión. El reemplazo ocurre recién cuando se aprueba, después de revisar su contenido.
            </Callout>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo">
              <Select value={kind} onValueChange={(value) => setKindEdit({ code, value })}><SelectTrigger aria-label="Tipo de instrumento"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(INSPECTION_KIND_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
            </Field>
            <Field
              label="Etiqueta de versión"
              hint={existing?.latest
                ? `Ya existe ${existing.latest.versionLabel}; usa otra etiqueta.`
                : `Vacío = ${definition?.version ?? "versión de la definición"}.`}
              error={operation.fieldError("versionLabel")}
            >
              <Input name="versionLabel" maxLength={80} />
            </Field>
          </div>
          <OperationError operation={operation} />
          <FormDialogFooter submitLabel="Incorporar como borrador" pending={operation.pending} disabled={gate.blocked} onCancel={() => changeOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  )
}
