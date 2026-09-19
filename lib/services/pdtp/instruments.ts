/**
 * lib/services/pdtp/instruments.ts
 *
 * "Qué instrumento acredita este número, y está vigente", en un solo lugar.
 *
 * Declarar no es poder ejecutar, y la compuerta confundía las dos cosas: daba
 * por cableada una actividad cuya plantilla estaba en borrador —y sólo una
 * plantilla `approved` se puede programar o ejecutar—, cuyo curso no tenía
 * ninguna versión `published` —`createTrainingSession` la exige— o cuyo plan de
 * emergencia seguía en `draft`, que es lo que la N°84 necesita aprobado para
 * poder programar un simulacro.
 *
 * El preflight ya calculaba una parte de esto por su cuenta y la dejaba fuera
 * de su propio `ok`. Dos lugares que opinan sobre lo mismo se desincronizan y
 * el que avisa termina mintiendo, así que la respuesta vive acá y los dos la
 * consultan.
 *
 * **Por qué el índice devuelve la identidad y no sólo números** (2026-09-19):
 * este archivo devolvía `Set<number>` y `Map<number, Set<string>>`, y
 * `fulfillment.ts` tenía sus propias lecturas sin filtro de estado para la
 * pregunta gemela "¿está declarado?". Con eso, el informe de cobertura podía
 * decir que faltaba *algo* pero no *cuál*: su mensaje era literalmente "su
 * plantilla no tiene una versión aprobada **o** su curso no tiene ninguna
 * versión publicada", ambiguo por construcción, y sin un id al que enlazar el
 * operador no tenía dónde ir. En prueba de usabilidad no pudo resolver ninguna
 * actividad.
 *
 * Las dos preguntas son la misma lectura con y sin un `WHERE` de estado, así
 * que ahora se leen juntas: cada tabla una vez, con su columna `status`, y las
 * dos respuestas se derivan. Son 6 `SELECT` en una ola donde antes eran 11 en
 * tres, y la identidad sale gratis.
 *
 * `sst_document_types` no participa de la vigencia: no tiene columna de estado,
 * y el instrumento de la N°36 y la N°43 es el documento publicado, que es un
 * hecho y no una configuración.
 */

import { eq, isNotNull } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  preventionCampaigns,
  preventionEmergencyPlans,
  preventionInspectionTemplates,
  preventionTrainingCourses,
  preventionTrainingCourseVersions,
  sstDocumentTypes,
} from "@/db/schema"

type QueryClient = DB | Tx

/**
 * La fila real que declara un número, con lo necesario para decidir vigencia
 * **y** para nombrarla. Es interno al servicio: `describePdtpInstrumentGap` lo
 * proyecta a `PdtpCoverageInstrument`, que es lo que cruza a la UI.
 *
 * `usable` responde "¿este instrumento, por sí solo, vuelve ejecutable el
 * número?". Para los que existen por faena (`worksiteId` presente) la respuesta
 * es por faena y el consumidor la agrega; para los globales vale para todo el
 * programa.
 */
export type PdtpInstrumentRecord =
  | {
      kind: "inspection_template"
      id: string
      code: string
      versionLabel: string
      name: string
      status: string
      authorUserId: string | null
      usable: boolean
    }
  | {
      kind: "training_course"
      id: string
      code: string
      name: string
      isActive: boolean
      minimumDurationMinutes: number
      /** La versión más avanzada del curso, para poder decir QUÉ le falta y no
       *  sólo que falta. `null` = el curso existe sin ninguna versión. */
      latestVersion: {
        id: string
        versionLabel: string
        status: string
        durationMinutes: number
        authorUserId: string | null
      } | null
      usable: boolean
    }
  | {
      kind: "document_type"
      id: string
      code: string
      name: string
      /** Siempre `true`: no hay estado que verificar. Ver la cabecera. */
      usable: true
    }
  | {
      kind: "emergency_plan"
      id: string
      code: string
      title: string
      status: string
      worksiteId: string
      createdByUserId: string | null
      usable: boolean
    }
  | {
      kind: "campaign"
      id: string
      code: string
      title: string
      status: string
      worksiteId: string
      /** Siempre `true`: una campaña en borrador es trabajo por hacer, no un
       *  instrumento faltante. Ver la nota al pie de `loadPdtpInstrumentIndex`. */
      usable: true
    }

export type PdtpInstrumentNumberSets = {
  global: Set<number>
  perWorksite: Map<number, Set<string>>
}

