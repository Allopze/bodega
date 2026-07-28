"use client"

import * as React from "react"
import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { createPdtpSheetAction, deletePdtpSheetAction } from "../../../actions"

import type { pdtpSheets } from "@/db/schema"


export function SheetsTab({ programId, sheets, userId: _userId }: {
  programId: string
  sheets: Array<typeof pdtpSheets.$inferSelect>
  userId: string
}) {
  const programSheets = sheets.filter((s) => s.programId === programId)
  const templateSheets = sheets.filter((s) => s.programId === null)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Hojas del programa ({programSheets.length})</h3>
        {programSheets.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            No hay hojas custom en este programa. Las hojas plantilla están disponibles automáticamente.
          </p>
        ) : (
          <ul className="space-y-1">
            {programSheets.map((sheet) => (
              <li key={sheet.id} className="flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
                <div>
                  <span className="font-medium text-[var(--color-text)]">{sheet.label}</span>
                  <span className="ml-2 text-xs text-[var(--color-text-muted)]">{sheet.code}</span>
                </div>
                <DeleteSheetButton sheetId={sheet.id} programId={programId} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Hojas plantilla disponibles ({templateSheets.length})</h3>
        <ul className="space-y-1">
          {templateSheets.map((sheet) => (
            <li key={sheet.id} className="flex items-center rounded border border-[var(--color-border)]/50 bg-[var(--color-surface)]/50 px-3 py-2 text-sm">
              <span className="font-medium text-[var(--color-text)]">{sheet.label}</span>
              <span className="ml-2 text-xs text-[var(--color-text-muted)]">{sheet.code} (plantilla)</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="max-w-md border-t border-[var(--color-border)] pt-6">
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Crear hoja custom</h3>
        <CreateSheetForm programId={programId} />
      </div>
    </div>
  )
}

function CreateSheetForm({ programId }: { programId: string }) {
  const [state, formAction, pending] = useActionState(createPdtpSheetAction, null)

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="programId" value={programId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Código" htmlFor="sheet-code" required>
          <Input id="sheet-code" name="code" required placeholder="mi_hoja" />
        </Field>
        <Field label="Área" htmlFor="sheet-area" required>
          <Input id="sheet-area" name="area" required placeholder="prevencion" />
        </Field>
      </div>
      <Field label="Etiqueta" htmlFor="sheet-label" required error={state?.message && !state.ok ? state.message : undefined}>
        <Input id="sheet-label" name="label" required placeholder="Mi hoja personalizada" />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Creando..." : "Crear hoja"}
      </Button>
    </form>
  )
}

function DeleteSheetButton({ sheetId, programId }: { sheetId: string; programId: string }) {
  const [_state, formAction, pending] = useActionState(deletePdtpSheetAction, null)

  return (
    <form action={formAction}>
      <input type="hidden" name="sheetId" value={sheetId} />
      <input type="hidden" name="programId" value={programId} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        Eliminar
      </Button>
    </form>
  )
}

// para poder reutilizarlos desde la página de detalle del programa, donde el
// botón de importación es realmente visible (la página de edición los sigue
// usando aquí mismo, bajo "Vistas avanzadas y migración desde Excel").

// ── Tab Actividades: edición inline, reordenamiento, eliminación ───────────
