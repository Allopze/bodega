/**
 * lib/services/pdtp/integration-evidence.ts
 *
 * ¿La evidencia que trae un hecho de otro módulo existe de verdad?
 *
 * PRV-01 (auditoría 2026-09-28): la acreditación automática decidía que había
 * "evidencia real" por la forma del texto —empieza con `storage/` o es una URL
 * http(s)— y con eso auto-aprobaba la ejecución PDTP marcándola
 * `evidenceStatus = "provided"`. Se demostró que un acta CGRD con una ruta a un
 * archivo inexistente y un simulacro con `https://x` quedaban aprobados solos.
 *
 * Aquí "verificada" significa las tres cosas a la vez:
 *
 * 1. la ruta está en el directorio de evidencia **de esa fuente** (un archivo
 *    de higiene no respalda un acta del CGRD);
 * 2. hay una fila de dueño que la plataforma escribió al subirla, ligada a la
 *    **misma faena** del hecho (la tabla de evidencia de cada módulo, o
 *    `prevention_evidence_uploads` para el CGRD);
 * 3. el archivo existe en disco y, cuando la fila guardó su sha256, el
 *    contenido todavía coincide.
 *
 * Una URL externa nunca verifica: la plataforma no puede afirmar qué hay del
 * otro lado del enlace.
 */

import { createHash } from "node:crypto"
import { access, readFile } from "node:fs/promises"
import { and, eq } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  preventionAlcotestSlotEvidence,
  preventionAlcotestSlots,
  preventionEmergencyDrillEvidence,
  preventionEmergencyDrills,
  preventionEvidenceUploads,
  preventionExposureGroups,
  preventionExposureMeasurements,
  preventionHygieneMeasurementEvidence,
  sstDocuments,
  sstDocumentVersions,
} from "@/db/schema"
import {
  resolveCampaignEvidenceFile,
  resolveCapaEvidenceFile,
  resolveCgrdEvidenceFile,
  resolveDeliveryAttachmentFile,
  resolveHygieneEvidenceFile,
  resolveInspectionEvidenceFile,
  resolvePdtpEvidenceFile,
  resolvePreventionAlcotestEvidenceFile,
  resolvePreventionDrillEvidenceFile,
  resolvePreventionTrainingEvidenceFile,
  resolveSstDocumentFile,
} from "@/lib/storage/config"
import type { PdtpAccreditationSourceType } from "./accreditation"

type Client = DB | Tx

export type IntegrationEvidenceCheck =
  | { verified: true; sha256: string }
  | { verified: false; reason: IntegrationEvidenceRejection }

export type IntegrationEvidenceRejection =
  | "missing"
  | "external_url"
  | "wrong_domain"
  | "not_registered"
  | "other_worksite"
  | "file_missing"
  | "checksum_mismatch"

/** Fuentes cuya auto-aprobación depende de traer evidencia verificada. */
type VerifiableSource = "alcotest" | "emergencia" | "cgrd" | "higiene" | "engagement"

type Owner = { sha256: string | null; worksiteId: string | null; allowCorporate?: boolean }

