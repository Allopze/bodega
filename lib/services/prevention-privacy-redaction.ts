/**
 * PRI-002 (auditoría 2026-09-14) — comprobación de la supresión en un caso
 * reservado.
 *
 * Al suprimir a un titular, el operador reemplaza el payload cifrado del caso
 * por uno redactado. La versión anterior comprobaba una sola cosa: que el texto
 * no contuviera, en minúsculas y de forma literal, el RUT, el nombre o el
 * apellido del titular. Esa comprobación se saltaba sola en casos triviales:
 *
 *  - el RUT se comparaba tal cual está guardado, así que "12.345.678-9" en la
 *    ficha no coincidía con "12345678-9" escrito en el payload (ni al revés);
 *  - los acentos contaban como caracteres distintos: "Muñoz" pasaba si la ficha
 *    decía "Munoz" o si el redactor escribía "MUNOZ";
 *  - un apellido compuesto se comparaba entero, de modo que dejar sólo
 *    "González" de "González Rivas" pasaba;
 *  - el identificador técnico del trabajador —que reidentifica al titular con
 *    una sola consulta— no se miraba.
 *
 * Aquí se normaliza a un alfabeto común (sin tildes, sin puntuación, sin
 * espacios, en minúsculas) los dos lados de la comparación y se amplía el
 * conjunto de identificadores directos a todo lo que la plataforma guarda de la
 * persona y permite volver a nombrarla.
 *
 * DECISIÓN PENDIENTE DE PLATAFORMA: la ficha del hallazgo también nombra
 * referencias INDIRECTAS —el cargo junto con la faena y la fecha, un apodo, el
 * número de un documento asociado—. Son cuasi-identificadores: rechazar todo
 * payload que mencione el cargo o la faena haría inviable redactar un caso que
 * trata precisamente de esa faena, y el umbral de "cuánto contexto es
 * demasiado" es una decisión de la organización, no del código. Mientras no
 * exista esa regla, `findContextualSubjectMarkers` los DETECTA y la ejecución
 * los deja anotados en la auditoría, para que la reidentificación por contexto
 * sea revisable en vez de invisible. Un apodo no se puede comprobar en absoluto:
 * la plataforma no guarda ninguno.
 */

/** Alfabeto común de comparación: sin tildes, sin separadores, en minúsculas. */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]/g, "")
}

/** Longitud mínima de un marcador para no disparar coincidencias accidentales. */
const MIN_MARKER_LENGTH = 3

export interface RedactionSubject {
  id: string
  rut: string | null
  firstName: string
  lastName: string
  position: string | null
}

export interface RedactionContext {
  worksiteName?: string | null
}

function collectMarkers(values: (string | null | undefined)[]): string[] {
  const markers = new Set<string>()
  for (const value of values) {
    if (!value) continue
    const whole = normalize(value)
    if (whole.length >= MIN_MARKER_LENGTH) markers.add(whole)
    // Nombres y apellidos compuestos: cada parte identifica por sí sola.
    for (const part of value.split(/\s+/)) {
      const token = normalize(part)
      if (token.length >= MIN_MARKER_LENGTH) markers.add(token)
    }
  }
  return [...markers]
}

/**
 * Identificadores directos del titular que sobreviven en el payload redactado.
 * Devuelve los marcadores encontrados (vacío = la supresión puede aplicarse).
 */
export function findDirectSubjectMarkers(
  serializedPayload: string,
  subject: RedactionSubject,
): string[] {
  const haystack = normalize(serializedPayload)
  // El id técnico entra igual que el RUT: reidentifica al titular con una sola
  // consulta a `workers`, y antes no se comprobaba.
  const markers = collectMarkers([subject.rut, subject.firstName, subject.lastName, subject.id])
  return markers.filter((marker) => haystack.includes(marker))
}

/**
 * Cuasi-identificadores del titular presentes en el payload. NO bloquean: se
 * registran en la auditoría de la ejecución mientras la organización no declare
 * una regla (ver la nota de decisión pendiente arriba).
 */
export function findContextualSubjectMarkers(
  serializedPayload: string,
  subject: RedactionSubject,
  context: RedactionContext = {},
): string[] {
  const haystack = normalize(serializedPayload)
  const found: string[] = []
  const candidates: [string, string | null | undefined][] = [
    ["cargo", subject.position],
    ["faena", context.worksiteName],
  ]
  for (const [label, value] of candidates) {
    if (!value) continue
    const normalized = normalize(value)
    if (normalized.length >= MIN_MARKER_LENGTH && haystack.includes(normalized)) found.push(label)
  }
  return found
}
