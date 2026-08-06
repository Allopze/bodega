export interface DocumentBundle {
  doc: {
    id: string
    title: string
    description: string | null
    internalCode: string | null
    categorySlug: string
    status: string
    confidentiality: string
    dataClass: string
    worksiteId: string | null
    effectiveFrom: string | null
    expiresAt: string | null
    currentVersionId: string | null
    requiresAcknowledgment: boolean
    uploadedBy: string
    reviewedBy: string | null
    approvedBy: string | null
    responsibleUserId: string | null
    tags: unknown
    updatedAt: string
  }
  versions: Array<{
    id: string
    version: number
    status: string
    fileName: string
    filePath: string
    fileSize: number
    mimeType: string
    checksum: string
    effectiveFrom: string | null
    effectiveTo: string | null
    changelog: string | null
    uploadedBy: string
    reviewedBy: string | null
    approvedBy: string | null
    approvedAt: string | null
    createdAt: string
  }>
  links: Array<{
    id: string
    entityType: string
    entityId: string
    notes: string | null
  }>
  acks: Array<{
    id: string
    versionId: string
    userId: string
    signature: string
    acknowledgedAt: string
  }>
  distribution: Array<{
    id: string
    versionId: string
    userId: string | null
    workerId: string | null
    assignmentReason: string
    worksiteId: string | null
    positionSnapshot: string | null
    companySnapshot: string | null
    assignedByUserId: string
    assignedAt: string
    dueAt: string | null
    status: string
    exemptedByUserId: string | null
    exemptedAt: string | null
    exemptionReason: string | null
  }>
  audit: Array<{
    id: string
    action: string
    fromStatus: string | null
    toStatus: string | null
    comment: string | null
    userId: string | null
    versionId: string | null
    createdAt: string
  }>
}

export interface DetailViewProps {
  bundle: DocumentBundle
  userMap: Record<string, { id: string; name: string; email: string }>
  worksiteMap: Record<string, { id: string; name: string }>
  linkEnrichment: Record<string, Record<string, string>>
  canManage: boolean
  canArchive: boolean
  canSubmitReview: boolean
  canReview: boolean
  canApprove: boolean
  canPublish: boolean
  canDistribute: boolean
  canAck: boolean
  canLink: boolean
  recipientOptions: Array<{ id: string; name: string; email: string; workerId: string | null }>
  currentUserId: string
  currentUserName: string
  /**
   * Extra al `router.refresh()` tras cada mutación. El visor rápido lo usa para
   * re-consultar el bundle: su estado local no se entera del refresh del árbol.
   */
  onMutated?: () => void
}
