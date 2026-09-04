/**
 * lib/prevention/inspection-wiring.ts
 *
 * El catálogo de instrumentos del programa 2026 y el detector de su cableado.
 *
 * Vive acá y no junto al instalador por una razón concreta: el catálogo de
 * inspecciones es un componente cliente y el instalador importa `@/db` y
 * `node:crypto`. Arrastrarlos al bundle del navegador es el mismo defecto que
 * `client-server-boundary.test.ts` vino a impedir. Todo lo que la pantalla
 * necesita es puro, así que puro se queda.
 */

export type InspectionTemplateSpec = {
  /**
   * Actividad —o actividades— que esta plantilla acredita al declararse
   * ejecutada. `null` para los instrumentos que no acreditan ninguna —la
   * auditoría del SGSST vive fuera del programa anual— pero que igual deben
   * quedar instalados: la promesa es que el catálogo llegue completo, sin que
   * nadie incorpore nada a mano.
   *
   * Admite varias porque un mismo acto puede cerrar más de una obligación del
   * programa: transcribir el reporte de equipos acredita a la vez que el
   * operador lo llenó (n=25) y que el supervisor lo revisó y firmó (n=26).
   */
  n: number | number[] | null
  /** Clave en `CHECKLIST_DEFINITIONS`. */
  definitionCode: string
  /** Nombre visible. Distingue las dos plantillas que comparten definición. */
  name: string
  kind: "inspection" | "observation" | "audit"
  /**
   * Sufijo del `versionLabel`. Sólo lo necesitan las plantillas que comparten
   * `code` con otra: (code, versionLabel) es único, y las actividades 64 y 65
   * son la misma definición de EPP ejecutada por dos responsables distintos.
   * Se mantienen separadas a propósito — ver D3: cada responsable tiene su
   * propia ocurrencia, así que un run del JT no puede cerrar la del PRF.
   */
  versionSuffix?: string
  /**
   * Actividad que acredita al REVISARSE la inspección, no al ejecutarse.
   *
   * El programa separa el acto de llenar el instrumento del de revisarlo y
   * firmarlo, y les pone responsables distintos: la n=25 la hace el operador,
   * la n=26 la firma el Sup/JT. Ambas declaran "la cantidad será de acuerdo a
   * la cantidad de equipos", así que son por reporte y el motor puede
   * acreditarlas una a una.
   */
  reviewN?: number
  /**
   * Quién es el ejecutante de registro. Sólo el report de uso diario lo cambia:
   * lo ejecuta el operador en papel y el jefe de terreno lo transcribe, así que
   * el candado de independencia no debe impedirle firmar. Decisión D04 del
   * 2026-09-02; el detalle está en el comentario del campo en el esquema.
   */
  executorOfRecord?: "platform_user" | "declared_in_form"
}

