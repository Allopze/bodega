/**
 * Ruta de retorno segura para las pantallas de error.
 *
 * `/forbidden` recibe el origen por query para poder ofrecer "volver a donde
 * estabas" en vez de un salto genérico al panel. Como ese valor llega por la
 * URL, se acepta únicamente una ruta interna: sin esquema, sin host y sin la
 * forma `//host` que el navegador trata como absoluta. Cualquier otra cosa se
 * descarta en silencio y la pantalla cae a su destino por defecto.
 */
export function safeInternalPath(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null
  // Una contrabarra deja que el navegador lea `/\evil.com` como host.
  if (trimmed.includes("\\")) return null
  // Un carácter de control puede partir la cabecera de redirección.
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return null
  }
  return trimmed
}

/** Nombre legible de una sección a partir de su ruta ("/prevencion/capa" → "CAPA"). */
export function sectionLabelFromPath(path: string): string {
  const segment = path.split("?")[0]!.split("/").filter(Boolean).pop() ?? ""
  if (!segment) return "el panel"
  const spaced = decodeURIComponent(segment).replace(/-/g, " ")
  return spaced.length <= 4 ? spaced.toUpperCase() : spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