const VERIFIERS: Record<VerifiableSource, {
  resolve: (path: string) => string | null
  loadOwner: (client: Client, path: string) => Promise<Owner | null>
}> = {
  alcotest: {
    resolve: (path) => resolvePreventionAlcotestEvidenceFile(path),
    loadOwner: async (client, path) => {
      const [row] = await client.select({ sha256: preventionAlcotestSlotEvidence.sha256, worksiteId: preventionAlcotestSlots.worksiteId })
        .from(preventionAlcotestSlotEvidence)
        .innerJoin(preventionAlcotestSlots, eq(preventionAlcotestSlots.id, preventionAlcotestSlotEvidence.slotId))
        .where(and(eq(preventionAlcotestSlotEvidence.storagePath, path), eq(preventionAlcotestSlotEvidence.state, "active")))
        .limit(1)
      return row ?? null
    },
  },
  emergencia: {
    resolve: (path) => resolvePreventionDrillEvidenceFile(path),
    loadOwner: async (client, path) => {
      const [row] = await client.select({ sha256: preventionEmergencyDrillEvidence.sha256, worksiteId: preventionEmergencyDrills.worksiteId })
        .from(preventionEmergencyDrillEvidence)
        .innerJoin(preventionEmergencyDrills, eq(preventionEmergencyDrills.id, preventionEmergencyDrillEvidence.drillId))
        .where(and(eq(preventionEmergencyDrillEvidence.storagePath, path), eq(preventionEmergencyDrillEvidence.state, "active")))
        .limit(1)
      return row ?? null
    },
  },
  cgrd: {
    resolve: (path) => resolveCgrdEvidenceFile(path),
    loadOwner: async (client, path) => {
      const [row] = await client.select({ sha256: preventionEvidenceUploads.sha256, worksiteId: preventionEvidenceUploads.worksiteId })
        .from(preventionEvidenceUploads)
        .where(and(eq(preventionEvidenceUploads.path, path), eq(preventionEvidenceUploads.domain, "cgrd")))
        .limit(1)
      return row ?? null
    },
  },
  higiene: {
    resolve: (path) => resolveHygieneEvidenceFile(path),
    loadOwner: async (client, path) => {
      const [row] = await client.select({ sha256: preventionHygieneMeasurementEvidence.sha256, worksiteId: preventionExposureGroups.worksiteId })
        .from(preventionHygieneMeasurementEvidence)
        .innerJoin(preventionExposureMeasurements, eq(preventionExposureMeasurements.id, preventionHygieneMeasurementEvidence.measurementId))
        .innerJoin(preventionExposureGroups, eq(preventionExposureGroups.id, preventionExposureMeasurements.groupId))
        .where(and(eq(preventionHygieneMeasurementEvidence.storagePath, path), eq(preventionHygieneMeasurementEvidence.state, "active")))
        .limit(1)
      return row ?? null
    },
  },
  engagement: {
    resolve: (path) => resolveSstDocumentFile(path),
    loadOwner: async (client, path) => {
      // Un documento corporativo (sin faena) respalda la coordinación de
      // cualquier faena: es el mismo documento para todas.
      const [row] = await client.select({ sha256: sstDocumentVersions.checksum, worksiteId: sstDocuments.worksiteId })
        .from(sstDocumentVersions)
        .innerJoin(sstDocuments, eq(sstDocuments.id, sstDocumentVersions.documentId))
        .where(eq(sstDocumentVersions.filePath, path))
        .limit(1)
      return row ? { ...row, allowCorporate: true } : null
    },
  },
}

export function isVerifiableIntegrationSource(sourceType: PdtpAccreditationSourceType): sourceType is VerifiableSource {
  return sourceType in VERIFIERS
}

export async function verifyIntegrationEvidence(
  input: { ref: string | null | undefined; sourceType: VerifiableSource; worksiteId: string },
  client: Client = db,
): Promise<IntegrationEvidenceCheck> {
  const ref = input.ref?.trim()
  if (!ref) return { verified: false, reason: "missing" }
  if (/^https?:\/\//i.test(ref)) return { verified: false, reason: "external_url" }

  const verifier = VERIFIERS[input.sourceType]
  const absolute = verifier.resolve(ref)
  if (!absolute) return { verified: false, reason: "wrong_domain" }

  const owner = await verifier.loadOwner(client, ref)
  if (!owner) return { verified: false, reason: "not_registered" }
  const sameWorksite = owner.worksiteId === input.worksiteId || (owner.allowCorporate === true && owner.worksiteId === null)
  if (!sameWorksite) return { verified: false, reason: "other_worksite" }

  let content: Buffer
  try {
    content = await readFile(absolute)
  } catch {
    return { verified: false, reason: "file_missing" }
  }
  const sha256 = createHash("sha256").update(content).digest("hex")
  if (owner.sha256 && owner.sha256 !== sha256) return { verified: false, reason: "checksum_mismatch" }
  return { verified: true, sha256 }
}

// Función y no constante: se evalúa al usarse, así que las pruebas que simulan
// `@/lib/storage/config` sólo en parte no fallan al importar este módulo.
const anyEvidenceResolvers = () => [
  resolvePdtpEvidenceFile,
  resolveInspectionEvidenceFile,
  resolvePreventionTrainingEvidenceFile,
  resolvePreventionDrillEvidenceFile,
  resolvePreventionAlcotestEvidenceFile,
  resolveHygieneEvidenceFile,
  resolveCgrdEvidenceFile,
  resolveCampaignEvidenceFile,
  resolveCapaEvidenceFile,
  resolveSstDocumentFile,
  resolveDeliveryAttachmentFile,
]

/**
 * Para las fuentes que nunca se auto-aprueban (documentos, CPHS, EPP…): la
 * ejecución sólo puede afirmar `evidenceStatus = "provided"` si la ruta apunta
 * a un archivo de la plataforma que existe. Sin esto, una ruta rota se leía
 * como evidencia entregada y se aprobaba sin motivo.
 */
export async function storageEvidenceExists(ref: string | null | undefined): Promise<boolean> {
  const value = ref?.trim()
  if (!value?.startsWith("storage/")) return false
  for (const resolve of anyEvidenceResolvers()) {
    const absolute = resolve(value)
    if (!absolute) continue
    try {
      await access(absolute)
      return true
    } catch {
      return false
    }
  }
  return false
}
