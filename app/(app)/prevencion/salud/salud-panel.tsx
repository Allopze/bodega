"use client"

import * as React from "react"
import { Heartbeat, Plus, Prohibit, Stethoscope } from "@phosphor-icons/react"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { Field } from "@/components/ui/field"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { toast } from "@/lib/toast"
import type { HealthExam, HealthRestriction, MinsalProtocol } from "@/db/schema"
import { getWorkerHealthDataAction } from "./actions"
import { HealthExamForm } from "./health-exam-form"
import { HealthAptitudeForm } from "./health-aptitude-form"
import { HealthRestrictionForm } from "./health-restriction-form"

interface WorkerOption {
  id: string
  name: string
  rut: string
}

interface Props {
  protocols: MinsalProtocol[]
  workers: WorkerOption[]
  canManage: boolean
  canRestrict: boolean
}

type FormKind = "exam" | "aptitude" | "restriction" | null

export function SaludPanel({ protocols, workers, canManage, canRestrict }: Props) {
  const [workerId, setWorkerId] = React.useState("")
  const [openForm, setOpenForm] = React.useState<FormKind>(null)
  const [loading, setLoading] = React.useState(false)
  const [exams, setExams] = React.useState<HealthExam[]>([])
  const [restrictions, setRestrictions] = React.useState<HealthRestriction[]>([])

  const loadWorkerData = React.useCallback(async (id: string) => {
    if (!id) {
      setExams([])
      setRestrictions([])
      return
    }
    setLoading(true)
    const result = await getWorkerHealthDataAction(id)
    setLoading(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    setExams(result.data?.exams ?? [])
    setRestrictions(result.data?.restrictions ?? [])
  }, [])

  React.useEffect(() => {
    loadWorkerData(workerId)
  }, [workerId, loadWorkerData])

  const selectedWorker = workers.find((w) => w.id === workerId) ?? null

  function handleDone() {
    setOpenForm(null)
    loadWorkerData(workerId)
  }

  return (
    <>
      <PageHeader
        title="Salud ocupacional"
        description="Exámenes, aptitudes, restricciones y protocolos MINSAL (N° 44-50 PDTP)"
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Prevención", href: "/prevencion" },
            { label: "Salud ocupacional" },
          ]} />
        }
      />

      <div className="rounded border border-(--color-border) bg-(--color-surface) p-4">
        <Field label="Trabajador" htmlFor="salud-worker">
          <Select value={workerId} onValueChange={setWorkerId} searchable>
            <SelectTrigger id="salud-worker">
              <SelectValue placeholder="Selecciona un trabajador" />
            </SelectTrigger>
            <SelectContent>
              {workers.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}{w.rut ? ` · ${w.rut}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {selectedWorker ? (
        <div className="flex flex-col gap-6">
          {restrictions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {restrictions.map((r) => (
                <Badge key={r.id} variant="danger">
                  <Prohibit size={12} /> {r.kind}
                </Badge>
              ))}
            </div>
          ) : null}

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Exámenes</h3>
              {canManage ? (
                <Button size="sm" variant="secondary" onClick={() => setOpenForm(openForm === "exam" ? null : "exam")}>
                  <Plus size={16} className="mr-1" />
                  {openForm === "exam" ? "Cancelar" : "Registrar examen"}
                </Button>
              ) : null}
            </div>
            {canManage && openForm === "exam" ? (
              <HealthExamForm workerId={selectedWorker.id} protocols={protocols} onDone={handleDone} />
            ) : null}
            {loading ? (
              <p className="text-sm text-(--color-text-subtle)">Cargando…</p>
            ) : exams.length === 0 ? (
              <EmptyState
                icon={<Stethoscope size={28} />}
                title="Sin exámenes registrados"
                description="Este trabajador no tiene exámenes ocupacionales registrados."
                compact
              />
            ) : (
              <TableRoot>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Realizado</TableHead>
                      <TableHead>Resultado</TableHead>
                      <TableHead>Vence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exams.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">{e.type}</TableCell>
                        <TableCell>{e.performedAt}</TableCell>
                        <TableCell>
                          <Badge variant={e.result === "apto" ? "success" : e.result === "pendiente" ? "default" : "warning"}>
                            {e.result}
                          </Badge>
                        </TableCell>
                        <TableCell>{e.expiresAt ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableRoot>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Aptitud laboral</h3>
              {canManage ? (
                <Button size="sm" variant="secondary" onClick={() => setOpenForm(openForm === "aptitude" ? null : "aptitude")}>
                  <Plus size={16} className="mr-1" />
                  {openForm === "aptitude" ? "Cancelar" : "Registrar aptitud"}
                </Button>
              ) : null}
            </div>
            {canManage && openForm === "aptitude" ? (
              <HealthAptitudeForm workerId={selectedWorker.id} exams={exams} onDone={handleDone} />
            ) : null}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Restricciones</h3>
              {canRestrict ? (
                <Button size="sm" variant="secondary" onClick={() => setOpenForm(openForm === "restriction" ? null : "restriction")}>
                  <Plus size={16} className="mr-1" />
                  {openForm === "restriction" ? "Cancelar" : "Registrar restricción"}
                </Button>
              ) : null}
            </div>
            {canRestrict && openForm === "restriction" ? (
              <HealthRestrictionForm workerId={selectedWorker.id} onDone={handleDone} />
            ) : null}
            {loading ? (
              <p className="text-sm text-(--color-text-subtle)">Cargando…</p>
            ) : restrictions.length === 0 ? (
              <EmptyState
                icon={<Prohibit size={28} />}
                title="Sin restricciones vigentes"
                description="Este trabajador no tiene restricciones de salud activas."
                compact
              />
            ) : (
              <TableRoot>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead>Desde</TableHead>
                      <TableHead>Hasta</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {restrictions.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.kind}</TableCell>
                        <TableCell className="text-(--color-text-subtle)">{r.description}</TableCell>
                        <TableCell>{r.effectiveFrom}</TableCell>
                        <TableCell>{r.effectiveTo ?? "Indefinida"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableRoot>
            )}
          </section>
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Protocolos MINSAL</h3>
        {protocols.length === 0 ? (
          <EmptyState
            icon={<Heartbeat size={28} />}
            title="Sin protocolos cargados"
            description="Ejecuta el seed de protocolos MINSAL para verlos aquí."
            compact
          />
        ) : (
          <TableRoot>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Marco legal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {protocols.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.code}</TableCell>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-xs text-(--color-text-subtle)">{p.legalFramework}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
        )}
      </section>
    </>
  )
}
