"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import type { TrainingCourse } from "@/db/schema"
import {
  createTrainingCourseAction,
  assignTrainingAction,
} from "./actions"

interface WorkerSummary {
  id: string
  firstName: string
  lastName: string
  rut: string | null
}

interface Props {
  courses: TrainingCourse[]
  workers?: WorkerSummary[]
  onDone?: () => void
}

type Mode = "create-course" | "assign"

export function TrainingForm({ courses, onDone }: Props) {
  const router = useRouter()
  const [mode, setMode] = React.useState<Mode>(courses.length === 0 ? "create-course" : "assign")
  const [submitting, setSubmitting] = React.useState(false)

  const [course, setCourse] = React.useState({ code: "", name: "", validityMonths: "12", requiredForCargo: "" })
  const [assign, setAssign] = React.useState({
    courseId: courses[0]?.id ?? "",
    workerId: "",
    worksiteId: "",
    completedAt: new Date().toISOString().slice(0, 10),
    expiresAt: "",
    score: "",
  })

  async function onSubmitCourse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!course.code || !course.name) {
      toast.error("Completa código y nombre del curso.")
      return
    }
    setSubmitting(true)
    const result = await createTrainingCourseAction({
      code: course.code,
      name: course.name,
      validityMonths: course.validityMonths ? Number(course.validityMonths) : undefined,
      requiredForCargo: course.requiredForCargo
        ? course.requiredForCargo.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
    })
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success("Curso creado.")
    setCourse({ code: "", name: "", validityMonths: "12", requiredForCargo: "" })
    router.refresh()
  }

  async function onSubmitAssign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!assign.courseId || !assign.workerId || !assign.worksiteId) {
      toast.error("Completa curso, trabajador y faena.")
      return
    }
    setSubmitting(true)
    const result = await assignTrainingAction({
      courseId: assign.courseId,
      workerId: assign.workerId,
      worksiteId: assign.worksiteId,
      completedAt: assign.completedAt,
      expiresAt: assign.expiresAt || undefined,
      score: assign.score ? Number(assign.score) : undefined,
    })
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success("Capacitación asignada.")
    onDone?.()
    router.refresh()
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <div className="mb-4 flex gap-2">
        <Button
          type="button"
          variant={mode === "assign" ? "primary" : "ghost"}
          onClick={() => setMode("assign")}
          disabled={courses.length === 0}
        >
          Asignar existente
        </Button>
        <Button
          type="button"
          variant={mode === "create-course" ? "primary" : "ghost"}
          onClick={() => setMode("create-course")}
        >
          Crear nuevo curso
        </Button>
      </div>

      {mode === "create-course" ? (
        <form onSubmit={onSubmitCourse}>
          <FieldGroup>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Código" htmlFor="tr-code" required>
                <Input
                  id="tr-code"
                  value={course.code}
                  onChange={(e) => setCourse((c) => ({ ...c, code: e.target.value }))}
                  required
                />
              </Field>
              <Field label="Nombre" htmlFor="tr-name" required>
                <Input
                  id="tr-name"
                  value={course.name}
                  onChange={(e) => setCourse((c) => ({ ...c, name: e.target.value }))}
                  required
                />
              </Field>
              <Field label="Vigencia (meses)" htmlFor="tr-validity">
                <Input
                  id="tr-validity"
                  type="number"
                  min={1}
                  value={course.validityMonths}
                  onChange={(e) => setCourse((c) => ({ ...c, validityMonths: e.target.value }))}
                />
              </Field>
              <Field label="Cargos requeridos (coma)" htmlFor="tr-cargos" helper="operador,conductor_ampliroll">
                <Input
                  id="tr-cargos"
                  value={course.requiredForCargo}
                  onChange={(e) => setCourse((c) => ({ ...c, requiredForCargo: e.target.value }))}
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Creando…" : "Crear curso"}
              </Button>
            </div>
          </FieldGroup>
        </form>
      ) : (
        <form onSubmit={onSubmitAssign}>
          <FieldGroup>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Curso" htmlFor="as-course" required>
                <Select value={assign.courseId} onValueChange={(v) => setAssign((a) => ({ ...a, courseId: v }))}>
                  <SelectTrigger id="as-course">
                    <SelectValue placeholder="Selecciona curso" />
                  </SelectTrigger>
                  <SelectContent>
                    {courses.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.code} · {c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="ID Trabajador" htmlFor="as-worker" required helper="Pega el ID del trabajador">
                <Input
                  id="as-worker"
                  value={assign.workerId}
                  onChange={(e) => setAssign((a) => ({ ...a, workerId: e.target.value }))}
                  required
                />
              </Field>
              <Field label="ID Faena" htmlFor="as-ws" required>
                <Input
                  id="as-ws"
                  value={assign.worksiteId}
                  onChange={(e) => setAssign((a) => ({ ...a, worksiteId: e.target.value }))}
                  required
                />
              </Field>
              <Field label="Realizada" htmlFor="as-done" required>
                <Input
                  id="as-done"
                  type="date"
                  value={assign.completedAt}
                  onChange={(e) => setAssign((a) => ({ ...a, completedAt: e.target.value }))}
                  required
                />
              </Field>
              <Field label="Vence" htmlFor="as-exp">
                <Input
                  id="as-exp"
                  type="date"
                  value={assign.expiresAt}
                  onChange={(e) => setAssign((a) => ({ ...a, expiresAt: e.target.value }))}
                />
              </Field>
              <Field label="Nota (0-100)" htmlFor="as-score">
                <Input
                  id="as-score"
                  type="number"
                  min={0}
                  max={100}
                  value={assign.score}
                  onChange={(e) => setAssign((a) => ({ ...a, score: e.target.value }))}
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              {onDone ? <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button> : null}
              <Button type="submit" disabled={submitting}>
                {submitting ? "Asignando…" : "Asignar capacitación"}
              </Button>
            </div>
          </FieldGroup>
        </form>
      )}
    </div>
  )
}