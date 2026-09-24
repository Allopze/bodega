/**
 * Evaluación de una carpeta documental exigida por una actividad del PDTP
 * (N°19, "Mantener carpetas de requisitos legales").
 *
 * Puro: recibe los requisitos y los documentos candidatos ya cargados y decide,
 * requisito por requisito, si la faena lo tiene al día. No sabe de base de
 * datos ni de programa; el conector (`legal-folder-connector.ts`) arma la
 * entrada y decide qué hacer con el resultado.
 */

export type LegalFolderRequirement = {
  documentTypeId: string
  documentTypeName: string
  scope: "faena" | "corporativo"
  /** El documento cuenta sólo si es posterior (o del mismo día) al vigente de este tipo. */
  mustFollowDocumentTypeId: string | null
}

export type LegalFolderCandidate = {
  documentId: string
  title: string
  typeId: string
  worksiteId: string | null
  /** Estado del documento (`vigente`, `borrador`, `archivado`…). */
  status: string
  expiresAt: string | null
  /** Versión vigente, si el documento tiene una. */
  currentVersion: {
    id: string
    version: number
    status: string
    /** Día civil desde el que rige: `effectiveFrom`, o el día en que quedó vigente. */
    effectiveDate: string
    checksum: string
  } | null
  /** Hay una versión cargada que todavía no queda vigente (borrador, revisión, aprobada). */
  hasVersionInProgress: boolean
}

/**
 * `vigente`       el requisito se cumple.
 * `desactualizado` hay un documento vigente, pero es anterior al del tipo que
 *                 debe seguir (una carta conductora de un RIOHS anterior).
 * `vencido`       el documento vigente ya venció.
 * `en_tramite`    hay una versión cargada que todavía no queda vigente.
 * `falta`         no hay ningún documento de ese tipo para la faena.
 */
export type LegalFolderItemState = "vigente" | "desactualizado" | "vencido" | "en_tramite" | "falta"

export type LegalFolderItem = {
  requirement: LegalFolderRequirement
  state: LegalFolderItemState
  document: {
    documentId: string
    title: string
    worksiteId: string | null
    versionId: string | null
    version: number | null
    effectiveDate: string | null
    expiresAt: string | null
    checksum: string | null
  } | null
}

export type LegalFolderAssessment = {
  items: LegalFolderItem[]
  satisfied: number
  total: number
  /** Todos los requisitos vigentes. Una carpeta sin requisitos nunca está completa. */
  complete: boolean
}

const STATE_RANK: Record<LegalFolderItemState, number> = {
  vigente: 0,
  desactualizado: 1,
  vencido: 2,
  en_tramite: 3,
  falta: 4,
}

/** Un documento es de la carpeta de la faena si es suyo o, en requisitos corporativos, de la empresa. */
function belongsToFolder(candidate: LegalFolderCandidate, requirement: Pick<LegalFolderRequirement, "scope">, worksiteId: string): boolean {
  if (candidate.worksiteId === worksiteId) return true
  return requirement.scope === "corporativo" && candidate.worksiteId === null
}

function isCurrentlyValid(candidate: LegalFolderCandidate, today: string): boolean {
  return candidate.status === "vigente"
    && candidate.currentVersion?.status === "vigente"
    && !(candidate.expiresAt && candidate.expiresAt < today)
}

/**
 * El mejor documento de un tipo para la faena: vigente antes que vencido, y
 * entre dos del mismo estado, el más reciente. Un documento archivado no
 * cuenta nunca.
 */