export const PDTP_2026_INSPECTION_SPECS: readonly InspectionTemplateSpec[] = [
  // Sin anexo/formulario fuente del cliente: el contenido se escribió directo
  // desde la Ley 21.512 (ex DS 594). Antes constancia por falta de checklist
  // (D11, 2026-09-02); mover el número a ENGANCHE en
  // `apply-pdtp-2026-mechanisms.ts` es parte del mismo cambio.
  { n: 10, definitionCode: "inspeccion_condiciones_ambientales", name: "Verificación de Condiciones Ambientales Básicas (DS 594)", kind: "inspection" },
  { n: 24, definitionCode: "inspeccion_extintores",     name: "Inspección de Estado de Extintores",              kind: "inspection" },
  /* n=25 y n=26 en el mismo acto, por decisión de Prevención (2026-08-23): el
   * operador llena el reporte en papel y el administrador de contrato o el
   * supervisor de faena lo transcribe **bajo el nombre de quien lo hizo** —el
   * formulario tiene `operador_entrante` como campo obligatorio justamente
   * porque los conductores no tienen cuenta—. Transcribirlo línea por línea ES
   * revisarlo y firmarlo, así que la n=26 acredita al declarar ejecutada y no
   * en un segundo paso.
   *
   * El mecanismo de acreditar al revisar (`reviewN`) sigue existiendo para
   * cuando una actividad sí exija a una segunda persona; acá no aplica.
   */
  // La n=28 ("Revisar y cierra las inspecciones de estado de equipos") queda
  // fuera a propósito y NO es un olvido: la planilla la describe como "revisar
  // las inspecciones una vez sean recibidas, para ver si los temas mencionados
  // se levantaron para cierre, en reunión semanal". Es un acto semanal sobre el
  // CONJUNTO recibido y sobre el cierre de los hallazgos, no sobre una
  // inspección. Acreditarla por run haría que una semana con doce inspecciones
  // reportara doce cumplimientos de una actividad planificada como uno.
  { n: [25, 26], definitionCode: "reporte_equipos",      name: "Reporte de Uso Diario de Equipos",                kind: "inspection", executorOfRecord: "declared_in_form" },
  { n: 27, definitionCode: "inspeccion_taller",         name: "Inspección Taller de Mantención y Bodega RESPEL", kind: "inspection" },
  { n: 29, definitionCode: "inspeccion_contenedores",   name: "Inspección de Contenedores",                      kind: "inspection" },
  { n: 33, definitionCode: "inspeccion_equipos_moviles", name: "Inspección de Equipos Móviles",                  kind: "inspection" },
  { n: 34, definitionCode: "inspeccion_carros",         name: "Inspección de Carros",                            kind: "inspection" },
  /* Las tres actividades que no son un checklist: se registran como "se hizo"
   * más las desviaciones encontradas, tomadas del catálogo de cada instrumento.
   * Antes se acreditaban a mano porque el motor sólo sabía derivar hallazgos de
   * un ítem marcado "no cumple".
   *
   * La n=40 y la n=41 estaban cableadas al ampliroll y a maquinaria pesada, que
   * son observaciones **conductuales por operador** — la descripción de la n=39,
   * no de ellas. Quedaron ahí porque el formulario propio de la n=39 (Anexo 7)
   * fue excluido del motor por no tener ítems puntuables, así que los dos
   * formularios que sí existían se estacionaron en los números vecinos que
   * estaban vacíos. Se sueltan: ninguna de las dos era su actividad. */
  { n: 39, definitionCode: "observacion_planeada",     name: "Observación planeada (Anexo 7)",                  kind: "observation" },
  { n: 40, definitionCode: "inspeccion_area",           name: "Inspección de área de trabajo",                   kind: "inspection" },
  { n: 41, definitionCode: "caminata_seguridad",        name: "Caminata de seguridad",                           kind: "inspection" },
  /* Los dos formularios conductuales por operador (PR-SGC-24 y PR-SGC-25) se
   * siguen instalando, pero SIN actividad: son instrumentos reales y alguien
   * puede querer ejecutarlos, sólo que ninguno de los dos era la n=40 ni la
   * n=41. Si corresponden a la n=39 —que es la observación de conductas— es una
   * decisión de Prevención, no una que se adivine acá. */
  { n: null, definitionCode: "observacion_ampliroll",   name: "Observación de Seguridad: Camión Ampliroll",      kind: "observation" },
  { n: null, definitionCode: "observacion_maquinaria",  name: "Observación de Seguridad: Maquinaria Pesada",     kind: "observation" },
  { n: null, definitionCode: "inspeccion_no_planeada", name: "Inspección no planeada (Anexo 08)",               kind: "inspection" },
  { n: 64, definitionCode: "inspeccion_epp",            name: "Inspección de Uso y Estado de EPP (JT)",          kind: "inspection", versionSuffix: "jt" },
  { n: 65, definitionCode: "inspeccion_epp",            name: "Inspección de Uso y Estado de EPP (PRF)",         kind: "inspection", versionSuffix: "prf" },
  // Sin actividad PDTP: la auditoría interna del SGSST la exige el DS 44
  // art. 22 n°4, no el programa anual. Se instala igual para que nadie tenga
  // que incorporarla desde el catálogo.
  { n: null, definitionCode: "auditoria_sgsst",         name: "Auditoría interna del Sistema de Gestión de SST",  kind: "audit" },
]

