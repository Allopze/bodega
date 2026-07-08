"use client"

import * as React from "react"
import { useState } from "react"
import Link from "next/link"
import { DataTable } from "@/components/admin/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell } from "@/components/ui/table"
import { ResponsibleForm, type ResponsibleRow } from "./responsible-form"
import { SheetForm, type SheetRow } from "./sheet-form"

const RESP_COLUMNS = [
  { key: "displayName", label: "Nombre", sortable: true },
  { key: "roleName", label: "Rol", sortable: true, width: "w-44" },
  { key: "kind", label: "Tipo", sortable: true, width: "w-28" },
  { key: "notes", label: "Notas", sortable: true },
  { key: "", label: "", sortable: false, width: "w-20" },
]

const SHEET_COLUMNS = [
  { key: "code", label: "Código", sortable: true, width: "w-36" },
  { key: "label", label: "Etiqueta", sortable: true },
  { key: "area", label: "Área", sortable: true, width: "w-32" },
  { key: "programId", label: "Programa", sortable: true, width: "w-44" },
  { key: "scopeChips", label: "Alcance", sortable: false },
  { key: "", label: "", sortable: false, width: "w-20" },
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
  responsibles: ResponsibleRow[]
  sheets: SheetRow[]
  programs: ProgramSummary[]
}

const TABS = [
  { key: "responsibles", label: "Responsables" },
  { key: "sheets", label: "Hojas del programa" },
  { key: "programs", label: "Programas activos" },
] as const

export function CatalogTabs({ responsibles, sheets, programs }: CatalogTabsProps) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("responsibles")
  const [respSheetOpen, setRespSheetOpen] = useState(false)
  const [editResp, setEditResp] = useState<ResponsibleRow | null>(null)
  const [sheetSheetOpen, setSheetSheetOpen] = useState(false)
  const [editSheet, setEditSheet] = useState<SheetRow | null>(null)

  const respRows = responsibles as (ResponsibleRow & Record<string, unknown>)[]
  const sheetRows = sheets as (SheetRow & Record<string, unknown>)[]

  return (
    <>
      <div className="mb-4 flex gap-1 border-b border-[var(--color-border)]">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`relative -mb-px rounded-t-[var(--radius)] border border-b-0 px-4 py-2 text-sm transition-colors ${
              tab === t.key
                ? "border-[var(--color-border)] bg-[var(--color-surface)] font-semibold text-[var(--color-text)]"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "responsibles" && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">
              Responsables
            </h2>
            <Button size="sm" onClick={() => { setEditResp(null); setRespSheetOpen(true) }}>
              + Nuevo responsable
            </Button>
          </div>
          <DataTable
            columns={RESP_COLUMNS}
            rows={respRows}
            searchKeys={["displayName", "roleName", "kind", "notes"]}
            pageSize={20}
            emptyTitle="Sin responsables"
            emptyDescription="Crea el primer responsable del programa preventivo."
            emptyAction={
              <Button size="sm" onClick={() => { setEditResp(null); setRespSheetOpen(true) }}>
                + Nuevo responsable
              </Button>
            }
            renderRow={(row) => {
              const r = row as ResponsibleRow
              return (
                <React.Fragment key={r.slug}>
                  <TableRow>
                    <TableCell className="font-medium">{r.displayName}</TableCell>
                    <TableCell className="font-mono text-xs text-[var(--color-text-muted)]">
                      {r.roleName || "—"}
                    </TableCell>
                    <TableCell>{<Badge variant="default">{r.kind}</Badge>}</TableCell>
                    <TableCell className="text-xs text-[var(--color-text-muted)]">{r.notes || "—"}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => { setEditResp(r); setRespSheetOpen(true) }}
                        className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)]"
                        aria-label={`Editar ${r.displayName}`}
                      >
                        Editar
                      </button>
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              )
            }}
          />
          <ResponsibleForm
            key={editResp?.slug ?? "nuevo"}
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
            <Button size="sm" onClick={() => { setEditSheet(null); setSheetSheetOpen(true) }}>
              + Nueva hoja
            </Button>
          </div>
          <DataTable
            columns={SHEET_COLUMNS}
            rows={sheetRows}
            searchKeys={["code", "label", "area", "programId"]}
            pageSize={20}
            emptyTitle="Sin hojas"
            emptyDescription="Crea la primera hoja del programa preventivo."
            emptyAction={
              <Button size="sm" onClick={() => { setEditSheet(null); setSheetSheetOpen(true) }}>
                + Nueva hoja
              </Button>
            }
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
                            <Badge key={r} variant="default">{r}</Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => { setEditSheet(s); setSheetSheetOpen(true) }}
                        className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)]"
                        aria-label={`Editar ${s.code}`}
                      >
                        Editar
                      </button>
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              )
            }}
          />
          <SheetForm
            key={editSheet?.id ?? "nuevo"}
            open={sheetSheetOpen}
            onClose={() => setSheetSheetOpen(false)}
            editSheet={editSheet}
            programs={programs}
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

  function ProgramTable({ programs }: { programs: ProgramSummary[] }) {
    return (
      <DataTable
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
                <Badge variant={p.status === "active" ? "success" : p.status === "closed" ? "default" : "warning"}>
                  {p.status}
                </Badge>
              </TableCell>
            </TableRow>
          )
        }}
      />
    )
  }
}
