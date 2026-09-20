/**
 * lib/services/prevention-alcotest-slots.ts
 *
 * Las casillas del programa en alcotest: qué esperaba el PDTP este año y qué
 * pasó con cada celda.
 *
 * Va aparte de `prevention-alcotest.ts` por la misma razón por la que la
 * casilla va aparte del control: son cosas distintas. El control es el hecho
 * —quién sopló, cuándo, con qué equipo—; la casilla es lo que el programa
 * exigía. Un control extraordinario no tiene casilla y no cuenta en el
 * denominador; una casilla sin control es la brecha que este modelo existe para
 * mostrar.
 *
 * La evidencia cuelga de la casilla y no del control, a diferencia de
 * simulacros: lo que el programa pide respaldar es el cumplimiento del mes —la
 * planilla de controles, el correo del envío—, no cada lectura del alcotómetro.
 */

import { createHash } from "node:crypto"
import { and, desc, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { db, type DB, type Tx } from "@/db"
import {
  alcoholTestDispatches,
  alcoholTests,
  preventionAlcotestSlotEvidence,
  preventionAlcotestSlots,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { nanoid } from "@/lib/id"
import { generateStorageName } from "@/lib/services/prevention-documents/utils"
import { mkdirp, removeFile, writeBuffer } from "@/lib/storage/helpers"
import {
  createPreventionAlcotestEvidencePath,
  resolvePreventionAlcotestEvidenceDir,
  resolveStorageFile,
} from "@/lib/storage/config"
import { PROGRAM_SLOT_YEAR } from "@/lib/prevention/program-slots-2026"
import { assertWorksiteAccess, type WorksiteScope } from "@/lib/services/pdtp/helpers"

type Client = DB | Tx

export class AlcotestSlotError extends Error {}

const SLOT_NOT_FOUND = "La casilla del programa no existe o está fuera de tu alcance."

export type AlcotestSlotKind = "control" | "envio"
export type AlcotestSlotStatus = "pending" | "completed" | "not_completed" | "not_applicable"

/**
 * Casilla con su evidencia activa ya contada.
 *
 * El conteo viaja con la fila porque la pantalla lo necesita en cada una y
 * resolverlo por casilla serían 23 consultas por faena.
 */
export type AlcotestSlotView = typeof preventionAlcotestSlots.$inferSelect & {
  activeEvidenceCount: number
}

/** Las casillas de una faena y año, con su evidencia activa contada. */
export async function listAlcotestSlotsForWorksite(
  scope: WorksiteScope,
  worksiteId: string,
  year = PROGRAM_SLOT_YEAR,
  client: Client = db,
): Promise<AlcotestSlotView[]> {
  assertWorksiteAccess(worksiteId, scope)
  const slots = await client.select().from(preventionAlcotestSlots).where(and(
    eq(preventionAlcotestSlots.worksiteId, worksiteId),
    eq(preventionAlcotestSlots.year, year),
  ))
  if (slots.length === 0) return []

  const evidence = slots.length === 0 ? [] : await client
    .select({ slotId: preventionAlcotestSlotEvidence.slotId })
    .from(preventionAlcotestSlotEvidence)
    .where(and(
      inArray(preventionAlcotestSlotEvidence.slotId, slots.map((slot) => slot.id)),
      eq(preventionAlcotestSlotEvidence.state, "active"),
    ))
  const countBySlot = new Map<string, number>()
  for (const row of evidence) {
    countBySlot.set(row.slotId, (countBySlot.get(row.slotId) ?? 0) + 1)
  }

  return slots
    .map((slot) => ({ ...slot, activeEvidenceCount: countBySlot.get(slot.id) ?? 0 }))
    .sort((a, b) => (
      a.kind === b.kind
        ? a.slotKey.localeCompare(b.slotKey)
        : a.kind.localeCompare(b.kind)
    ))
}

const slotStatusSchema = z.enum(["not_completed", "not_applicable"])

const slotStatusInput = z.object({
  slotId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  status: slotStatusSchema,
  observation: z.string().trim().max(3000).nullable().optional(),
  notApplicableReason: z.string().trim().max(1000).nullable().optional(),
}).superRefine((value, ctx) => {
  const reason = value.notApplicableReason?.trim() ?? ""
  if (value.status === "not_applicable" && reason.length < 10) {
    ctx.addIssue({
      code: "custom",
      path: ["notApplicableReason"],
      message: "Explica por qué el control no aplica en esta faena (al menos 10 caracteres).",
    })
  }
  if (value.status !== "not_applicable" && reason.length > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["notApplicableReason"],
      message: "El motivo de no aplicabilidad sólo corresponde al estado «no aplica».",
    })
  }
})

