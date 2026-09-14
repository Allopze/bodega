/**
 * Qué se acepta como evidencia.
 *
 * Patrón P4 de la auditoría 2026-09-14. La plataforma tenía **dos** ideas de
 * evidencia conviviendo:
 *
 *  - La rigurosa, en la evidencia de un hallazgo de inspección: la ruta se
 *    valida con expresión regular contra su directorio de storage —porque la
 *    produce la ruta de subida, nunca el usuario—, hay tamaño máximo y el
 *    SHA-256 es obligatorio.
 *  - La laxa, en todo lo demás: una cadena de 3 a 4000 caracteres con el tipo
 *    declarado por el cliente. Escribir `kind: "photo"`, `reference: "foto
 *    tomada en terreno"` bastaba para habilitar la verificación y el cierre de
 *    una CAPA (`CAPA-001`), y esa CAPA es lo que otros módulos usan como prueba
 *    —una mantención la acredita, un PPA no se autoriza sin ella, un requisito
 *    legal no se declara cumplido con la suya abierta—.
 *
 * El estándar ya estaba escrito; lo que faltaba era que fuera **uno**. Aquí
 * está, y la regla de fondo es simple: **lo que dice ser un archivo tiene que
 * serlo.**
 *
 *  - `document` y `photo` afirman que existe un archivo almacenado: exigen ruta
 *    validada contra su directorio y checksum de 64 hex.
 *  - `url` afirma que hay algo en otra parte: se exige que sea una URL de
 *    verdad, no cualquier texto.
 *  - `note` no afirma nada de eso: es una anotación y se admite libre —por eso
 *    los gates de verificación ya la excluían—.
 */

import { z } from "zod"

/**
 * Los directorios de evidencia que la plataforma **tiene de verdad**. Sólo dos:
 * el de inspecciones y el de PDTP, que es donde la subida deposita los archivos
 * de seguimiento y de plan de acción.
 *
 * No se inventan directorios por dominio: la tabla de evidencia de CAPA agrega
 * lo que llega de varios orígenes —una inspección, una mantención, un
 * seguimiento PDTP— y exigirle un prefijo propio habría rechazado archivos
 * legítimos que ya existen. Lo que el contrato garantiza no es «este archivo es
 * de este módulo» sino algo más útil y comprobable: **la ruta apunta a un
 * directorio de evidencia de la plataforma y no se sale de él**.
 */
export const EVIDENCE_STORAGE_PREFIXES = {
  inspection: "storage/inspection-evidence",
  pdtp: "storage/pdtp-evidence",
} as const

export type EvidenceDomain = keyof typeof EVIDENCE_STORAGE_PREFIXES

/** Todos los prefijos, para quien acepta evidencia de cualquier origen. */
export const ALL_EVIDENCE_DOMAINS = Object.keys(EVIDENCE_STORAGE_PREFIXES) as EvidenceDomain[]

/** Un nombre de archivo, sin travesía de directorios ni caracteres raros. */
const FILE_SEGMENT = /^[A-Za-z0-9._-]+$/

function isStoredFile(value: string, domains: readonly EvidenceDomain[]): boolean {
  return domains.some((domain) => {
    const prefix = EVIDENCE_STORAGE_PREFIXES[domain]
    if (!value.startsWith(`${prefix}/`)) return false
    const name = value.slice(prefix.length + 1)
    return FILE_SEGMENT.test(name)
  })
}

export function evidencePathSchema(domains: readonly EvidenceDomain[] = ALL_EVIDENCE_DOMAINS) {
  const esperados = domains.map((d) => `${EVIDENCE_STORAGE_PREFIXES[d]}/`).join(" o ")
  return z.string().trim().refine(
    (value) => isStoredFile(value, domains),
    `La ruta de evidencia debe apuntar a ${esperados}`,
  )
}

/** SHA-256 en hexadecimal, tal como lo exige la evidencia de inspección. */
export const checksumSchema = z.string()
  .regex(/^[a-f0-9]{64}$/, "El checksum debe ser un SHA-256 de 64 caracteres hexadecimales")

export type EvidenceKind = "document" | "photo" | "url" | "note"

/** Los tipos que afirman la existencia de un archivo almacenado. */
export const FILE_EVIDENCE_KINDS: ReadonlySet<EvidenceKind> = new Set(["document", "photo"])

export interface EvidenceInput {
  kind: EvidenceKind
  reference: string
  checksumSha256?: string | null
}

export interface EvidenceProblem {
  field: "reference" | "checksumSha256"
  message: string
}

/**
 * Comprueba una evidencia contra el contrato. Devuelve los problemas en vez de
 * lanzar, para que cada llamador los presente donde corresponda —un campo de
 * formulario, un error de acción, un rechazo de servicio—.
 */
export function checkEvidence(
  input: EvidenceInput,
  domains: readonly EvidenceDomain[] = ALL_EVIDENCE_DOMAINS,
): EvidenceProblem[] {
  const problems: EvidenceProblem[] = []
  const reference = (input.reference ?? "").trim()

  if (FILE_EVIDENCE_KINDS.has(input.kind)) {
    const path = evidencePathSchema(domains).safeParse(reference)
    if (!path.success) {
      problems.push({
        field: "reference",
        message: path.error.issues[0]?.message ?? "Ruta de evidencia inválida",
      })
    }
    const checksum = checksumSchema.safeParse(input.checksumSha256 ?? "")
    if (!checksum.success) {
      problems.push({
        field: "checksumSha256",
        message: "Un documento o una fotografía exigen el checksum del archivo almacenado",
      })
    }
    return problems
  }

  if (input.kind === "url") {
    // `URL` acepta cualquier esquema; aquí interesa que sea alcanzable desde un
    // navegador, no un `javascript:` ni un `file:`.
    let parsed: URL | null = null
    try { parsed = new URL(reference) } catch { parsed = null }
    if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
      problems.push({ field: "reference", message: "La evidencia de tipo enlace debe ser una URL http o https" })
    }
    return problems
  }

  // `note`: una anotación, y se dice como tal. No sostiene una verificación
  // —los gates ya la excluyen— así que sólo se le pide que diga algo.
  if (reference.length < 3) {
    problems.push({ field: "reference", message: "Escribe la anotación" })
  }
  return problems
}

/** El primer problema como mensaje, para quien sólo puede mostrar uno. */
export function describeEvidenceProblems(problems: readonly EvidenceProblem[]): string | null {
  return problems[0]?.message ?? null
}

/**
 * Qué **es** realmente una referencia, para quien la recibe sin tipo fiable.
 *
 * Al aplicar este contrato a PDTP salió a la luz que su
 * `addFollowup` guardaba `evidenciaUrl` con `kind: "document"` y
 * `evidenciaPhotos` con `kind: "photo"`, fuera lo que fuera su contenido: una
 * URL etiquetada como documento es el mismo mal etiquetado que este patrón
 * describe, sólo que del lado del escritor en vez del formulario.
 *
 * Clasificar por el contenido y no por el nombre del campo es lo único honesto
 * cuando el llamador no puede saberlo: una ruta del storage es un archivo, una
 * URL es un enlace, y cualquier otra cosa es una anotación —que se admite, pero
 * dice lo que es y no sostiene una verificación—.
 */
export function classifyEvidence(
  reference: string,
  prefer: "document" | "photo" = "document",
  domains: readonly EvidenceDomain[] = ALL_EVIDENCE_DOMAINS,
): EvidenceKind {
  const value = (reference ?? "").trim()
  if (isStoredFile(value, domains)) return prefer
  if (checkEvidence({ kind: "url", reference: value }, domains).length === 0) return "url"
  return "note"
}
