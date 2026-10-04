"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/ui/data-table"
import { TableCell, TableRow } from "@/components/ui/table"
import { countOf } from "@/lib/utils"
import { useOperation } from "@/lib/hooks/use-operation"
import { saveRiskFactorAction, setRiskFactorActiveAction } from "../actions"

/** Misma forma que `listRiskFactors()`; el `usageCount` es lo que permite
 *  advertir antes de desactivar un factor que todavía clasifica filas del RE-04. */
type Factor = { id: string; code: string; name: string; sortOrder: number; isActive: boolean; usageCount: number }

export function RiskFactorsAdmin({ factors }: { factors: Factor[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<Factor | "new" | null>(null)
  // El catálogo se recarga desde el servidor: los conteos de uso cambian con la
  // matriz, y `router.refresh()` los vuelve a leer sin recargar la página.
  const operation = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })
  const current = editing && editing !== "new" ? editing : null

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => saveRiskFactorAction({
      id: current?.id,
      code: String(form.get("code") ?? ""),
      name: String(form.get("name") ?? ""),
      sortOrder: String(form.get("sortOrder") ?? ""),
    }), () => setEditing(null))
  }

  return (
    <PageContainer width="form">
      <PageHeader
        title="Factores de riesgo"
        description="Administra las categorías con que se identifican los peligros. Desactivar una categoría conserva los riesgos que ya la utilizan."
        breadcrumb={<Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "MIPER", href: "/prevencion/miper" }, { label: "Factores de riesgo" }]} />}
        actions={<Button onClick={() => setEditing("new")}>Nuevo factor</Button>}
      />
      <DataTable
        caption="Factores de riesgo"
        columns={[
          { key: "sortOrder", label: "Orden", numeric: true },
          { key: "name", label: "Factor" },
          { key: "code", label: "Código" },
          { key: "usageCount", label: "En uso", numeric: true },
          { key: "isActive", label: "Estado" },
          { key: "actions", label: "" },
        ]}
        rows={factors}
        searchKeys={["name", "code"]}
        emptyTitle="Sin factores de riesgo"
        emptyDescription="Crea el primer factor para poder clasificar los peligros del RE-04."
        emptyAction={<Button size="sm" onClick={() => setEditing("new")}>Nuevo factor</Button>}
        renderRow={(factor) => (
          <TableRow key={factor.id}>
            <TableCell className="tabular-nums">{factor.sortOrder}</TableCell>
            <TableCell>{factor.name}</TableCell>
            <TableCell className="font-mono text-xs">{factor.code}</TableCell>
            <TableCell className="tabular-nums">{factor.usageCount}</TableCell>
            <TableCell>{factor.isActive ? "Activo" : "Desactivado"}</TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setEditing(factor)}>Editar</Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={operation.pending}
                aria-describedby={factor.usageCount > 0 && factor.isActive ? `factor-use-${factor.id}` : undefined}
                onClick={() => operation.run(() => setRiskFactorActiveAction({ id: factor.id, isActive: !factor.isActive }))}
              >
                {factor.isActive ? "Desactivar" : "Reactivar"}
              </Button>
              </div>
              {factor.usageCount > 0 && factor.isActive && <p id={`factor-use-${factor.id}`} className="mt-2 max-w-xs text-left text-xs text-[var(--color-text-muted)]">En uso en {countOf(factor.usageCount, "riesgo")}. Desactivar impide elegirlo en nuevos registros; los existentes se conservan.</p>}
            </TableCell>
          </TableRow>
        )}
      />
      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null) }}>
        <DialogContent>
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{current ? `Editar ${current.name}` : "Nuevo factor de riesgo"}</DialogTitle>
              <DialogDescription>El nombre aparece tal cual en la columna de factores del RE-04; el código es su identificador estable.</DialogDescription>
            </DialogHeader>
            <Field label="Nombre" required><Input name="name" defaultValue={current?.name ?? ""} required minLength={2} /></Field>
            <Field label="Código" required helper="Minúsculas, números y guion bajo."><Input name="code" defaultValue={current?.code ?? ""} required minLength={2} pattern="[a-z0-9_]+" /></Field>
            <Field label="Orden" required helper="Menor número, más arriba en la lista."><Input name="sortOrder" type="number" min={0} max={10000} defaultValue={current?.sortOrder ?? 200} required /></Field>
            {operation.message && <p role="status" className="text-sm text-[var(--color-danger-ink)]">{operation.message}</p>}
            <DialogFooter><Button type="submit" disabled={operation.pending}>Guardar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
