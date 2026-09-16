/**
 * lib/services/dte-portal/cached-xml.ts
 *
 * Lectura del XML de un DTE ya descargado y verificado, desde el disco.
 *
 * Vive aparte de `purchase-document-xml.ts` a propósito: ese módulo importa
 * `DtePortalClient` para poder salir al portal, y el cliente arrastra `undici`.
 * La imagen de producción es un build standalone de Next
 * —56 paquetes en `node_modules`, sólo lo que el tracer vio— y ninguno de esos
 * paquete está ahí, así que un one-shot que importe la cadena completa revienta al
 * arrancar con ERR_MODULE_NOT_FOUND. Leer un archivo del disco no necesita un
 * cliente HTTP; separarlo es lo que permite que `backfill-dte-order-refs`
 * exista sin llevarse el portal puesto.
 *
 * Regla al tocar esto: nada de lo que se importe acá puede alcanzar `./client`.
 */

import { promises as fs } from "node:fs"
import { readBuffer } from "@/lib/storage/helpers"
import { resolveDteFile } from "@/lib/storage/config"
import { parseDteXml, type DteData } from "@/lib/services/purchasing-module/dte-parser"

/** Tope de tamaño para un XML de DTE, compartido por la descarga y la lectura. */
export const MAX_DTE_XML_BYTES = 10 * 1024 * 1024

/**
 * Decodifica un XML respetando la codificación que declara.
 *
 * Las declaraciones XML son compatibles con ASCII, así que se inspeccionan como
 * latin1 primero. Los DTE chilenos declaran ISO-8859-1 muy seguido y leerlos
 * como UTF-8 corrompe los nombres de proveedor y producto antes de que el
 * parser los vea.
 */
export function decodeXmlBuffer(buffer: Buffer): string {
  const declaration = buffer.toString("latin1", 0, Math.min(buffer.length, 1024))
  const encoding = declaration.match(/<\?xml[^>]*encoding=["']([^"']+)/i)?.[1]?.toLowerCase()
  if (encoding && /^(iso-8859-1|iso8859-1|latin-?1|windows-1252)$/i.test(encoding)) {
    return buffer.toString("latin1")
  }
  return buffer.toString("utf8")
}

/**
 * Lee y parsea el XML ya verificado en disco. Devuelve null si no está, si no
 * es un archivo, si excede el tope o si no se puede interpretar: quien llama
 * decide si eso significa "bajarlo del portal" o "dejarlo sin examinar".
 */
export async function readCachedXml(xmlPath: string): Promise<DteData | null> {
  const absolutePath = resolveDteFile(xmlPath)
  if (!absolutePath) return null
  try {
    const stat = await fs.stat(absolutePath)
    if ((typeof stat.isFile === "function" && !stat.isFile()) || stat.size > MAX_DTE_XML_BYTES) return null
    const buffer = await readBuffer(absolutePath)
    if (buffer.length > MAX_DTE_XML_BYTES) return null
    return parseDteXml(decodeXmlBuffer(buffer))
  } catch {
    return null
  }
}