/**
 * Declara una casilla como no hecha o no aplicable.
 *
 * No puede marcar `completed`: eso lo hace `fulfillAlcotestSlotTx` vinculando el
 * control o el envío que la cumple, dentro de la misma transacción que lo
 * registra. Una casilla que se pudiera poner en verde desde acá permitiría
 * declarar cumplimiento sin hecho que lo respalde.
 */
export async function recordAlcotestSlotStatus(
  input: unknown,
  actor: { userId: string; scope: WorksiteScope },
) {
  const data = slotStatusInput.parse(input)
  return db.transaction(async (tx) => {
    const [slot] = await tx.select().from(preventionAlcotestSlots)
      .where(eq(preventionAlcotestSlots.id, data.slotId)).limit(1)
    if (!slot) throw new AlcotestSlotError(SLOT_NOT_FOUND)
    assertWorksiteAccess(slot.worksiteId, actor.scope)
    if (slot.version !== data.expectedVersion) {
      throw new AlcotestSlotError("La casilla cambió mientras la editabas. Recarga y reintenta.")
    }
    if (slot.status === data.status) throw new AlcotestSlotError("La casilla ya tiene ese estado.")
    /* Una casilla cumplida no se corrige acá: el hecho es el control, y
     * deshacerlo es desvincularlo. Dejar que esta vía la desmarcara permitiría
     * apagar el cumplimiento sin tocar el hecho — y la acreditación PDTP
     * quedaría viva sobre una casilla en rojo. */
    if (slot.status === "completed") {
      throw new AlcotestSlotError(
        slot.kind === "control"
          ? "La casilla está cumplida por un control registrado."
          : "La casilla está cumplida por un envío registrado.",
      )
    }

    const now = new Date().toISOString()
    const notApplicable = data.status === "not_applicable"
    const notApplicableReason = notApplicable ? (data.notApplicableReason?.trim() || null) : null
    const [updated] = await tx.update(preventionAlcotestSlots).set({
      status: data.status,
      notApplicableAt: notApplicable ? now : null,
      notApplicableByUserId: notApplicable ? actor.userId : null,
      notApplicableReason,
      observation: data.observation?.trim() || null,
      version: slot.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionAlcotestSlots.id, data.slotId),
      eq(preventionAlcotestSlots.version, data.expectedVersion),
    )).returning()
    if (!updated) {
      throw new AlcotestSlotError("La casilla cambió mientras la editabas. Recarga y reintenta.")
    }
    return updated
  })
}

/**
 * Marca la casilla cumplida por el hecho que la llena.
 *
 * Va dentro de la transacción que registra el control o el envío: si el
 * registro se revierte, la casilla no puede quedar en verde sin hecho.
 *
 * **El gate duro es la evidencia.** Sin al menos un archivo activo la casilla no
 * se cumple, y eso es lo que impide que la acreditación PDTP se firme con un
 * texto sintético — que es exactamente lo que este módulo hacía antes
 * (`evidenceRef: input.evidenceUrl ?? \`Control de alcotest ${id}\``).
 */