/** `n` como lista, que es la forma en que la columna lo guarda. */
export function completionNumbers(spec: InspectionTemplateSpec): number[] | null {
  if (spec.n === null) return null
  return Array.isArray(spec.n) ? [...spec.n].sort((a, b) => a - b) : [spec.n]
}

export function sameNumbers(actual: number[] | null, expected: number[] | null): boolean {
  if (expected === null) return actual === null
  return actual?.length === expected.length && expected.every((value, index) => actual[index] === value)
}

// ── Detector de cableado ──────────────────────────────────────────────────────

export type InspectionTemplateWiringRow = {
  id: string
  code: string
  versionLabel: string
  status: string
  sourceDefinitionCode: string | null
  pdtpActivityNumbers: number[] | null
  executorOfRecord: string
}

type GapTemplate = { id: string; code: string; versionLabel: string; declares: number[] }

export type InspectionWiringGap =
  /** Vigente sin números, con un borrador del MISMO código que sí los declara.
   *  Se ejecuta y no acredita: falla en silencio. */
  | { kind: "silently_unwired"; definitionCode: string; approved: GapTemplate; draft: GapTemplate }
  /** Vigente sin números cuyo reemplazo vive bajo OTRO código. Aprobar el
   *  borrador no la retira, porque el reemplazo compara por `code`. */
  | { kind: "orphan_approved"; definitionCode: string; approved: GapTemplate; replacedByCodes: string[] }
  /** Borrador que declara actividades y todavía no hay vigente que las cubra. */
  | { kind: "pending_approval"; definitionCode: string; draft: GapTemplate }
  /** Dos borradores del mismo código declarando lo mismo: aprobar uno deja al
   *  otro colgando y no se sabe cuál es el instrumento bueno. */
  | { kind: "duplicate_drafts"; definitionCode: string; drafts: GapTemplate[] }
  /** Vigente cuyo ejecutante de registro no es el que la especificación pide
   *  (la D04: el report de uso diario lo ejecuta el operador nombrado en el
   *  formulario, no quien lo teclea). */
  | { kind: "executor_mismatch"; definitionCode: string; approved: GapTemplate; expected: string; actual: string }

export type InspectionWiringReport = {
  gaps: InspectionWiringGap[]
  /** Actividades del programa sin ningún instrumento vigente que las acredite. */
  activitiesWithoutApprovedInstrument: number[]
}

function toGapTemplate(row: InspectionTemplateWiringRow): GapTemplate {
  return { id: row.id, code: row.code, versionLabel: row.versionLabel, declares: row.pdtpActivityNumbers ?? [] }
}

/**
 * Clasifica el estado del cableado entre las plantillas instaladas y el
 * programa 2026.
 *
 * **Agrupa por `sourceDefinitionCode`, no por `code`**, y en eso está toda la
 * gracia. La plantilla `inspeccion_epp` v02 quedó vigente sin números y sus
 * reemplazos son `inspeccion_epp_jt` y `inspeccion_epp_prf`, con código propio
 * desde que la migración 0218 los separó. `supersedePreviousApproved` retira
 * por `code`, así que aprobar los dos borradores **no** la retira: sigue
 * vigente, ejecutable y acreditando nada, para siempre. Una regla que agrupara
 * por `code` no vería ese caso, que es justamente el peor de todos.
 *
 * Pura y sin base de datos: la consumen el preflight del despliegue y el
 * catálogo de inspecciones, que no pueden opinar distinto.
 */
