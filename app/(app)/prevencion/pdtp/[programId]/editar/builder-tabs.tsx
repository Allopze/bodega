"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  updatePdtpProgramAction,
  deletePdtpProgramAction,
  createPdtpSheetAction,
  deletePdtpSheetAction,
} from "../../actions"

import type { pdtpPrograms, pdtpSheets } from "@/db/schema"

const TABS = ["Metadatos", "Hojas", "Objetivos", "Actividades", "Planificación"] as const

type PdtpBuilderTabsProps = {
  program: typeof pdtpPrograms.$inferSelect
  sheets: Array<typeof pdtpSheets.$inferSelect>
  userId: string
  canDelete: boolean
}

export function PdtpBuilderTabs({ program, sheets, userId, canDelete }: PdtpBuilderTabsProps) {
  const [activeTab, setActiveTab] = React.useState<string>("Metadatos")

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-[var(--color-border)]">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "border-b-2 border-[var(--color-primary)] text-[var(--color-text)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Metadatos" && (
        <MetadataTab program={program} canDelete={canDelete} />
      )}
      {activeTab === "Hojas" && (
        <SheetsTab programId={program.id} sheets={sheets} userId={userId} />
      )}
      {activeTab === "Objetivos" && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-text-muted)]">
          El editor de objetivos estará disponible próximamente. Mientras tanto, puedes editar las actividades individualmente.
        </div>
      )}
      {activeTab === "Actividades" && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-text-muted)]">
          Usa la sección &ldquo;Agregar actividad&rdquo; en la vista del programa para añadir actividades.
        </div>
      )}
      {activeTab === "Planificación" && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-text-muted)]">
          El editor de planificación estará disponible próximamente. Por ahora, edita las cantidades planificadas desde la vista semanal del programa.
        </div>
      )}
    </div>
  )
}

function MetadataTab({ program, canDelete }: { program: typeof pdtpPrograms.$inferSelect; canDelete: boolean }) {
  const router = useRouter()
  const [updateState, updateAction, updatePending] = useActionState(updatePdtpProgramAction, null)
  const [deleteState, deleteAction, deletePending] = useActionState(deletePdtpProgramAction, null)

  if (updateState?.ok) {
    router.refresh()
  }

  if (deleteState?.ok) {
    router.push("/prevencion/pdtp")
  }

  return (
    <div className="space-y-6">
      <form action={updateAction} className="max-w-md space-y-4">
        <input type="hidden" name="programId" value={program.id} />

        <div>
          <label className="text-sm font-medium text-[var(--color-text)]">Título</label>
          <Input name="title" defaultValue={program.title} required className="mt-1" />
        </div>

        <div>
          <label className="text-sm font-medium text-[var(--color-text)]">Año</label>
          <Input name="year" value={program.year} disabled className="mt-1 bg-[var(--color-surface-2)]" />
        </div>

        <div>
          <label className="text-sm font-medium text-[var(--color-text)]">Meta de cumplimiento</label>
          <Input
            name="complianceTarget"
            type="number"
            step="0.01"
            min="0"
            max="1"
            defaultValue={program.complianceTarget}
            required
            className="mt-1"
          />
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Valor entre 0 y 1. Ej: 0.90 = 90% de cumplimiento esperado.
          </p>
        </div>

        {updateState?.message && !updateState.ok && (
          <p className="rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]">
            {updateState.message}
          </p>
        )}

        <Button type="submit" disabled={updatePending} size="sm">
          {updatePending ? "Guardando..." : "Guardar cambios"}
        </Button>
      </form>

      {canDelete && (
        <div className="max-w-md border-t border-[var(--color-border)] pt-6">
          <h3 className="mb-2 text-sm font-semibold text-[var(--color-danger)]">Zona de peligro</h3>
          <p className="mb-3 text-xs text-[var(--color-text-muted)]">
            Eliminar este programa borrará todas sus actividades y hojas asociadas. Esta acción no se puede deshacer.
          </p>
          <form action={deleteAction}>
            <input type="hidden" name="programId" value={program.id} />
            <Button type="submit" variant="destructive" size="sm" disabled={deletePending}>
              {deletePending ? "Eliminando..." : "Eliminar programa"}
            </Button>
          </form>
          {deleteState?.message && !deleteState.ok && (
            <p className="mt-2 rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]">
              {deleteState.message}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function SheetsTab({ programId, sheets, userId: _userId }: {
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
        <div>
          <label className="text-xs text-[var(--color-text-subtle)]">Código</label>
          <Input name="code" required className="mt-1 h-8" placeholder="mi_hoja" />
        </div>
        <div>
          <label className="text-xs text-[var(--color-text-subtle)]">Área</label>
          <Input name="area" required className="mt-1 h-8" placeholder="prevencion" />
        </div>
      </div>
      <div>
        <label className="text-xs text-[var(--color-text-subtle)]">Etiqueta</label>
        <Input name="label" required className="mt-1 h-8" placeholder="Mi hoja personalizada" />
      </div>
      {state?.message && !state.ok && (
        <p className="rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {state.message}
        </p>
      )}
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
