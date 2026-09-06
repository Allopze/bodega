"use client"

import * as React from "react"
import { useActionState, useEffect, useState } from "react"
import Link from "next/link"
import { PencilSimple, ToggleLeft, ToggleRight } from "@phosphor-icons/react"
import { DataTable } from "@/components/ui/data-table"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { TableRow, TableCell } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/lib/toast"
import { INITIAL_STATE } from "@/lib/form-state"
import { togglePdtpResponsibleActiveAction, togglePdtpSheetActiveAction } from "./actions"
import { ResponsibleForm, type ResponsibleRow } from "./responsible-form"
import { SheetForm, type SheetRow } from "./sheet-form"

const RESP_COLUMNS = [
  { key: "displayName", label: "Nombre", sortable: true },
  { key: "roleName", label: "Rol", sortable: true, width: "w-44" },
  { key: "kind", label: "Tipo", sortable: true, width: "w-28" },
  { key: "notes", label: "Notas", sortable: true },
  { key: "isActive", label: "Estado", sortable: true, width: "w-28" },
  { key: "", label: "", sortable: false, width: "w-24" },
]

const SHEET_COLUMNS = [
  { key: "code", label: "Código", sortable: true, width: "w-36" },
  { key: "label", label: "Etiqueta", sortable: true },
  { key: "area", label: "Área", sortable: true, width: "w-32" },
  { key: "programId", label: "Programa", sortable: true, width: "w-44" },
  { key: "scopeChips", label: "Alcance", sortable: false },
  { key: "isActive", label: "Estado", sortable: true, width: "w-28" },
  { key: "", label: "", sortable: false, width: "w-24" },
]

export interface ProgramSummary {
  id: string
  year: number
  version: number
  status: string
  title: string
  href: string
}

interface CatalogTabsProps {
  roleOptions: string[]
  responsibles: ResponsibleRow[]
  sheets: SheetRow[]
  programs: ProgramSummary[]
}

const TABS = [
  { key: "responsibles", label: "Responsables" },
  { key: "sheets", label: "Hojas del programa" },
  { key: "programs", label: "Programas activos" },
] as const

