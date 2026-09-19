/**
 * lib/services/pdtp/instrument-gap.ts
 *
 * Qué instrumento le falta a una actividad, dicho de forma que se pueda actuar.
 *
 * La compuerta (`fulfillment.ts`) decide **si** una actividad tiene un problema
 * de instrumento. Este archivo decide **qué decir** y **a qué se puede
 * enlazar**, y es puro: recibe registros, devuelve datos. La separación existe
 * porque el mensaje cambia mucho más seguido que la clasificación, y mezclarlos
 * obligaba a levantar Postgres para probar una frase.
 *
 * Antes el motivo era uno solo para todas las actividades del grupo:
 *
 *   «Su número está declarado, pero su plantilla no tiene una versión aprobada
 *    o su curso no tiene ninguna versión publicada.»
 *
 * Ambiguo por construcción —el código no sabía cuál de los dos era— y repetido
 * literal en las catorce filas del informe. El operador no podía distinguir una
 * fila de otra ni saber a dónde ir; en prueba de usabilidad no resolvió
 * ninguna.
 *
 * **El array `instruments` es una disyunción.** `instrumentIssueFor` corta con
 * `if (usableGlobally.has(n)) return null`: aprobar **cualquiera** de los
 * instrumentos apaga el issue. Presentarlos como lista de tareas pediría el
 * doble de trabajo del necesario y, peor, dejaría tareas fantasma cuando la
 * fila desaparece tras la primera. La excepción está anidada a propósito:
 * dentro de un ref `emergency_plan`, `worksites` sí es una **conjunción** —
 * faltan tres faenas, hay que aprobar los tres planes—. La forma del tipo
 * codifica la asimetría, así que no se puede describir mal.
 */

import type { PdtpInstrumentRecord } from "./instruments"

/**
 * Un camino de resolución, tal como lo consume la UI.
 *
 * Es la proyección serializable de `PdtpInstrumentRecord`: sólo primitivos,
 * arrays y objetos literales. Nada de `Set`, `Map` ni `Date` — estos objetos
 * cruzan el borde RSC hacia componentes cliente.
 *
 * **Sin `href`.** Los enlaces se arman en la UI desde `kind` + `id`; meter
 * rutas acá acoplaría la capa de datos al routing y obligaría a verificar
 * strings de URL en tests con base de datos.
 */
export type PdtpCoverageInstrument =
  | {
      kind: "inspection_template"
      id: string
      code: string
      versionLabel: string
      name: string
      status: string
      /** Para que la UI degrade "Aprobar" a "Pedir que otro la apruebe": quien
       *  escribe una versión no la firma, salvo `prevention:sign_own_work`. */
      authorUserId: string | null
      blocker: "template_not_approved"
    }
  | {
      kind: "training_course"
      id: string
      code: string
      name: string
      minimumDurationMinutes: number
      latestVersion: {
        id: string
        versionLabel: string
        status: string
        durationMinutes: number
        authorUserId: string | null
      } | null
      blocker:
        | "course_has_no_version"
        | "course_version_not_published"
        | "course_version_below_minimum_duration"
    }
  | {
      kind: "emergency_plan"
      /** Una entrada por faena aplicable sin plan aprobado. Ya viene filtrada
       *  por las exclusiones de la actividad y por `PdtpCoverageScope`, que es
       *  lo que impide exponer nombres de faena fuera de los permisos. */
      worksites: Array<{
        id: string
        name: string
        planId: string | null
        planCode: string | null
        planStatus: string | null
        createdByUserId: string | null
        blocker: "plan_not_approved" | "plan_missing"
      }>
    }