export type PdtpInstrumentIndex = {
  /** Todos los instrumentos que declaran cada número, vigentes y no. Es lo que
   *  permite nombrar el instrumento concreto en el informe de cobertura. */
  byNumber: Map<number, PdtpInstrumentRecord[]>
  /** "¿Está vigente?" — el instrumento se puede ejecutar hoy. */
  usable: PdtpInstrumentNumberSets
  /**
   * "¿Está declarado?" — existe el instrumento, en cualquier estado.
   *
   * No lleva un `planNumbers` aparte: existía para que el informe supiera que
   * el número lo declaraba un plan de emergencia y no una plantilla, y eso
   * ahora se lee de `byNumber`, que además dice **cuál** plan.
   */
  declared: PdtpInstrumentNumberSets
}

function addTo(sets: PdtpInstrumentNumberSets, n: number, worksiteId?: string) {
  if (worksiteId === undefined) {
    sets.global.add(n)
    return
  }
  const forNumber = sets.perWorksite.get(n) ?? new Set<string>()
  forNumber.add(worksiteId)
  sets.perWorksite.set(n, forNumber)
}

function emptySets(): PdtpInstrumentNumberSets {
  return { global: new Set<number>(), perWorksite: new Map<number, Set<string>>() }
}

/**
 * Las seis tablas que declaran números de actividad, leídas una vez cada una.
 *
 * El `WHERE pdtp_activity_numbers IS NOT NULL` de plantillas y cursos no cambia
 * el resultado —las filas sin números se descartaban igual en el bucle— y
 * recorta lo que viaja. Las versiones de curso entran por `INNER JOIN` en vez
 * del `inArray(courses.map(id))` que había antes: esa dependencia de datos era
 * el único motivo de que la carga fueran tres olas secuenciales en vez de una.
 */