export function CatalogTabs({ roleOptions, responsibles, sheets, programs }: CatalogTabsProps) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("responsibles")
  const [respSheetOpen, setRespSheetOpen] = useState(false)
  const [editResp, setEditResp] = useState<ResponsibleRow | null>(null)
  const [sheetSheetOpen, setSheetSheetOpen] = useState(false)
  const [editSheet, setEditSheet] = useState<SheetRow | null>(null)

  const [respToggleState, respToggleAction] = useActionState(togglePdtpResponsibleActiveAction, INITIAL_STATE)
  const [sheetToggleState, sheetToggleAction] = useActionState(togglePdtpSheetActiveAction, INITIAL_STATE)

  useEffect(() => {
    if (respToggleState.message) {
      (respToggleState.ok ? toast.success : toast.error).call(null, respToggleState.message)
    }
  }, [respToggleState])
  useEffect(() => {
    if (sheetToggleState.message) {
      (sheetToggleState.ok ? toast.success : toast.error).call(null, sheetToggleState.message)
    }
  }, [sheetToggleState])

  const respRows = responsibles as (ResponsibleRow & Record<string, unknown>)[]
  const sheetRows = sheets as (SheetRow & Record<string, unknown>)[]

  return (
    <>
      <Tabs value={tab} onValueChange={(value) => setTab(value as (typeof TABS)[number]["key"])} className="mb-4">
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab === "responsibles" && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">
              Responsables
            </h2>
          </div>
          <DataTable
            caption="Responsables del Programa Preventivo"
            columns={RESP_COLUMNS}
            rows={respRows}
            searchKeys={["displayName", "roleName", "kind", "notes"]}
            pageSize={20}
            emptyTitle="Sin responsables"
            emptyDescription="Crea el primer responsable del programa preventivo."
            renderMobileCard={(row) => {
              const r = row as ResponsibleRow
              return (
                <ResponsiveDataListCard
                  title={r.displayName}
                  status={r.isActive ? <MetaBadge meta={{ label: "Activo", variant: "success" }} /> : <MetaBadge meta={{ label: "Inactivo", variant: "default" }} />}
                  actions={
                    <>
                      <Button type="button" variant="ghost" size="sm" onClick={() => { setEditResp(r); setRespSheetOpen(true) }}><PencilSimple size={15} />Editar</Button>
                      <form action={respToggleAction}>
                        <input type="hidden" name="slug" value={r.slug} />
                        <input type="hidden" name="activate" value={String(!r.isActive)} />
                        <Button type="submit" variant="ghost" size="sm">
                          {r.isActive ? <ToggleRight size={17} /> : <ToggleLeft size={17} />}
                          {r.isActive ? "Desactivar" : "Reactivar"}
                        </Button>
                      </form>
                    </>
                  }
                >
                  <ResponsiveDataListField label="Rol">{r.roleName || "Sin rol"}</ResponsiveDataListField>
                  <ResponsiveDataListField label="Tipo"><MetaBadge meta={{ label: r.kind, variant: "default" }} /></ResponsiveDataListField>
                  <ResponsiveDataListField label="Notas" className="col-span-2">{r.notes || "Sin notas"}</ResponsiveDataListField>
                </ResponsiveDataListCard>
              )
            }}
            renderRow={(row) => {
              const r = row as ResponsibleRow
              return (
                <React.Fragment key={r.slug}>
                  <TableRow>
                    <TableCell className="font-medium">{r.displayName}</TableCell>
                    <TableCell className="font-mono text-xs text-[var(--color-text-muted)]">
                      {r.roleName || "—"}
                    </TableCell>
                    <TableCell>{<MetaBadge meta={{ label: r.kind, variant: "default" }} />}</TableCell>
                    <TableCell className="text-xs text-[var(--color-text-muted)]">{r.notes || "—"}</TableCell>
                    <TableCell>
                      {r.isActive
                        ? <MetaBadge meta={{ label: "Activo", variant: "success" }} />
                        : <MetaBadge meta={{ label: "Inactivo", variant: "default" }} />}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => { setEditResp(r); setRespSheetOpen(true) }}
                          className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                          aria-label={`Editar ${r.displayName}`}
                        >
                          <PencilSimple size={15} />
                        </button>
                        <form action={respToggleAction}>
                          <input type="hidden" name="slug" value={r.slug} />
                          <input type="hidden" name="activate" value={String(!r.isActive)} />
                          <button
                            type="submit"
                            className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                            aria-label={r.isActive ? `Desactivar ${r.displayName}` : `Reactivar ${r.displayName}`}
                          >
                            {r.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                          </button>
                        </form>
                      </div>
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              )
            }}
          />
          <ResponsibleForm
            key={editResp?.slug ?? "editar"}
            open={respSheetOpen}
            onClose={() => setRespSheetOpen(false)}
            editResponsible={editResp}
          />
        </section>
      )}

      {tab === "sheets" && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">
              Hojas del programa
            </h2>
          </div>
          <DataTable
            caption="Hojas del Programa Preventivo"
            columns={SHEET_COLUMNS}
            rows={sheetRows}
            searchKeys={["code", "label", "area", "programId"]}
            pageSize={20}
            emptyTitle="Sin hojas"
            emptyDescription="Crea la primera hoja del programa preventivo."
            renderMobileCard={(row) => {
              const s = row as SheetRow
              return (
                <ResponsiveDataListCard
                  title={s.label}
                  description={<span className="font-mono">{s.code}</span>}
                  status={s.isActive ? <MetaBadge meta={{ label: "Activa", variant: "success" }} /> : <MetaBadge meta={{ label: "Inactiva", variant: "default" }} />}
                  actions={
                    <>
                      <Button type="button" variant="ghost" size="sm" onClick={() => { setEditSheet(s); setSheetSheetOpen(true) }}><PencilSimple size={15} />Editar</Button>
                      <form action={sheetToggleAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="activate" value={String(!s.isActive)} />
                        <Button type="submit" variant="ghost" size="sm">
                          {s.isActive ? <ToggleRight size={17} /> : <ToggleLeft size={17} />}
                          {s.isActive ? "Desactivar" : "Reactivar"}
                        </Button>
                      </form>
                    </>
                  }
                >
                  <ResponsiveDataListField label="Área">{s.area}</ResponsiveDataListField>
                  <ResponsiveDataListField label="Programa"><span className="font-mono">{s.programId || "—"}</span></ResponsiveDataListField>
                  <ResponsiveDataListField label="Alcance" className="col-span-2">
                    {s.defaultScopeRoles.length === 0 ? "Sin roles predeterminados" : <span className="flex flex-wrap gap-1">{s.defaultScopeRoles.map((role) => <MetaBadge key={role} meta={{ label: `${role}`, variant: "default" }} />)}</span>}
                  </ResponsiveDataListField>
                </ResponsiveDataListCard>
              )
            }}
            renderRow={(row) => {
              const s = row as SheetRow
              return (
                <React.Fragment key={s.id}>
                  <TableRow>
                    <TableCell className="font-mono text-xs">{s.code}</TableCell>
                    <TableCell>{s.label}</TableCell>
                    <TableCell className="text-[var(--color-text-muted)]">{s.area}</TableCell>
                    <TableCell className="font-mono text-xs text-[var(--color-text-muted)]">
                      {s.programId || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {s.defaultScopeRoles.length === 0 ? (
                          <span className="text-xs text-[var(--color-text-muted)]">—</span>
                        ) : (
                          s.defaultScopeRoles.map((r) => (
                            <MetaBadge key={r} meta={{ label: `${r}`, variant: "default" }} />
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {s.isActive
                        ? <MetaBadge meta={{ label: "Activa", variant: "success" }} />
                        : <MetaBadge meta={{ label: "Inactiva", variant: "default" }} />}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => { setEditSheet(s); setSheetSheetOpen(true) }}
                          className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                          aria-label={`Editar ${s.code}`}
                        >
                          <PencilSimple size={15} />
                        </button>
                        <form action={sheetToggleAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="activate" value={String(!s.isActive)} />
                          <button
                            type="submit"
                            className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                            aria-label={s.isActive ? `Desactivar ${s.code}` : `Reactivar ${s.code}`}
                          >
                            {s.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                          </button>
                        </form>
                      </div>
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              )
            }}
          />
          <SheetForm
            key={editSheet?.id ?? "editar"}
            open={sheetSheetOpen}
            onClose={() => setSheetSheetOpen(false)}
            editSheet={editSheet}
            programs={programs}
            roleOptions={roleOptions}
          />
        </section>
      )}

      {tab === "programs" && (
        <section>
          <div className="mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">
              Programas activos y recientes
            </h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              Solo lectura. Para editar un programa, sigue el enlace a la vista operacional.
            </p>
          </div>
          <ProgramTable programs={programs} />
        </section>
      )}
    </>
  )

}

function ProgramTable({ programs }: { programs: ProgramSummary[] }) {
  return (
    <DataTable
      caption="Programas Activos y Recientes"
      columns={[
        { key: "title", label: "Título", sortable: true },
        { key: "year", label: "Año", sortable: true, numeric: true, width: "w-20" },
        { key: "version", label: "Versión", sortable: true, numeric: true, width: "w-24" },
        { key: "status", label: "Estado", sortable: true, width: "w-28" },
      ]}
      rows={programs as (ProgramSummary & Record<string, unknown>)[]}
      searchKeys={["title", "id", "status"]}
      pageSize={20}
      emptyTitle="Sin programas"
      emptyDescription="Los programas PDTP aparecerán aquí una vez creados."
      renderMobileCard={(row) => {
        const p = row as ProgramSummary
        return (
          <ResponsiveDataListCard
            title={<Link href={p.href} className="hover:underline">{p.title}</Link>}
            status={<MetaBadge meta={{ label: `${p.status}`, variant: p.status === "active" ? "success" : p.status === "closed" ? "default" : "warning" }} />}
            actions={<Button asChild type="button" variant="ghost" size="sm"><Link href={p.href}>Ver programa</Link></Button>}
          >
            <ResponsiveDataListField label="Año"><span className="font-mono tabular-nums text-[var(--color-text)]">{p.year}</span></ResponsiveDataListField>
            <ResponsiveDataListField label="Versión"><span className="font-mono tabular-nums text-[var(--color-text)]">{p.version}</span></ResponsiveDataListField>
          </ResponsiveDataListCard>
        )
      }}
      renderRow={(row) => {
        const p = row as ProgramSummary
        return (
          <TableRow>
            <TableCell>
              <Link href={p.href} className="font-medium text-[var(--color-primary)] hover:underline">
                {p.title}
              </Link>
            </TableCell>
            <TableCell className="text-right">{p.year}</TableCell>
            <TableCell className="text-right">{p.version}</TableCell>
            <TableCell>
              <MetaBadge meta={{ label: `${p.status}`, variant: p.status === "active" ? "success" : p.status === "closed" ? "default" : "warning" }} />
            </TableCell>
          </TableRow>
        )
      }}
    />
  )
}