export function classifyPdtp2026InspectionWiring(rows: readonly InspectionTemplateWiringRow[]): InspectionWiringReport {
  const specByDefinition = new Map<string, InspectionTemplateSpec[]>()
  for (const spec of PDTP_2026_INSPECTION_SPECS) {
    const list = specByDefinition.get(spec.definitionCode) ?? []
    list.push(spec)
    specByDefinition.set(spec.definitionCode, list)
  }

  const gaps: InspectionWiringGap[] = []
  const declaredByApproved = new Set<number>()

  for (const [definitionCode, specs] of specByDefinition) {
    const group = rows.filter((row) => (row.sourceDefinitionCode ?? row.code) === definitionCode)
    if (group.length === 0) continue

    const approved = group.filter((row) => row.status === "approved")
    const drafts = group.filter((row) => row.status === "draft")
    for (const row of approved) for (const n of row.pdtpActivityNumbers ?? []) declaredByApproved.add(n)

    // Vigentes sin números. Se separan en dos diagnósticos porque el remedio es
    // distinto: uno se arregla solo al aprobar, el otro exige retirar a mano.
    for (const row of approved.filter((candidate) => (candidate.pdtpActivityNumbers ?? []).length === 0)) {
      const sameCodeDraft = drafts.find((draft) => draft.code === row.code && (draft.pdtpActivityNumbers ?? []).length > 0)
      if (sameCodeDraft) {
        gaps.push({ kind: "silently_unwired", definitionCode, approved: toGapTemplate(row), draft: toGapTemplate(sameCodeDraft) })
        continue
      }
      const otherCodeDrafts = drafts.filter((draft) => draft.code !== row.code && (draft.pdtpActivityNumbers ?? []).length > 0)
      if (otherCodeDrafts.length > 0) {
        gaps.push({
          kind: "orphan_approved",
          definitionCode,
          approved: toGapTemplate(row),
          replacedByCodes: [...new Set(otherCodeDrafts.map((draft) => draft.code))].sort(),
        })
      }
    }

    // Ejecutante de registro equivocado en la vigente.
    for (const spec of specs) {
      const expected = spec.executorOfRecord ?? "platform_user"
      if (expected === "platform_user") continue
      for (const row of approved) {
        if (row.executorOfRecord !== expected) {
          gaps.push({ kind: "executor_mismatch", definitionCode, approved: toGapTemplate(row), expected, actual: row.executorOfRecord })
        }
      }
    }

    // Borradores que declaran actividades sin vigente que las cubra.
    const wiredDrafts = drafts.filter((draft) => (draft.pdtpActivityNumbers ?? []).length > 0)
    const byCode = new Map<string, InspectionTemplateWiringRow[]>()
    for (const draft of wiredDrafts) {
      const list = byCode.get(draft.code) ?? []
      list.push(draft)
      byCode.set(draft.code, list)
    }
    for (const [, sameCode] of byCode) {
      if (sameCode.length > 1) {
        gaps.push({ kind: "duplicate_drafts", definitionCode, drafts: sameCode.map(toGapTemplate) })
      }
      const draft = sameCode[0]!
      const covered = (draft.pdtpActivityNumbers ?? []).every((n) => declaredByApproved.has(n))
      if (!covered) gaps.push({ kind: "pending_approval", definitionCode, draft: toGapTemplate(draft) })
    }
  }

  const expected = new Set<number>()
  for (const spec of PDTP_2026_INSPECTION_SPECS) {
    for (const n of completionNumbers(spec) ?? []) expected.add(n)
    if (spec.reviewN !== undefined) expected.add(spec.reviewN)
  }
  const activitiesWithoutApprovedInstrument = [...expected].filter((n) => !declaredByApproved.has(n)).sort((a, b) => a - b)

  return { gaps, activitiesWithoutApprovedInstrument }
}