export async function fulfillAlcotestSlotTx(
  tx: Tx,
  input: {
    slotId: string
    worksiteId: string
    userId: string
    testId?: string
    dispatchId?: string
  },
) {
  const [slot] = await tx.select().from(preventionAlcotestSlots)
    .where(eq(preventionAlcotestSlots.id, input.slotId)).limit(1)
  if (!slot) throw new AlcotestSlotError(SLOT_NOT_FOUND)
  if (slot.worksiteId !== input.worksiteId) {
    throw new AlcotestSlotError("La casilla pertenece a otra faena.")
  }
  if (slot.status === "completed") {
    throw new AlcotestSlotError("Esa casilla ya está cumplida.")
  }
  const expectedKind: AlcotestSlotKind = input.dispatchId ? "envio" : "control"
  if (slot.kind !== expectedKind) {
    throw new AlcotestSlotError(
      expectedKind === "envio"
        ? "Esa casilla es de control de alcotest, no de envío de registros."
        : "Esa casilla es de envío de registros, no de control de alcotest.",
    )
  }

  const [evidence] = await tx.select({ id: preventionAlcotestSlotEvidence.id })
    .from(preventionAlcotestSlotEvidence)
    .where(and(
      eq(preventionAlcotestSlotEvidence.slotId, slot.id),
      eq(preventionAlcotestSlotEvidence.state, "active"),
    ))
    .limit(1)
  if (!evidence) {
    throw new AlcotestSlotError(
      "Adjunta la evidencia del cumplimiento antes de marcar la casilla: sin respaldo no se puede declarar hecha.",
    )
  }

  const now = new Date().toISOString()
  const [updated] = await tx.update(preventionAlcotestSlots).set({
    status: "completed",
    testId: input.testId ?? null,
    dispatchId: input.dispatchId ?? null,
    completedAt: now,
    completedByUserId: input.userId,
    notApplicableAt: null,
    notApplicableByUserId: null,
    notApplicableReason: null,
    version: slot.version + 1,
    updatedAt: now,
  }).where(eq(preventionAlcotestSlots.id, slot.id)).returning()
  if (!updated) throw new AlcotestSlotError("No se pudo cumplir la casilla.")
  return updated
}

/**
 * La referencia de evidencia con la que se acredita el PDTP: la ruta del
 * archivo más reciente, no un rótulo inventado.
 *
 * Un `evidenceRef` sintético pasa el motor de acreditación pero no sirve ante
 * un fiscalizador, que es el único lector que importa.
 */
export async function resolveAlcotestSlotEvidenceRef(tx: Tx, slotId: string): Promise<string | null> {
  const [row] = await tx.select({ storagePath: preventionAlcotestSlotEvidence.storagePath })
    .from(preventionAlcotestSlotEvidence)
    .where(and(
      eq(preventionAlcotestSlotEvidence.slotId, slotId),
      eq(preventionAlcotestSlotEvidence.state, "active"),
    ))
    .orderBy(desc(preventionAlcotestSlotEvidence.uploadedAt))
    .limit(1)
  return row?.storagePath ?? null
}

/**
 * Registra en base la evidencia ya escrita en disco.
 *
 * El archivo lo escribe la ruta de subida, que también calcula el sha256 en
 * servidor y borra el archivo si esta transacción falla — el mismo aparato que
 * usa `uploadTrainingOccurrenceEvidence`.
 */
