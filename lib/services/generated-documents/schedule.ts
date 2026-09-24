/**
 * Programa el archivado de lo que la acción acaba de encolar, para después de
 * responder. La acción lo llama tras el éxito; no espera nada ni lanza nunca.
 *
 * `after()` (Next 16) corre después de la respuesta, también cuando la acción
 * termina en `redirect()`, y en un Server Function deja leer los headers. La
 * cookie se lee ANTES, en el cuerpo de la acción: así la credencial es un
 * valor, no una lectura que dependa de dónde corre el callback.
 *
 * Fuera de un request (scripts, pruebas) `after()` lanza (E468). Ahí no se hace
 * nada: la fila ya está guardada y la recogen el cron o el reintento manual.
 */
import { headers } from "next/headers"
import { after } from "next/server"
import { logger } from "@/lib/logger"
import { printCredentialFromCookieHeader } from "@/lib/pdf/render-print-page"
import { drainGeneratedDocuments } from "./drain"
import { readGeneratedArchiveEnvFlag } from "./settings"

export async function scheduleGeneratedDocumentDrain(actorUserId: string): Promise<void> {
  // Sin la llave de entorno no hay nada encolado: ni siquiera se lee la cookie.
  if (!readGeneratedArchiveEnvFlag()) return
  try {
    const credential = printCredentialFromCookieHeader((await headers()).get("cookie"))
    after(async () => {
      try {
        await drainGeneratedDocuments({ credential, actorUserId })
      } catch (error) {
        logger.error("[generated-documents] falló el archivado posterior a la acción", {
          message: error instanceof Error ? error.message : String(error),
        })
      }
    })
  } catch (error) {
    logger.warn("[generated-documents] no se pudo programar el archivado; queda para el cron", {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
