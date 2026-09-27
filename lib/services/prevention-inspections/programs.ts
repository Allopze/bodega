import { and, asc, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import {
  preventionInspectionPrograms,
  preventionInspectionTemplates,
  preventionContainers,
  preventionEmergencyResources,
  fuelVehicles,
  preventionRiskEntries,
  preventionRiskMatrices,
} from "@/db/schema"
import {
  history,
  NOT_FOUND,
  nowIso,
  requireAccess,
  scopeAllows,
  type Client,
  type InspectionAccess,
} from "@/lib/services/prevention-inspections-access"
import { nanoid } from "@/lib/id"
import { containerLabel } from "@/lib/prevention/containers"
import { listContainersByWorksite, listContainersForWorksite } from "@/lib/services/prevention-containers"
import { FREQUENCY_INTERVAL_DAYS } from "@/lib/prevention/inspections"
import { listWorksiteVehicles, vehicleLabel } from "@/lib/services/fleet"

/* ── Programación ─────────────────────────────────────────────────────────── */

const programSchema = z.object({
  templateId: z.string().min(1),
  worksiteId: z.string().min(1),
  frequency: z.enum(["daily", "weekly", "biweekly", "monthly", "quarterly", "biannual", "annual", "on_demand"]),
  intervalDays: z.number().int().positive().max(3650).optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  assignedToUserId: z.string().min(1).nullable().optional(),
  riskEntryId: z.string().min(1).nullable().optional(),
  subjectType: z.string().trim().max(120).nullable().optional(),
  /* El sujeto del programa existía como columna desde 0190 y ningún servicio
   * lo escribía ni lo propagaba al run: programar "el extintor del pañol" era
   * imposible. Se activa acá junto con el equipo de flota. */
  subjectResourceId: z.string().min(1).nullable().optional(),
  subjectVehicleId: z.string().min(1).nullable().optional(),
  /** Contenedor del catálogo; obligatorio en la plantilla de contenedores. */
  subjectContainerId: z.string().min(1).nullable().optional(),
})

export async function createInspectionProgram(input: unknown, access: InspectionAccess) {
  const data = programSchema.parse(input)
  requireAccess(access, "prevention:inspections:manage", data.worksiteId)

  const [template] = await db.select().from(preventionInspectionTemplates)
    .where(eq(preventionInspectionTemplates.id, data.templateId)).limit(1)
  if (!template) throw new Error(NOT_FOUND)
  if (template.status !== "approved") throw new Error("Sólo puede programarse una plantilla aprobada.")
  if (data.riskEntryId) await assertRiskEntryInWorksite(db, data.riskEntryId, data.worksiteId)
  assertContainerSubject(template.sourceDefinitionCode, data.subjectContainerId)
  await resolveSubject(db, {
    worksiteId: data.worksiteId,
    subjectResourceId: data.subjectResourceId,
    subjectVehicleId: data.subjectVehicleId,
    subjectContainerId: data.subjectContainerId,
  }, true)

  const [created] = await db.insert(preventionInspectionPrograms).values({
    id: `insprog-${nanoid()}`,
    templateId: data.templateId,
    worksiteId: data.worksiteId,
    frequency: data.frequency,
    intervalDays: data.intervalDays ?? FREQUENCY_INTERVAL_DAYS[data.frequency] ?? 30,
    nextDueOn: data.startsOn,
    assignedToUserId: data.assignedToUserId ?? null,
    riskEntryId: data.riskEntryId ?? null,
    subjectType: data.subjectType ?? (data.subjectContainerId ? "contenedor" : null),
    subjectResourceId: data.subjectResourceId ?? null,
    subjectVehicleId: data.subjectVehicleId ?? null,
    subjectContainerId: data.subjectContainerId ?? null,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo crear la programación.")
  await history(db, { entityType: "program", entityId: created.id, worksiteId: data.worksiteId, changeType: "created", reason: `Programación ${data.frequency} desde ${data.startsOn}`, afterState: created, actorUserId: access.userId })
  return created
}

/**
 * Editar y activar/desactivar una programación (A-10, A-11).
 *
 * No hay borrado físico: `isActive=false` es el borrado. Las ejecuciones ya
 * creadas apuntan al programa con `onDelete: set null`, y borrarlo les quitaría
 * el origen — que es justamente lo que explica por qué existen.
 */
export async function updateInspectionProgram(input: unknown, access: InspectionAccess) {
  const data = z.object({
    programId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    frequency: z.enum(["daily", "weekly", "biweekly", "monthly", "quarterly", "biannual", "annual", "on_demand"]).optional(),
    intervalDays: z.number().int().positive().max(3650).optional(),
    nextDueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    assignedToUserId: z.string().min(1).nullable().optional(),
    riskEntryId: z.string().min(1).nullable().optional(),
    subjectType: z.string().trim().max(120).nullable().optional(),
    subjectResourceId: z.string().min(1).nullable().optional(),
    subjectVehicleId: z.string().min(1).nullable().optional(),
    subjectContainerId: z.string().min(1).nullable().optional(),
    isActive: z.boolean().optional(),
    reason: z.string().trim().min(10).max(2000).optional(),
  }).parse(input)

  return db.transaction(async (tx) => {
    const [program] = await tx.select().from(preventionInspectionPrograms)
      .where(eq(preventionInspectionPrograms.id, data.programId)).limit(1)
    if (!program) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:inspections:manage", program.worksiteId)
    if (program.version !== data.expectedVersion) {
      throw new Error("La programación cambió mientras la editabas. Recarga y reintenta.")
    }
    if (data.isActive !== undefined && data.isActive !== program.isActive && !data.reason) {
      throw new Error("Activar o detener una programación requiere un motivo de al menos 10 caracteres.")
    }
    if (data.riskEntryId) await assertRiskEntryInWorksite(tx, data.riskEntryId, program.worksiteId)
    // `undefined` = no se toca; para validar hay que mirar el valor resultante,
    // no el enviado, o cambiar sólo uno de los dos dejaría pasar el par.
    const nextResourceId = data.subjectResourceId === undefined ? program.subjectResourceId : data.subjectResourceId
    const nextVehicleId = data.subjectVehicleId === undefined ? program.subjectVehicleId : data.subjectVehicleId
    const nextContainerId = data.subjectContainerId === undefined ? program.subjectContainerId : data.subjectContainerId
    const [template] = await tx.select({ sourceDefinitionCode: preventionInspectionTemplates.sourceDefinitionCode })
      .from(preventionInspectionTemplates)
      .where(eq(preventionInspectionTemplates.id, program.templateId)).limit(1)
    /* Sólo cuando el llamador toca el sujeto. Aplicarlo a toda edición dejaba
     * sin poder detener las programaciones de contenedores anteriores al
     * catálogo —su columna es nula y "Detener" no envía sujeto—, mientras el
     * materializador, que no pasa por acá, las seguía ejecutando. */
    if (data.subjectContainerId !== undefined) {
      assertContainerSubject(template?.sourceDefinitionCode ?? null, nextContainerId)
    }
    await resolveSubject(tx, {
      worksiteId: program.worksiteId,
      subjectResourceId: nextResourceId,
      subjectVehicleId: nextVehicleId,
      subjectContainerId: nextContainerId,
      // Vigencia sólo si el sujeto es el que se está eligiendo ahora: si no,
      // retirar una ficha bloquearía hasta el botón de detener el programa.
    }, data.subjectContainerId !== undefined)

    const now = nowIso()
    const [updated] = await tx.update(preventionInspectionPrograms).set({
      frequency: data.frequency ?? program.frequency,
      // Cambiar la frecuencia sin tocar el intervalo dejaría "Mensual" con el
      // intervalo de la frecuencia anterior; el default sigue a la frecuencia
      // salvo que el usuario declare uno propio.
      intervalDays: data.intervalDays
        ?? (data.frequency ? FREQUENCY_INTERVAL_DAYS[data.frequency] ?? program.intervalDays : program.intervalDays),
      nextDueOn: data.nextDueOn ?? program.nextDueOn,
      assignedToUserId: data.assignedToUserId === undefined ? program.assignedToUserId : data.assignedToUserId,
      riskEntryId: data.riskEntryId === undefined ? program.riskEntryId : data.riskEntryId,
      subjectType: data.subjectType === undefined ? program.subjectType : data.subjectType,
      subjectResourceId: nextResourceId,
      subjectVehicleId: nextVehicleId,
      subjectContainerId: nextContainerId,
      isActive: data.isActive ?? program.isActive,
      version: program.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionInspectionPrograms.id, program.id),
      eq(preventionInspectionPrograms.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La programación cambió mientras la editabas. Recarga y reintenta.")

    await history(tx, {
      entityType: "program", entityId: program.id, worksiteId: program.worksiteId,
      changeType: updated.isActive === program.isActive ? "updated" : (updated.isActive ? "reactivated" : "deactivated"),
      reason: data.reason ?? `Programación ${updated.frequency} cada ${updated.intervalDays} día(s), próxima ${updated.nextDueOn}`,
      beforeState: program, afterState: updated, actorUserId: access.userId,
    })
    return updated
  })
}

/**
 * A-09: el diálogo pedía escribir el ID de la MIPER a mano en un campo de
 * texto libre, sin validar existencia ni pertenencia a la faena. Un ID mal
 * tipeado daba una violación de FK cruda.
 */
async function assertRiskEntryInWorksite(client: Client, riskEntryId: string, worksiteId: string) {
  const [entry] = await client.select({ id: preventionRiskEntries.id })
    .from(preventionRiskEntries)
    .innerJoin(preventionRiskMatrices, eq(preventionRiskMatrices.id, preventionRiskEntries.matrixId))
    .where(and(
      eq(preventionRiskEntries.id, riskEntryId),
      eq(preventionRiskMatrices.worksiteId, worksiteId),
    )).limit(1)
  if (!entry) throw new Error("El peligro MIPER no existe o pertenece a otra faena.")
}

/**
 * Comprueba que el programa esté dentro del alcance de faena del usuario.
 *
 * `materializeProgramRuns` corre también desde el cron, que no tiene sesión, y
 * por eso no recibe `InspectionAccess`: cuando lo dispara una persona, el
 * alcance se valida aquí antes de invocarlo.
 */
export async function assertProgramInScope(programId: string, access: InspectionAccess) {
  const [program] = await db.select({ worksiteId: preventionInspectionPrograms.worksiteId })
    .from(preventionInspectionPrograms)
    .where(eq(preventionInspectionPrograms.id, programId)).limit(1)
  if (!program) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:inspections:manage", program.worksiteId)
}

/**
 * Resuelve el sujeto declarado y devuelve la etiqueta a congelar.
 *
 * Puerta única para programa y ejecución: el sujeto debe existir Y pertenecer
 * a la faena. Sin esto, un id de otra faena entra por la acción y filtra el
 * nombre del recurso o la patente ajena. El CHECK
 * `prevention_inspection_run_single_subject` cubre la exclusión mutua en la
 * base; acá se rechaza antes, con un mensaje que se entiende.
 *
 * Exportada para el materializador de programas, que crea ejecuciones sin
 * sesión y necesita la MISMA etiqueta congelada: sin ella, un run programado
 * quedaba con el sujeto apuntado pero sin nombre, y la bandeja, la cabecera y
 * el acta lo mostraban vacío (INS-05).
 */
export async function resolveSubject(
  client: Client,
  args: {
    worksiteId: string
    subjectResourceId?: string | null
    subjectVehicleId?: string | null
    subjectContainerId?: string | null
  },
  /** Alta nueva: exige que el sujeto siga vigente. El cron no lo exige. */
  requireActiveSubject = false,
): Promise<string | null> {
  const declared = [args.subjectResourceId, args.subjectVehicleId, args.subjectContainerId]
    .filter(Boolean).length
  if (declared > 1) {
    throw new Error("Una inspección tiene un solo sujeto: recurso de emergencia, equipo o contenedor, no varios.")
  }
  if (args.subjectResourceId) {
    const [found] = await client.select({ name: preventionEmergencyResources.name })
      .from(preventionEmergencyResources)
      .where(and(
        eq(preventionEmergencyResources.id, args.subjectResourceId),
        eq(preventionEmergencyResources.worksiteId, args.worksiteId),
      )).limit(1)
    if (!found) throw new Error("El sujeto no existe o pertenece a otra faena.")
    return found.name
  }
  if (args.subjectVehicleId) {
    const [found] = await client.select({ plate: fuelVehicles.plate, code: fuelVehicles.code })
      .from(fuelVehicles)
      .where(and(
        eq(fuelVehicles.id, args.subjectVehicleId),
        eq(fuelVehicles.worksiteId, args.worksiteId),
      )).limit(1)
    if (!found) throw new Error("El equipo no existe o pertenece a otra faena.")
    return vehicleLabel(found)
  }
  if (args.subjectContainerId) {
    const [found] = await client.select({
      code: preventionContainers.code,
      location: preventionContainers.location,
      isActive: preventionContainers.isActive,
    })
      .from(preventionContainers)
      .where(and(
        eq(preventionContainers.id, args.subjectContainerId),
        eq(preventionContainers.worksiteId, args.worksiteId),
      )).limit(1)
    if (!found) throw new Error("El contenedor no existe o pertenece a otra faena.")
    /* Retirado del catálogo = no recibe trabajo nuevo. La comprobación es de
     * alta y no de resolución: el materializador también pasa por acá, y
     * hacerlo fallar dejaría a un programa vivo sin generar nada y en silencio.
     * Retirar un contenedor con programación es, por eso, un acto en dos pasos:
     * detener el programa y luego retirar la ficha. */
    if (requireActiveSubject && !found.isActive) {
      throw new Error("Ese contenedor está retirado del catálogo. Reactívalo o elige otro.")
    }
    return containerLabel(found)
  }
  return null
}

/**
 * Plantillas que exigen sujeto del catálogo, por `sourceDefinitionCode`.
 *
 * La inspección de contenedores nombraba su sujeto con texto libre porque el
 * catálogo no existía: dos inspectores escribían la misma unidad de dos formas
 * y el historial por contenedor era imposible de armar. Con el padrón en pie,
 * el texto libre deja de ser una opción para esta plantilla.
 */
const CONTAINER_DEFINITION_CODE = "inspeccion_contenedores"

export function assertContainerSubject(
  sourceDefinitionCode: string | null,
  subjectContainerId: string | null | undefined,
) {
  if (sourceDefinitionCode !== CONTAINER_DEFINITION_CODE) return
  if (!subjectContainerId) {
    throw new Error("Selecciona un contenedor del catálogo de la faena.")
  }
}

/**
 * Sujetos inspeccionables de la faena (función #11).
 *
 * Reusa `preventionEmergencyResources`, que ya es el inventario por faena
 * —nombre, tipo, ubicación, serie— con su CRUD y sus alertas de vencimiento.
 * Se lista bajo el alcance de faena de inspecciones, sin exigir permisos del
 * módulo de emergencias: mismo criterio que ya aplica la certificación CPHS
 * para sus lecturas directas de tablas de otros módulos.
 */
export async function listInspectionSubjects(worksiteId: string, access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:view", worksiteId)
  const [resources, vehicles, containers] = await Promise.all([
    db.select({
      id: preventionEmergencyResources.id,
      name: preventionEmergencyResources.name,
      kind: preventionEmergencyResources.kind,
      location: preventionEmergencyResources.location,
      serialNumber: preventionEmergencyResources.serialNumber,
    })
      .from(preventionEmergencyResources)
      .where(eq(preventionEmergencyResources.worksiteId, worksiteId))
      .orderBy(asc(preventionEmergencyResources.name))
      .limit(500),
    // El inventario de emergencias no modela camiones ni maquinaria; el padrón
    // de equipos vive en flota y hasta ahora sólo llegaba como texto libre.
    listWorksiteVehicles({ worksiteId }),
    // Tercer padrón: los contenedores del Anexo 14, que hasta que existió el
    // catálogo sólo llegaban como etiqueta escrita a mano.
    listContainersForWorksite(worksiteId),
  ])
  return [
    ...resources.map((item) => ({
      source: "resource" as const,
      id: item.id,
      name: item.name,
      kind: item.kind,
      location: item.location,
      serialNumber: item.serialNumber,
    })),
    ...vehicles.map((item) => ({
      source: "vehicle" as const,
      id: item.id,
      name: vehicleLabel(item),
      kind: item.type,
      location: "",
      serialNumber: item.plate,
    })),
    ...containers.map((item) => ({
      source: "container" as const,
      id: item.id,
      name: containerLabel(item),
      kind: "Contenedor",
      location: item.location,
      serialNumber: item.code,
    })),
  ]
}

/**
 * Inventario de varias faenas de una vez, agrupado por faena.
 *
 * La bandeja y la programación precargan el picker de sujeto para todas las
 * faenas del alcance, y hacerlo faena por faena eran dos consultas por cada una
 * en CADA carga de pantalla — con alcance global, cuarenta consultas para
 * poblar un `Select` que la mayoría de las veces nadie abre (INS-12).
 */
export async function listInspectionSubjectsByWorksite(
  worksiteIds: string[],
  access: InspectionAccess,
): Promise<Record<string, Awaited<ReturnType<typeof listInspectionSubjects>>>> {
  const grouped: Record<string, Awaited<ReturnType<typeof listInspectionSubjects>>> = {}
  const allowed = worksiteIds.filter((worksiteId) => scopeAllows(access.scope, worksiteId))
  for (const worksiteId of allowed) grouped[worksiteId] = []
  if (allowed.length === 0) return grouped
  requireAccess(access, "prevention:inspections:view")

  const [resources, vehicles, containersByWorksite] = await Promise.all([
    db.select({
      worksiteId: preventionEmergencyResources.worksiteId,
      id: preventionEmergencyResources.id,
      name: preventionEmergencyResources.name,
      kind: preventionEmergencyResources.kind,
      location: preventionEmergencyResources.location,
      serialNumber: preventionEmergencyResources.serialNumber,
    })
      .from(preventionEmergencyResources)
      .where(inArray(preventionEmergencyResources.worksiteId, allowed))
      .orderBy(asc(preventionEmergencyResources.name))
      .limit(500 * allowed.length),
    db.select({
      worksiteId: fuelVehicles.worksiteId,
      id: fuelVehicles.id,
      plate: fuelVehicles.plate,
      code: fuelVehicles.code,
      type: fuelVehicles.type,
    })
      .from(fuelVehicles)
      .where(and(inArray(fuelVehicles.worksiteId, allowed), eq(fuelVehicles.isActive, true))),
    listContainersByWorksite(allowed),
  ])

  for (const item of resources) {
    grouped[item.worksiteId]?.push({
      source: "resource", id: item.id, name: item.name, kind: item.kind,
      location: item.location, serialNumber: item.serialNumber,
    })
  }
  for (const item of vehicles) {
    grouped[item.worksiteId]?.push({
      source: "vehicle", id: item.id, name: vehicleLabel(item), kind: item.type,
      location: "", serialNumber: item.plate,
    })
  }
  for (const [worksiteId, containers] of Object.entries(containersByWorksite)) {
    for (const item of containers) {
      grouped[worksiteId]?.push({
        source: "container", id: item.id, name: containerLabel(item), kind: "Contenedor",
        location: item.location, serialNumber: item.code,
      })
    }
  }
  return grouped
}

/** Peligros de la MIPER de la faena, para el picker de la programación (A-09). */
export async function listRiskEntriesForWorksite(worksiteId: string, access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:view", worksiteId)
  return db.select({
    id: preventionRiskEntries.id,
    hazardCode: preventionRiskEntries.hazardCode,
    hazard: preventionRiskEntries.hazard,
  })
    .from(preventionRiskEntries)
    .innerJoin(preventionRiskMatrices, eq(preventionRiskMatrices.id, preventionRiskEntries.matrixId))
    .where(eq(preventionRiskMatrices.worksiteId, worksiteId))
    .orderBy(asc(preventionRiskEntries.hazardCode))
    .limit(500)
}
