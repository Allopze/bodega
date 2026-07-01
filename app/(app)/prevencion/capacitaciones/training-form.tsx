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
  const [courseErrors, setCourseErrors] = React.useState<Record<string, string[] | undefined>>({})
  const [assign, setAssign] = React.useState({
    courseId: courses[0]?.id ?? "",
    workerId: "",
    worksiteId: "",
    completedAt: new Date().toISOString().slice(0, 10),
    expiresAt: "",
    score: "",
  })
  const [assignErrors, setAssignErrors] = React.useState<Record<string, string[] | undefined>>({})

  function resetError(setter: React.Dispatch<React.SetStateAction<Record<string, string[] | undefined>>>, field: string) {
    setter((prev) => {
      if (!prev[field]) return prev
      const { [field]: _drop, ...rest } = prev
      return rest
    })
  }

  function applyFieldErrors(setter: React.Dispatch<React.SetStateAction<Record<string, string[] | undefined>>>, fe: Record<string, string[] | undefined> | undefined) {
    if (!fe) return
    setter(fe)
    const firstField = Object.keys(fe)[0]
    const firstMsg = firstField ? fe[firstField]?.[0] : undefined
    toast.error(firstMsg ? `${firstField}: ${firstMsg}` : "Revisa los campos del formulario.")
  }

  async function onSubmitCourse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!course.code || !course.name) {
      toast.error("Completa código y nombre del curso.")
      return
    }
    setSubmitting(true)
    setCourseErrors({})
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
      applyFieldErrors(setCourseErrors, result.fieldErrors as Record<string, string[] | undefined> | undefined)
      if (!result.fieldErrors) toast.error(result.message ?? "Error al crear curso.")
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
    setAssignErrors({})
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
      applyFieldErrors(setAssignErrors, result.fieldErrors as Record<string, string[] | undefined> | undefined)
      if (!result.fieldErrors) toast.error(result.message ?? "Error al asignar capacitación.")
      return
    }
    toast.success("Capacitación asignada.")
    onDone?.()
    router.refresh()
  }

  const courseFe = (k: string) => courseErrors[k]?.[0]
  const assignFe = (k: string) => assignErrors[k]?.[0]

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
              <Field label="Código" htmlFor="tr-code" required error={courseFe("code")}>
                <Input
                  id="tr-code"
                  value={course.code}
                  onChange={(e) => { resetError(setCourseErrors, "code"); setCourse((c) => ({ ...c, code: e.target.value })) }}
                  aria-invalid={!!courseFe("code")}
                  required
                />
              </Field>
              <Field label="Nombre" htmlFor="tr-name" required error={courseFe("name")}>
                <Input
                  id="tr-name"
                  value={course.name}
                  onChange={(e) => { resetError(setCourseErrors, "name"); setCourse((c) => ({ ...c, name: e.target.value })) }}
                  aria-invalid={!!courseFe("name")}
                  required
                />
              </Field>
              <Field label="Vigencia (meses)" htmlFor="tr-validity" error={courseFe("validityMonths")}>
                <Input
                  id="tr-validity"
                  type="number"
                  min={1}
                  value={course.validityMonths}
                  onChange={(e) => { resetError(setCourseErrors, "validityMonths"); setCourse((c) => ({ ...c, validityMonths: e.target.value })) }}
                  aria-invalid={!!courseFe("validityMonths")}
                />
              </Field>
              <Field label="Cargos requeridos (coma)" htmlFor="tr-cargos" helper="operador,conductor_ampliroll" error={courseFe("requiredForCargo")}>
                <Input
                  id="tr-cargos"
                  value={course.requiredForCargo}
                  onChange={(e) => { resetError(setCourseErrors, "requiredForCargo"); setCourse((c) => ({ ...c, requiredForCargo: e.target.value })) }}
                  aria-invalid={!!courseFe("requiredForCargo")}
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
              <Field label="Curso" htmlFor="as-course" required error={assignFe("courseId")}>
                <Select value={assign.courseId} onValueChange={(v) => { resetError(setAssignErrors, "courseId"); setAssign((a) => ({ ...a, courseId: v })) }}>
                  <SelectTrigger id="as-course" aria-invalid={!!assignFe("courseId")}>
                    <SelectValue placeholder="Selecciona curso" />
                  </SelectTrigger>
                  <SelectContent>
                    {courses.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.code} · {c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="ID Trabajador" htmlFor="as-worker" required helper="Pega el ID del trabajador" error={assignFe("workerId")}>
                <Input
                  id="as-worker"
                  value={assign.workerId}
                  onChange={(e) => { resetError(setAssignErrors, "workerId"); setAssign((a) => ({ ...a, workerId: e.target.value })) }}
                  aria-invalid={!!assignFe("workerId")}
                  required
                />
              </Field>
              <Field label="ID Faena" htmlFor="as-ws" required error={assignFe("worksiteId")}>
                <Input
                  id="as-ws"
                  value={assign.worksiteId}
                  onChange={(e) => { resetError(setAssignErrors, "worksiteId"); setAssign((a) => ({ ...a, worksiteId: e.target.value })) }}
                  aria-invalid={!!assignFe("worksiteId")}
                  required
                />
              </Field>
              <Field label="Realizada" htmlFor="as-done" required error={assignFe("completedAt")}>
                <Input
                  id="as-done"
                  type="date"
                  value={assign.completedAt}
                  onChange={(e) => { resetError(setAssignErrors, "completedAt"); setAssign((a) => ({ ...a, completedAt: e.target.value })) }}
                  aria-invalid={!!assignFe("completedAt")}
                  required
                />
              </Field>
              <Field label="Vence" htmlFor="as-exp" error={assignFe("expiresAt")}>
                <Input
                  id="as-exp"
                  type="date"
                  value={assign.expiresAt}
                  onChange={(e) => { resetError(setAssignErrors, "expiresAt"); setAssign((a) => ({ ...a, expiresAt: e.target.value })) }}
                  aria-invalid={!!assignFe("expiresAt")}
                />
              </Field>
              <Field label="Nota (0-100)" htmlFor="as-score" error={assignFe("score")}>
                <Input
                  id="as-score"
                  type="number"
                  min={0}
                  max={100}
                  value={assign.score}
                  onChange={(e) => { resetError(setAssignErrors, "score"); setAssign((a) => ({ ...a, score: e.target.value })) }}
                  aria-invalid={!!assignFe("score")}
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