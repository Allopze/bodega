/**
 * Límites de los anexos del expediente RE-20. Fuente única: la consumen el
 * servicio, las rutas API y el espacio de trabajo (para validar antes de subir).
 */
export const RE20_ATTACHMENT_LIMITS = {
  allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain"],
  /** Por archivo. */
  maxFileBytes: 10 * 1024 * 1024,
  /** Por expediente. */
  maxTotalBytes: 50 * 1024 * 1024,
  maxCount: 100,
} as const

export type Re20AttachmentMimeType = (typeof RE20_ATTACHMENT_LIMITS.allowedMimeTypes)[number]

export const RE20_ATTACHMENT_ACCEPT_MESSAGE = "Adjunta un PDF, JPEG, PNG, WebP o texto de hasta 10 MB."