export async function loadPdtpInstrumentIndex(client: QueryClient = db): Promise<PdtpInstrumentIndex> {
  const [templates, courses, courseVersions, docTypes, campaigns, plans] = await Promise.all([
    client.select({
      id: preventionInspectionTemplates.id,
      code: preventionInspectionTemplates.code,
      versionLabel: preventionInspectionTemplates.versionLabel,
      name: preventionInspectionTemplates.name,
      status: preventionInspectionTemplates.status,
      authorUserId: preventionInspectionTemplates.authorUserId,
      n: preventionInspectionTemplates.pdtpActivityNumbers,
    }).from(preventionInspectionTemplates)
      .where(isNotNull(preventionInspectionTemplates.pdtpActivityNumbers)),
    client.select({
      id: preventionTrainingCourses.id,
      code: preventionTrainingCourses.code,
      name: preventionTrainingCourses.name,
      isActive: preventionTrainingCourses.isActive,
      minimumDurationMinutes: preventionTrainingCourses.minimumDurationMinutes,
      n: preventionTrainingCourses.pdtpActivityNumbers,
    }).from(preventionTrainingCourses)
      .where(isNotNull(preventionTrainingCourses.pdtpActivityNumbers)),
    // Todas las versiones, no sólo las `published`: para decir «su v02 está en
    // revisión» hay que haberla leído.
    client.select({
      id: preventionTrainingCourseVersions.id,
      courseId: preventionTrainingCourseVersions.courseId,
      versionLabel: preventionTrainingCourseVersions.versionLabel,
      status: preventionTrainingCourseVersions.status,
      durationMinutes: preventionTrainingCourseVersions.durationMinutes,
      authorUserId: preventionTrainingCourseVersions.authorUserId,
    }).from(preventionTrainingCourseVersions)
      .innerJoin(preventionTrainingCourses, eq(preventionTrainingCourses.id, preventionTrainingCourseVersions.courseId))
      .where(isNotNull(preventionTrainingCourses.pdtpActivityNumbers)),
    client.select({
      id: sstDocumentTypes.id,
      code: sstDocumentTypes.code,
      name: sstDocumentTypes.name,
      n: sstDocumentTypes.pdtpActivityNumbers,
      ack: sstDocumentTypes.pdtpAcknowledgmentActivityNumbers,
    }).from(sstDocumentTypes),
    client.select({
      id: preventionCampaigns.id,
      code: preventionCampaigns.code,
      title: preventionCampaigns.title,
      status: preventionCampaigns.status,
      worksiteId: preventionCampaigns.worksiteId,
      n: preventionCampaigns.pdtpActivityNumbers,
    }).from(preventionCampaigns),
    client.select({
      id: preventionEmergencyPlans.id,
      code: preventionEmergencyPlans.code,
      title: preventionEmergencyPlans.title,
      status: preventionEmergencyPlans.status,
      worksiteId: preventionEmergencyPlans.worksiteId,
      createdByUserId: preventionEmergencyPlans.createdByUserId,
      n: preventionEmergencyPlans.pdtpActivityNumbers,
    }).from(preventionEmergencyPlans),
  ])

  const byNumber = new Map<number, PdtpInstrumentRecord[]>()
  const usable = emptySets()
  const declared = emptySets()

  const record = (numbers: number[] | null, entry: PdtpInstrumentRecord, worksiteId?: string) => {
    for (const n of numbers ?? []) {
      const forNumber = byNumber.get(n) ?? []
      forNumber.push(entry)
      byNumber.set(n, forNumber)
      addTo(declared, n, worksiteId)
      if (entry.usable) addTo(usable, n, worksiteId)
    }
  }

  for (const row of templates) {
    record(row.n as number[] | null, {
      kind: "inspection_template",
      id: row.id, code: row.code, versionLabel: row.versionLabel, name: row.name,
      status: row.status, authorUserId: row.authorUserId,
      usable: row.status === "approved",
    })
  }

  // Un curso cuenta cuando alguna de sus versiones está `published` **y** dura
  // al menos el mínimo del catálogo: `createTrainingSession` rechaza cualquier
  // otro estado, y una versión publicada más corta que el mínimo no acredita.
  const versionsByCourseId = new Map<string, typeof courseVersions>()
  for (const version of courseVersions) {
    const forCourse = versionsByCourseId.get(version.courseId) ?? []
    forCourse.push(version)
    versionsByCourseId.set(version.courseId, forCourse)
  }
  /** Cuál versión mostrar cuando el curso no es ejecutable: la más avanzada del
   *  flujo, que es la que el operador tiene que empujar. */
  const VERSION_PROGRESS = ["draft", "observed", "in_review", "approved", "published", "superseded"]
  for (const course of courses) {
    const versions = versionsByCourseId.get(course.id) ?? []
    const usableVersion = versions.find(
      (version) => version.status === "published" && version.durationMinutes >= course.minimumDurationMinutes,
    )
    const latestVersion = usableVersion ?? [...versions].sort(
      (a, b) => VERSION_PROGRESS.indexOf(b.status) - VERSION_PROGRESS.indexOf(a.status),
    )[0] ?? null
    record(course.n as number[] | null, {
      kind: "training_course",
      id: course.id, code: course.code, name: course.name,
      isActive: course.isActive, minimumDurationMinutes: course.minimumDurationMinutes,
      latestVersion: latestVersion
        ? {
            id: latestVersion.id, versionLabel: latestVersion.versionLabel,
            status: latestVersion.status, durationMinutes: latestVersion.durationMinutes,
            authorUserId: latestVersion.authorUserId,
          }
        : null,
      usable: Boolean(usableVersion),
    })
  }

  for (const row of docTypes) {
    const entry: PdtpInstrumentRecord = {
      kind: "document_type", id: row.id, code: row.code, name: row.name, usable: true,
    }
    // Las dos columnas se unen a propósito: una acredita al publicar y la otra
    // por acuse de recibo, pero para "¿tiene destino?" cualquiera sirve.
    record(row.n as number[] | null, entry)
    record(row.ack as number[] | null, entry)
  }

  // Campañas sin condición de estado: una campaña en borrador es trabajo por
  // hacer, no un instrumento faltante.
  for (const row of campaigns) {
    record(row.n as number[] | null, {
      kind: "campaign",
      id: row.id, code: row.code, title: row.title, status: row.status,
      worksiteId: row.worksiteId, usable: true,
    }, row.worksiteId)
  }

  // Planes de emergencia: `approved` es lo único ejecutable — `archived` es el
  // tercer valor del CHECK y no acredita.
  for (const row of plans) {
    record(row.n as number[] | null, {
      kind: "emergency_plan",
      id: row.id, code: row.code, title: row.title, status: row.status,
      worksiteId: row.worksiteId, createdByUserId: row.createdByUserId,
      usable: row.status === "approved",
    }, row.worksiteId)
  }

  return { byNumber, usable, declared }
}

/**
 * "¿Está vigente el instrumento que acredita este número?".
 *
 * Se conserva sobre `loadPdtpInstrumentIndex` porque el nombre *es* la pregunta
 * legible, y la cabecera de este archivo documenta ese contrato. Quien además
 * necesite saber **cuál** instrumento es, o en qué estado está, pide el índice.
 */
export async function usablePdtpInstrumentNumbers(client: QueryClient = db): Promise<PdtpInstrumentNumberSets> {
  return (await loadPdtpInstrumentIndex(client)).usable
}
