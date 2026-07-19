import { asc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionAccreditationItems,
  preventionAccreditationRequirements,
  preventionContractorWorkers,
  preventionCoordinationParticipants,
} from "@/db/schema"
import {
  ACCREDITATION_ITEM_STATUS_LABELS,
  ACCREDITATION_SCOPE_LABELS,
  CONTRACTOR_RELATIONSHIP_LABELS,
  CONTRACTOR_WORKER_STATUS_LABELS,
  CONTRACT_STATUS_LABELS,
  COORDINATION_STATUS_LABELS,
} from "@/lib/prevention/contractors"
import type { ReportCell, ReportData, ReportSheet } from "@/lib/reports/export"
import {
  listAccreditationGaps,
  listAccreditationRequirements,
  listContractorContracts,
  listCoordinationMeetings,
  type ContractorAccess,
} from "@/lib/services/prevention-contractors"

function safeCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

function sheet(worksheetName: string, headers: string[], rows: ReportCell[][]): ReportSheet {
  return { worksheetName, headers, rows }
}

function label(map: Record<string, string>, key: string | null | undefined) {
  if (!key) return ""
  return map[key] ?? key
}

const GAP_TYPE_LABELS: Record<string, string> = {
  missing: "Nunca presentada",
  submitted_not_approved: "Presentada sin aprobar",
  observed: "Observada",
  expired: "Vencida",
}

/**
 * Registro de faena exportable: es la evidencia que el DS 76 exige tener
 * disponible para la autoridad y para el mandante.
 */
