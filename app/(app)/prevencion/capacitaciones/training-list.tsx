"use client"

import * as React from "react"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Certificate, Plus } from "@phosphor-icons/react"
import type { WorkerTrainingAssignment, TrainingCourse } from "@/db/schema"
import { TrainingForm } from "./training-form"

interface WorkerSummary {
  firstName: string
  lastName: string
  rut: string | null
}

interface EnrichedExpired extends WorkerTrainingAssignment {
  worker: WorkerSummary | null
  course: { id: string; code: string; name: string } | null
}

interface Props {
  expired: EnrichedExpired[]
  courses: TrainingCourse[]
  canManage: boolean
}

export function TrainingList({ expired, courses, canManage }: Props) {
  const [showForm, setShowForm] = React.useState(false)
  const [filter] = React.useState<"" | "vencidas">(expired.length > 0 ? "vencidas" : "")

  const rows = React.useMemo(() => {
    if (filter === "vencidas") return expired
    return expired // por ahora solo gestionamos vencidas en esta vista
  }, [expired, filter])

  if (expired.length === 0 && !canManage) {
    return (
      <EmptyState
        icon={<Certificate size={28} />}
        title="Sin capacitaciones vencidas"
        description="No hay competencias vencidas en tu alcance para hoy."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={() => setShowForm((s) => !s)}>
            <Plus size={16} className="mr-1" />
            {showForm ? "Cancelar" : "Asignar capacitación"}
          </Button>
        </div>
      ) : null}

      {canManage && showForm ? (
        <TrainingForm courses={courses} onDone={() => setShowForm(false)} />
      ) : null}

      <section>
        <header className="mb-2 flex items-center justify-between">
          <h2 className="text-eyebrow">Capacitaciones vencidas</h2>
          <Badge variant="danger">{rows.length}</Badge>
        </header>
        <TableRoot>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trabajador</TableHead>
                <TableHead>Curso</TableHead>
                <TableHead>Realizada</TableHead>
                <TableHead>Vence</TableHead>
                <TableHead>Nota</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-[var(--color-text-subtle)]">
                    Sin capacitaciones vencidas.
                  </TableCell>
                </TableRow>
              ) : null}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {r.worker ? `${r.worker.firstName} ${r.worker.lastName}`.trim() : "—"}
                      </span>
                      {r.worker?.rut ? (
                        <span className="text-xs text-[var(--color-text-subtle)] font-mono">{r.worker.rut}</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-mono text-xs">{r.course?.code ?? "—"}</span>
                      <span>{r.course?.name ?? "Curso sin nombre"}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.completedAt}</TableCell>
                  <TableCell className="font-mono text-xs">{r.expiresAt ?? "—"}</TableCell>
                  <TableCell>{r.score ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableRoot>
      </section>

      {canManage ? (
        <section>
          <header className="mb-2">
            <h2 className="text-eyebrow">Catálogo de cursos</h2>
          </header>
          <TableRoot>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Vigencia</TableHead>
                  <TableHead>Cargos requeridos</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {courses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-[var(--color-text-subtle)]">
                      Sin cursos en el catálogo.
                    </TableCell>
                  </TableRow>
                ) : null}
                {courses.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.code}</TableCell>
                    <TableCell>{c.name}</TableCell>
                    <TableCell>{c.validityMonths ? `${c.validityMonths} meses` : "Sin vencimiento"}</TableCell>
                    <TableCell className="text-xs text-[var(--color-text-muted)]">
                      {(c.requiredForCargo as string[]).length > 0
                        ? (c.requiredForCargo as string[]).join(", ")
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.isActive ? "success" : "default"}>
                        {c.isActive ? "Activo" : "Inactivo"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
        </section>
      ) : null}
    </div>
  )
}