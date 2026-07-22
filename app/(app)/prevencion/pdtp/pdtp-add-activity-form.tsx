"use client"

import * as React from "react"
import { ListChecks, Plus, Trash, Users } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { addPdtpActivityFormAction } from "./actions"

type ResponsibleOption = { slug: string; displayName: string }
type SheetOption = { code: string; label: string }

/**
 * H-M2: form de "agregar actividad" como Client Component con
 * `useFieldArray`-like pattern (estado local). Permite al usuario
 * agregar N responsables y N hojas, no solo 1. Envía los valores
 * como `responsibleSlugs[]` y `sheetCodes[]` (array notation) que
 * la Server Action lee con `fd.getAll()`.
 *
 * Responsables y hojas se eligen de un Select poblado desde el catálogo
 * (antes eran `Input` de texto libre: el usuario tenía que escribir el
 * slug/code interno a mano). Si el catálogo viene vacío (programa nuevo
 * que nunca importó un Excel), cae a texto libre para no bloquear el uso.
 */
export function PdtpAddActivityForm({
  programId,
  hoja,
  faena,
  defaultObjectiveOrder = 1,
  errorMessage,
  responsibleCatalog = [],
  sheetOptions = [],
}: {
  programId: string
  hoja: string
  faena: string
  defaultObjectiveOrder?: number
  errorMessage?: string
  responsibleCatalog?: ResponsibleOption[]
  sheetOptions?: SheetOption[]
}) {
  const [responsibleSlugs, setResponsibleSlugs] = React.useState<string[]>([responsibleCatalog[0]?.slug ?? "prf"])
  const [sheetCodes, setSheetCodes] = React.useState<string[]>([sheetOptions[0]?.code ?? "pdtp_general"])

  const addResp = () => setResponsibleSlugs((s) => [...s, responsibleCatalog[0]?.slug ?? ""])
  const removeResp = (i: number) =>
    setResponsibleSlugs((s) => s.filter((_, idx) => idx !== i))
  const updateResp = (i: number, v: string) =>
    setResponsibleSlugs((s) => s.map((x, idx) => (idx === i ? v : x)))

  const addSheet = () => setSheetCodes((s) => [...s, sheetOptions[0]?.code ?? ""])
  const removeSheet = (i: number) =>
    setSheetCodes((s) => s.filter((_, idx) => idx !== i))
  const updateSheet = (i: number, v: string) =>
    setSheetCodes((s) => s.map((x, idx) => (idx === i ? v : x)))

  return (
    <div className="overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
      {/* Header */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--color-primary-tint)] text-[var(--color-primary)]">
            <Plus size={18} weight="bold" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">Agregar actividad</p>
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
              Define la actividad, su objetivo y los responsables asignados.
            </p>
          </div>
        </div>
      </div>

      <form action={addPdtpActivityFormAction}>
        <input type="hidden" name="programId" value={programId} />
        <input type="hidden" name="hoja" value={hoja} />
        <input type="hidden" name="faena" value={faena} />

        <FieldGroup className="gap-5 p-5 sm:p-6">
          {errorMessage && (
            <p
              role="alert"
              className="rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]"
            >
              {errorMessage}
            </p>
          )}

          {/* ── Section: Definición de la actividad ── */}
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3 sm:p-4">
            <div className="mb-3 flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--color-primary-tint)] text-[var(--color-primary)]">
                <ListChecks size={18} weight="bold" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-[var(--color-text)]">Definición de la actividad</p>
                <p className="mt-0.5 text-xs leading-5 text-text-subtle">
                  Describe la actividad preventiva y asígnala a un objetivo del programa.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Orden del objetivo" htmlFor="pdtp-ao" required>
                <Input
                  id="pdtp-ao"
                  name="objectiveOrder"
                  type="number"
                  min="1"
                  max="999"
                  defaultValue={defaultObjectiveOrder}
                  required
                />
              </Field>

              <Field label="Objetivo" htmlFor="pdtp-act-obj" required>
                <Input id="pdtp-act-obj" name="objective" required placeholder="Ej: Reducir riesgos laborales" />
              </Field>

              <div className="sm:col-span-2">
                <Field label="Actividad preventiva" htmlFor="pdtp-act-desc" required>
                  <Textarea id="pdtp-act-desc" name="activity" required rows={4} maxLength={4000} placeholder="Describe la actividad preventiva a realizar" />
                </Field>
              </div>

              <Field label="Guía de ejecución" htmlFor="pdtp-act-prog" required>
                <Textarea id="pdtp-act-prog" name="program" required rows={3} maxLength={2000} placeholder="Ej.: inspeccionar, registrar hallazgos y definir acciones" />
              </Field>

              <Field label="Responsable (nombre)" htmlFor="pdtp-act-rname" required>
                <Input id="pdtp-act-rname" name="responsibleDisplay" required placeholder="PRF" />
              </Field>
            </div>
          </div>

          {/* ── Section: Responsables y hojas ── */}
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3 sm:p-4">
            <div className="mb-3 flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--color-primary-tint)] text-[var(--color-primary)]">
                <Users size={18} weight="bold" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-[var(--color-text)]">Responsables y hojas</p>
                <p className="mt-0.5 text-xs leading-5 text-text-subtle">
                  Asigna roles RBAC y hojas oficiales del catálogo PDTP.
                </p>
              </div>
            </div>

            <FieldGroup className="gap-4">
              {/* ── Responsables ── */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-sm font-medium text-[var(--color-text)]">Responsables (slugs RBAC)</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={addResp}
                    aria-label="Agregar responsable"
                  >
                    <Plus size={12} className="mr-1" />
                    Agregar
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {responsibleSlugs.map((slug, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      {responsibleCatalog.length > 0 ? (
                        <Select name="responsibleSlugs[]" value={slug} onValueChange={(v) => updateResp(i, v)}>
                          <SelectTrigger className="h-8 flex-1 text-sm">
                            <SelectValue placeholder="Responsable" />
                          </SelectTrigger>
                          <SelectContent>
                            {responsibleCatalog.map((r) => (
                              <SelectItem key={r.slug} value={r.slug}>{r.displayName}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          name="responsibleSlugs[]"
                          value={slug}
                          onChange={(e) => updateResp(i, e.target.value)}
                          placeholder="prf, jt, jdpr, ..."
                          required
                          className="h-8 flex-1"
                        />
                      )}
                      {responsibleSlugs.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeResp(i)}
                          aria-label={`Quitar responsable ${i + 1}`}
                        >
                          <Trash size={12} />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Hojas ── */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-sm font-medium text-[var(--color-text)]">Hojas oficiales</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={addSheet}
                    aria-label="Agregar hoja"
                  >
                    <Plus size={12} className="mr-1" />
                    Agregar
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {sheetCodes.map((code, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      {sheetOptions.length > 0 ? (
                        <Select name="sheetCodes[]" value={code} onValueChange={(v) => updateSheet(i, v)}>
                          <SelectTrigger className="h-8 flex-1 text-sm">
                            <SelectValue placeholder="Hoja" />
                          </SelectTrigger>
                          <SelectContent>
                            {sheetOptions.map((s) => (
                              <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          name="sheetCodes[]"
                          value={code}
                          onChange={(e) => updateSheet(i, e.target.value)}
                          placeholder="pdtp_general, cphs, ..."
                          required
                          className="h-8 flex-1"
                        />
                      )}
                      {sheetCodes.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeSheet(i)}
                          aria-label={`Quitar hoja ${i + 1}`}
                        >
                          <Trash size={12} />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </FieldGroup>
          </div>

          {/* Submit */}
          <div className="flex justify-end border-t border-[var(--color-border)] pt-5">
            <Button type="submit" size="sm">
              Agregar actividad
            </Button>
          </div>
        </FieldGroup>
      </form>
    </div>
  )
}
