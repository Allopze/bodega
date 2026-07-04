export interface DocumentBundle {
  doc: {
    id: string
    title: string
    description: string | null
    internalCode: string | null
    categorySlug: string
    status: string
    confidentiality: string
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
  canApprove: boolean
  canArchive: boolean
  canAck: boolean
  canLink: boolean
  currentUserId: string
  currentUserName: string
}