function bestCandidate(
  candidates: LegalFolderCandidate[],
  requirement: Pick<LegalFolderRequirement, "documentTypeId" | "scope">,
  worksiteId: string,
  today: string,
) {
  const own = candidates.filter((candidate) => candidate.typeId === requirement.documentTypeId
    && candidate.status !== "archivado"
    && belongsToFolder(candidate, requirement, worksiteId))
  const scored = own.map((candidate) => {
    const state: Exclude<LegalFolderItemState, "desactualizado"> = isCurrentlyValid(candidate, today)
      ? "vigente"
      : candidate.status === "vigente" && candidate.currentVersion?.status === "vigente"
        ? "vencido"
        : candidate.hasVersionInProgress
          ? "en_tramite"
          : "falta"
    return { candidate, state }
  })
  scored.sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state]
    || (b.candidate.currentVersion?.effectiveDate ?? "").localeCompare(a.candidate.currentVersion?.effectiveDate ?? ""))
  return scored[0] ?? null
}

export function assessLegalFolder(input: {
  requirements: LegalFolderRequirement[]
  candidates: LegalFolderCandidate[]
  worksiteId: string
  /** Día civil chileno "YYYY-MM-DD". */
  today: string
}): LegalFolderAssessment {
  const requirementByType = new Map(input.requirements.map((requirement) => [requirement.documentTypeId, requirement]))

  // Fecha del documento vigente de cada tipo "ancla" (el RIOHS), resuelta con
  // el alcance que ese tipo tiene en la carpeta o, si no está en ella, con
  // alcance corporativo.
  const anchorDate = (typeId: string): string | null => {
    const anchorRequirement = requirementByType.get(typeId) ?? { documentTypeId: typeId, scope: "corporativo" as const }
    const best = bestCandidate(input.candidates, anchorRequirement, input.worksiteId, input.today)
    return best && best.state === "vigente" ? best.candidate.currentVersion?.effectiveDate ?? null : null
  }

  const items: LegalFolderItem[] = input.requirements.map((requirement) => {
    const best = bestCandidate(input.candidates, requirement, input.worksiteId, input.today)
    if (!best) return { requirement, state: "falta", document: null }
    let state: LegalFolderItemState = best.state
    if (state === "vigente" && requirement.mustFollowDocumentTypeId) {
      const anchor = anchorDate(requirement.mustFollowDocumentTypeId)
      const own = best.candidate.currentVersion?.effectiveDate ?? null
      // Sin ancla vigente no hay contra qué comparar: la carpeta ya está
      // incompleta por el ancla misma si la exige, y si no la exige, el
      // documento vale por sí solo.
      if (anchor && own && own < anchor) state = "desactualizado"
    }
    const version = best.candidate.currentVersion
    return {
      requirement,
      state,
      document: {
        documentId: best.candidate.documentId,
        title: best.candidate.title,
        worksiteId: best.candidate.worksiteId,
        versionId: version?.id ?? null,
        version: version?.version ?? null,
        effectiveDate: version?.effectiveDate ?? null,
        expiresAt: best.candidate.expiresAt,
        checksum: version?.checksum ?? null,
      },
    }
  })

  const satisfied = items.filter((item) => item.state === "vigente").length
  return {
    items,
    satisfied,
    total: items.length,
    complete: items.length > 0 && satisfied === items.length,
  }
}

const STATE_LABEL: Record<LegalFolderItemState, string> = {
  vigente: "Vigente",
  desactualizado: "Anterior al RIOHS vigente",
  vencido: "Vencido",
  en_tramite: "En trámite",
  falta: "Falta",
}

export function legalFolderItemStateLabel(state: LegalFolderItemState): string {
  return STATE_LABEL[state]
}

/**
 * Texto de evidencia de una carpeta completa: qué documento y qué versión
 * sostuvieron la acreditación. Va en `evidenceRef` porque es lo único que el
 * libro de cumplimiento conserva al reintentar.
 */
export function describeLegalFolderEvidence(assessment: LegalFolderAssessment, asOf: string): string {
  const lines = assessment.items.map((item) => {
    const doc = item.document
    const detail = doc
      ? `${doc.title} v${doc.version ?? "?"}${doc.expiresAt ? ` (vence ${doc.expiresAt})` : ""}`
      : "sin documento"
    return `${item.requirement.documentTypeName}: ${detail}`
  })
  return `Carpeta de requisitos legales completa al ${asOf}. ${lines.join("; ")}.`.slice(0, 2000)
}