const STATUS_LABELS: Record<string, string> = {
  draft: "borrador",
  in_review: "revisión",
  observed: "observada",
  approved: "aprobada",
  published: "publicada",
  superseded: "reemplazada",
  archived: "archivada",
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

/** Por qué este curso no es ejecutable. Son tres causas distintas que el
 *  mensaje viejo colapsaba en una: «no tiene ninguna versión publicada». */
function courseBlocker(
  record: Extract<PdtpInstrumentRecord, { kind: "training_course" }>,
): Extract<PdtpCoverageInstrument, { kind: "training_course" }>["blocker"] {
  if (!record.latestVersion) return "course_has_no_version"
  if (record.latestVersion.status !== "published") return "course_version_not_published"
  return "course_version_below_minimum_duration"
}

function describeTemplate(instrument: Extract<PdtpCoverageInstrument, { kind: "inspection_template" }>): string {
  return `La plantilla ${instrument.code} (${instrument.versionLabel}) está en ${statusLabel(instrument.status)} y sólo una aprobada se puede programar`
}

function describeCourse(instrument: Extract<PdtpCoverageInstrument, { kind: "training_course" }>): string {
  if (instrument.blocker === "course_has_no_version") {
    return `El curso ${instrument.code} no tiene ninguna versión creada`
  }
  if (instrument.blocker === "course_version_not_published") {
    const version = instrument.latestVersion!
    return `El curso ${instrument.code} tiene su versión ${version.versionLabel} en ${statusLabel(version.status)} y ninguna está publicada`
  }
  const version = instrument.latestVersion!
  return `La versión publicada del curso ${instrument.code} dura ${version.durationMinutes} min y el curso exige ${instrument.minimumDurationMinutes}`
}

function describeOne(instrument: PdtpCoverageInstrument): string {
  if (instrument.kind === "inspection_template") return describeTemplate(instrument)
  if (instrument.kind === "training_course") return describeCourse(instrument)
  const names = instrument.worksites.map((worksite) => worksite.name)
  return `Ninguna de estas faenas tiene un plan de emergencia aprobado: ${names.join(", ")}`
}

/** El nombre corto con que se menciona un instrumento dentro de una enumeración. */
function mentionOne(instrument: PdtpCoverageInstrument): string {
  if (instrument.kind === "inspection_template") {
    return `la plantilla ${instrument.code} (${statusLabel(instrument.status)})`
  }
  if (instrument.kind === "training_course") {
    if (instrument.blocker === "course_has_no_version") return `el curso ${instrument.code} (sin versiones)`
    if (instrument.blocker === "course_version_not_published") {
      return `el curso ${instrument.code} (${statusLabel(instrument.latestVersion!.status)}, sin publicar)`
    }
    return `el curso ${instrument.code} (publicado, bajo el mínimo)`
  }
  return `el plan de emergencia de ${instrument.worksites.length} faena${instrument.worksites.length === 1 ? "" : "s"}`
}

function enumerate(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ""
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`
}

export type PdtpInstrumentGap = {
  reason: string
  instruments: PdtpCoverageInstrument[]
}

/**
 * Proyecta los instrumentos no vigentes de un número a los caminos de
 * resolución accionables y al texto que los explica.
 *
 * `candidates` son los registros que declaran el número y **no** son
 * ejecutables. `missingWorksites` son las faenas aplicables sin instrumento por
 * faena vigente, ya filtradas por exclusiones y por el alcance de permisos;
 * viene por separado porque una faena puede faltar sin que exista ningún
 * registro suyo que listar (nadie creó el plan todavía).
 */
export function describePdtpInstrumentGap(input: {
  n: number
  candidates: PdtpInstrumentRecord[]
  missingWorksites: Array<{ id: string; name: string }>
  applicableWorksiteCount: number
}): PdtpInstrumentGap {
  const instruments: PdtpCoverageInstrument[] = []

  for (const candidate of input.candidates) {
    if (candidate.kind === "inspection_template") {
      instruments.push({
        kind: "inspection_template",
        id: candidate.id, code: candidate.code, versionLabel: candidate.versionLabel,
        name: candidate.name, status: candidate.status, authorUserId: candidate.authorUserId,
        blocker: "template_not_approved",
      })
    } else if (candidate.kind === "training_course") {
      instruments.push({
        kind: "training_course",
        id: candidate.id, code: candidate.code, name: candidate.name,
        minimumDurationMinutes: candidate.minimumDurationMinutes,
        latestVersion: candidate.latestVersion,
        blocker: courseBlocker(candidate),
      })
    }
    // Los planes no se proyectan uno a uno: se agrupan abajo por faena, porque
    // lo que el operador tiene que resolver es "faltan estas faenas", no
    // "existen estos tres registros".
  }

  if (input.missingWorksites.length > 0) {
    const planByWorksiteId = new Map(
      input.candidates
        .filter((candidate): candidate is Extract<PdtpInstrumentRecord, { kind: "emergency_plan" }> =>
          candidate.kind === "emergency_plan")
        .map((plan) => [plan.worksiteId, plan]),
    )
    instruments.push({
      kind: "emergency_plan",
      worksites: input.missingWorksites.map((worksite) => {
        const plan = planByWorksiteId.get(worksite.id)
        return {
          id: worksite.id,
          name: worksite.name,
          planId: plan?.id ?? null,
          planCode: plan?.code ?? null,
          planStatus: plan?.status ?? null,
          createdByUserId: plan?.createdByUserId ?? null,
          blocker: plan ? ("plan_not_approved" as const) : ("plan_missing" as const),
        }
      }),
    })
  }

  return { reason: buildReason(input, instruments), instruments }
}

function buildReason(
  input: { n: number; applicableWorksiteCount: number; missingWorksites: Array<{ name: string }> },
  instruments: PdtpCoverageInstrument[],
): string {
  /* Estructuralmente imposible: `instrumentIssueFor` sólo llega acá para
   * números que `wiringIssueFor` ya dio por declarados, así que siempre hay al
   * menos un candidato o una faena faltante. Se conserva el texto genérico como
   * defensa, no como caso de uso. */
  if (instruments.length === 0) {
    return "Su número está declarado, pero el instrumento que lo respalda no está vigente."
  }

  if (instruments.length === 1) {
    const only = instruments[0]!
    if (only.kind === "emergency_plan") {
      const names = only.worksites.map((worksite) => worksite.name).join(", ")
      // Se conserva la forma "N de M faenas" del mensaje anterior: nombra lo
      // que falta y cuánto del total es, que es lo que hace comparable el
      // problema entre actividades.
      return `Su plan de emergencia no está aprobado en ${only.worksites.length} de las ${input.applicableWorksiteCount} faenas donde aplica: ${names}.`
    }
    return `${describeOne(only)}.`
  }

  // Varios caminos alternativos: basta con uno. El texto lo dice para que nadie
  // los lea como checklist.
  const mentions = enumerate(instruments.map(mentionOne))
  return `Ninguno de los instrumentos que declaran el N°${input.n} está vigente: ${mentions}. Resolver cualquiera de ellos habilita la actividad.`
}