export async function attachAlcotestSlotEvidenceTx(
  tx: Tx,
  input: {
    slotId: string
    fileName: string
    storagePath: string
    mimeType: string
    fileSizeBytes: number
    sha256: string
    uploadedByUserId: string
  },
) {
  const [slot] = await tx.select().from(preventionAlcotestSlots)
    .where(eq(preventionAlcotestSlots.id, input.slotId)).limit(1)
  if (!slot) throw new AlcotestSlotError(SLOT_NOT_FOUND)
  /* Subir evidencia a una casilla declarada no aplicable es contradictorio: o
   * no correspondía hacerla, o sí y hay que corregir el estado primero. Es el
   * mismo rechazo que ya hace capacitación. */
  if (slot.status === "not_applicable") {
    throw new AlcotestSlotError(
      "La casilla está declarada no aplicable. Corrige su estado antes de adjuntar evidencia.",
    )
  }

  const [created] = await tx.insert(preventionAlcotestSlotEvidence).values({
    id: `alcev-${nanoid()}`,
    slotId: input.slotId,
    fileName: input.fileName,
    storagePath: input.storagePath,
    mimeType: input.mimeType,
    fileSizeBytes: input.fileSizeBytes,
    sha256: input.sha256,
    state: "active",
    uploadedByUserId: input.uploadedByUserId,
  }).returning()
  return created!
}

/** El hecho que cumple una casilla, para mostrarlo junto a ella. */
export async function resolveAlcotestSlotFacts(
  slots: AlcotestSlotView[],
  client: Client = db,
) {
  const testIds = slots.map((slot) => slot.testId).filter((id): id is string => Boolean(id))
  const dispatchIds = slots.map((slot) => slot.dispatchId).filter((id): id is string => Boolean(id))

  const [tests, dispatches] = await Promise.all([
    testIds.length === 0 ? [] : client.select({
      id: alcoholTests.id,
      performedAt: alcoholTests.performedAt,
      result: alcoholTests.result,
    }).from(alcoholTests).where(inArray(alcoholTests.id, testIds)),
    dispatchIds.length === 0 ? [] : client.select({
      id: alcoholTestDispatches.id,
      sentAt: alcoholTestDispatches.sentAt,
      recipient: alcoholTestDispatches.recipient,
    }).from(alcoholTestDispatches).where(inArray(alcoholTestDispatches.id, dispatchIds)),
  ])

  return {
    tests: new Map(tests.map((row) => [row.id, row])),
    dispatches: new Map(dispatches.map((row) => [row.id, row])),
  }
}

/* ── Subida de evidencia ──────────────────────────────────────────────────── */

/** 25 MB por archivo, igual que capacitación y simulacros. */
export const ALCOTEST_EVIDENCE_MAX_FILE_SIZE = 25 * 1024 * 1024
/** Margen sobre el límite de archivo para el sobre multipart. */
export const ALCOTEST_EVIDENCE_MAX_REQUEST_SIZE = ALCOTEST_EVIDENCE_MAX_FILE_SIZE + 1024 * 1024

export type UploadAlcotestSlotEvidenceInput = {
  slotId: string
  fileName: string
  fileSize: number
  buffer: Uint8Array
}

/**
 * Escribe el archivo y lo registra, o no deja rastro de ninguno de los dos.
 *
 * El sha256 se calcula **en servidor** sobre el buffer recibido: un hash que
 * manda el cliente no prueba nada sobre lo que quedó en disco. Y si la
 * transacción falla, el archivo se borra — si no, quedaría un huérfano que
 * ningún inventario reclama.
 */