export async function buildContractorExport(access: ContractorAccess): Promise<ReportData> {
  if (!access.permissions.includes("prevention:contractors:export")) {
    throw new Error("Registro de contratistas no encontrado o fuera de alcance.")
  }

  const [contracts, gaps, requirements, meetings] = await Promise.all([
    listContractorContracts(access),
    listAccreditationGaps(access),
    listAccreditationRequirements(access),
    listCoordinationMeetings(access),
  ])

  const contractIds = contracts.map((row) => row.contract.id)
  const meetingIds = meetings.map((row) => row.meeting.id)
  const [workers, items, participants] = await Promise.all([
    contractIds.length === 0 ? [] : db.select().from(preventionContractorWorkers)
      .where(inArray(preventionContractorWorkers.contractId, contractIds))
      .orderBy(asc(preventionContractorWorkers.lastName)),
    contractIds.length === 0 ? [] : db.select({
      item: preventionAccreditationItems,
      requirementCode: preventionAccreditationRequirements.code,
      requirementName: preventionAccreditationRequirements.name,
      appliesTo: preventionAccreditationRequirements.appliesTo,
    })
      .from(preventionAccreditationItems)
      .innerJoin(preventionAccreditationRequirements, eq(preventionAccreditationItems.requirementId, preventionAccreditationRequirements.id))
      .where(inArray(preventionAccreditationItems.contractId, contractIds)),
    meetingIds.length === 0 ? [] : db.select().from(preventionCoordinationParticipants)
      .where(inArray(preventionCoordinationParticipants.meetingId, meetingIds)),
  ])

  const contractCode = new Map(contracts.map((row) => [row.contract.id, row.contract.code]))
  const meetingCode = new Map(meetings.map((row) => [row.meeting.id, row.meeting.code]))

  const sheets: ReportSheet[] = [
    sheet(
      "Registro de faena",
      ["Contrato", "Empresa", "RUT", "Faena", "Relación", "Estado", "Acceso", "Motivo del bloqueo", "Inicio", "Término", "Dotación planificada", "Personas", "Acreditadas"],
      contracts.map((row) => [
        safeCell(row.contract.code),
        safeCell(row.companyName),
        safeCell(row.companyRut),
        safeCell(row.worksiteName),
        label(CONTRACTOR_RELATIONSHIP_LABELS, row.contract.relationship),
        label(CONTRACT_STATUS_LABELS, row.contract.status),
        row.contract.accessBlocked ? "Bloqueado" : "Liberado",
        safeCell(row.contract.accessBlockReason),
        row.contract.startsOn,
        row.contract.endsOn,
        row.contract.plannedHeadcount,
        row.workerCount,
        row.accreditedCount,
      ]),
    ),
    sheet(
      "Personas del contratista",
      ["Contrato", "RUT", "Apellidos", "Nombres", "Cargo", "Turno", "Estado", "Acceso", "Desde", "Hasta"],
      workers.map((worker) => [
        safeCell(contractCode.get(worker.contractId)),
        safeCell(worker.rut),
        safeCell(worker.lastName),
        safeCell(worker.firstName),
        safeCell(worker.position),
        safeCell(worker.shift),
        label(CONTRACTOR_WORKER_STATUS_LABELS, worker.status),
        worker.accessBlocked ? "Bloqueado" : "Liberado",
        worker.startsOn,
        worker.endsOn,
      ]),
    ),
    sheet(
      "Evidencia de acreditación",
      ["Contrato", "Requisito", "Nombre", "Alcance", "Estado", "Documento", "Checksum", "Emitido", "Vence", "Observación", "Revisado"],
      items.map((row) => [
        safeCell(contractCode.get(row.item.contractId)),
        safeCell(row.requirementCode),
        safeCell(row.requirementName),
        label(ACCREDITATION_SCOPE_LABELS, row.appliesTo),
        label(ACCREDITATION_ITEM_STATUS_LABELS, row.item.status),
        safeCell(row.item.documentReference),
        safeCell(row.item.checksumSha256),
        row.item.issuedOn,
        row.item.expiresOn,
        safeCell(row.item.observation),
        row.item.reviewedAt,
      ]),
    ),
    sheet(
      "Brechas de acreditación",
      ["Contrato", "Sujeto", "Requisito", "Nombre", "Tipo de brecha", "Exigibilidad", "Vence"],
      gaps.map((gap) => [
        safeCell(gap.contractCode),
        safeCell(gap.subjectLabel),
        safeCell(gap.requirementCode),
        safeCell(gap.requirementName),
        label(GAP_TYPE_LABELS, gap.gapType),
        gap.enforcement === "blocking" ? "Bloqueante" : "Advertencia",
        gap.expiresOn,
      ]),
    ),
    sheet(
      "Requisitos exigidos",
      ["Código", "Nombre", "Alcance", "Faena", "Relación", "Exigibilidad", "Exige vencimiento", "Activo", "Fundamento"],
      requirements.map((row) => [
        safeCell(row.requirement.code),
        safeCell(row.requirement.name),
        label(ACCREDITATION_SCOPE_LABELS, row.requirement.appliesTo),
        safeCell(row.worksiteName),
        label(CONTRACTOR_RELATIONSHIP_LABELS, row.requirement.relationship),
        row.requirement.enforcement === "blocking" ? "Bloqueante" : "Advertencia",
        row.requirement.requiresExpiry ? "Sí" : "No",
        row.requirement.isActive ? "Sí" : "No",
        safeCell(row.requirement.legalBasis),
      ]),
    ),
    sheet(
      "Coordinación DS 76",
      ["Código", "Faena", "Fecha", "Asunto", "Estado", "Convocados", "Asistentes", "Intercambio de riesgos", "Acta"],
      meetings.map((row) => [
        safeCell(row.meeting.code),
        safeCell(row.worksiteName),
        row.meeting.heldAt,
        safeCell(row.meeting.subject),
        label(COORDINATION_STATUS_LABELS, row.meeting.status),
        row.convenedCount,
        row.attendedCount,
        safeCell(row.meeting.riskExchangeSummary),
        safeCell(row.meeting.minutes),
      ]),
    ),
    sheet(
      "Asistencia a coordinación",
      ["Reunión", "Contrato", "Asistió"],
      participants.map((participant) => [
        safeCell(meetingCode.get(participant.meetingId)),
        safeCell(contractCode.get(participant.contractId)),
        participant.attended ? "Sí" : "No",
      ]),
    ),
  ]

  return {
    filenameBase: `contratistas_ds76_${new Date().toISOString().slice(0, 10)}`,
    worksheetName: sheets[0]!.worksheetName,
    headers: sheets[0]!.headers,
    rows: sheets[0]!.rows,
    sheets,
  }
}