export async function uploadAlcotestSlotEvidence(
  input: UploadAlcotestSlotEvidenceInput,
  access: { userId: string; scope: WorksiteScope },
) {
  const fileName = input.fileName.trim()
  if (!fileName || fileName.length > 255) throw new AlcotestSlotError("El nombre del archivo no es válido.")
  if (!Number.isSafeInteger(input.fileSize) || input.fileSize <= 0) {
    throw new AlcotestSlotError("El tamaño del archivo no es válido.")
  }
  if (input.fileSize > ALCOTEST_EVIDENCE_MAX_FILE_SIZE) {
    throw new AlcotestSlotError(
      `El archivo supera el máximo permitido de ${Math.round(ALCOTEST_EVIDENCE_MAX_FILE_SIZE / 1024 / 1024)} MB.`,
    )
  }
  if (input.buffer.byteLength !== input.fileSize) {
    throw new AlcotestSlotError("El contenido del archivo no coincide con su tamaño declarado.")
  }

  /* Rechazar antes de escribir evita el archivo huérfano cuando la casilla no
   * existe o está fuera de alcance. La transacción repite la comprobación para
   * conservar la garantía de carrera. */
  const [preflight] = await db.select().from(preventionAlcotestSlots)
    .where(eq(preventionAlcotestSlots.id, input.slotId)).limit(1)
  if (!preflight) throw new AlcotestSlotError(SLOT_NOT_FOUND)
  assertWorksiteAccess(preflight.worksiteId, access.scope)
  if (preflight.status === "not_applicable") {
    throw new AlcotestSlotError(
      "La casilla está declarada no aplicable. Corrige su estado antes de adjuntar evidencia.",
    )
  }

  const validation = validateFileBuffer(input.buffer, input.fileSize, MimeType.INSPECTION_DOCUMENT, fileName)
  if (validation.error) throw new AlcotestSlotError(validation.error)

  const storageName = generateStorageName(fileName)
  const relativePath = createPreventionAlcotestEvidencePath(storageName)
  const directory = resolvePreventionAlcotestEvidenceDir()
  const absolutePath = resolveStorageFile(directory, storageName)
  const sha256 = createHash("sha256").update(input.buffer).digest("hex")

  await mkdirp(directory)
  await writeBuffer(absolutePath, Buffer.from(input.buffer))

  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx.select().from(preventionAlcotestSlots)
        .where(eq(preventionAlcotestSlots.id, input.slotId)).limit(1)
      if (!current) throw new AlcotestSlotError(SLOT_NOT_FOUND)
      assertWorksiteAccess(current.worksiteId, access.scope)

      const created = await attachAlcotestSlotEvidenceTx(tx, {
        slotId: input.slotId,
        fileName,
        storagePath: relativePath,
        mimeType: validation.mimeType,
        fileSizeBytes: input.fileSize,
        sha256,
        uploadedByUserId: access.userId,
      })

      await recordAudit({
        userId: access.userId,
        action: "create",
        entityType: "alcotest_slot_evidence",
        entityId: created.id,
        newState: {
          slotId: input.slotId,
          kind: current.kind,
          fileName,
          storagePath: relativePath,
          mimeType: validation.mimeType,
          fileSizeBytes: input.fileSize,
          sha256,
        },
        reason: "Evidencia adjuntada a una casilla del programa de alcotest.",
      }, tx)
      return created
    })
  } catch (error) {
    await removeFile(absolutePath).catch(() => {})
    throw error
  }
}

/**
 * La evidencia por su nombre de almacenamiento, acotada al alcance del usuario.
 *
 * Se resuelve por `storagePath` y no por id: la ruta de descarga recibe el
 * nombre del archivo, y el JOIN a la casilla es lo que impide que alguien
 * descargue evidencia de una faena que no le corresponde conociendo el nombre.
 */
export async function getAlcotestSlotEvidenceForDownload(
  storageName: string,
  scope: WorksiteScope,
) {
  if (scope !== "all" && scope.length === 0) return null
  const relativePath = createPreventionAlcotestEvidencePath(storageName)
  const [row] = await db.select({
    evidence: preventionAlcotestSlotEvidence,
    worksiteId: preventionAlcotestSlots.worksiteId,
  })
    .from(preventionAlcotestSlotEvidence)
    .innerJoin(preventionAlcotestSlots, eq(preventionAlcotestSlotEvidence.slotId, preventionAlcotestSlots.id))
    .where(eq(preventionAlcotestSlotEvidence.storagePath, relativePath))
    .limit(1)
  if (!row) return null
  if (scope !== "all" && !scope.includes(row.worksiteId)) return null
  return row
}

/** Los tipos que el navegador puede mostrar sin descargar. */
export function alcotestEvidenceContentDisposition(mimeType: string): "inline" | "attachment" {
  return mimeType === "application/pdf" || mimeType === "image/jpeg" || mimeType === "image/png"
    ? "inline"
    : "attachment"
}
