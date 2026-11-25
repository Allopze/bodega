#!/usr/bin/env node
/**
 * Descarga el clasificador local de los desafíos de imágenes del reCAPTCHA.
 *
 * El modelo es un YOLO11x-cls entrenado por DannyLuna con 57 000 imágenes
 * reales de reCAPTCHA en 14 clases. Se ejecuta en local con `onnxruntime-web`
 * (WASM): las imágenes no salen del equipo.
 *
 * **Licencia**: los metadatos del ONNX declaran `AGPL-3.0` (aunque la ficha de
 * HuggingFace diga MIT). Por eso NO se embarca en la imagen: se descarga a un
 * volumen con este comando y el uso queda acotado a la instalación interna.
 * Revisar antes de distribuir el producto o de ofrecerlo como servicio.
 *
 * Uso (host o contenedor):
 *   node scripts/install-onway-vision-model.mjs
 *   docker compose run --rm install-onway-vision-model
 */

import { createHash } from "node:crypto"
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { resolve } from "node:path"

const URL_MODELO =
  "https://huggingface.co/DannyLuna/recaptcha-classification-57k/resolve/main/recaptcha_classification_57k.onnx"

/** Tamaño mínimo aceptado; el archivo real ronda los 108 MB. */
const TAMANO_MINIMO = 100 * 1024 * 1024

/**
 * SHA-256 del archivo publicado a la fecha de este commit. Una descarga
 * distinta no se acepta: el modelo se ejecuta sobre imágenes del portal y no
 * hay razón para confiar en un binario que cambió sin que nadie lo revisara.
 * Se puede sobreescribir con `ONWAY_VISION_SHA256` al actualizar el modelo tras
 * verificarlo.
 */
const SHA256_ESPERADO =
  process.env.ONWAY_VISION_SHA256?.trim() || "4092e8917ee8c2963895d66ba10a97d6ef975c468a95858a8a7bd9e70681b65d"

const DESTINO = resolve(
  process.env.ONWAY_VISION_MODEL_PATH?.trim() || "/data/onway-models/recaptcha_cls.onnx",
)

function log(mensaje) {
  console.log(`[onway/vision] ${mensaje}`)
}

async function sha256De(ruta) {
  return createHash("sha256").update(await readFile(ruta)).digest("hex")
}

async function main() {
  if (existsSync(DESTINO) && statSync(DESTINO).size >= TAMANO_MINIMO) {
    const hash = await sha256De(DESTINO)
    if (!SHA256_ESPERADO || hash === SHA256_ESPERADO) {
      log(`el modelo ya está instalado: ${DESTINO}`)
      log(`sha256 ${hash}`)
      return
    }
    log(`el modelo instalado no coincide con el sha256 esperado; se vuelve a descargar`)
  }

  mkdirSync(resolve(DESTINO, ".."), { recursive: true })

  log("descargando el modelo (~108 MB)…")
  const respuesta = await fetch(URL_MODELO)
  if (!respuesta.ok || !respuesta.body) {
    throw new Error(`la descarga falló con HTTP ${respuesta.status}`)
  }

  const temporal = `${DESTINO}.parcial`
  await pipeline(Readable.fromWeb(respuesta.body), createWriteStream(temporal, { mode: 0o644 }))

  const tamano = statSync(temporal).size
  if (tamano < TAMANO_MINIMO) {
    throw new Error(`el archivo quedó incompleto (${tamano} bytes)`)
  }

  renameSync(temporal, DESTINO)

  const hash = await sha256De(DESTINO)
  if (SHA256_ESPERADO && hash !== SHA256_ESPERADO) {
    rmSync(DESTINO, { force: true })
    throw new Error(`el sha256 no coincide: esperado ${SHA256_ESPERADO}, obtenido ${hash}`)
  }

  log(`modelo instalado: ${DESTINO} (${(tamano / 1024 / 1024).toFixed(0)} MB)`)
  log(`sha256 ${hash}`)
  log("licencia declarada en el ONNX: AGPL-3.0 — uso interno; revisar antes de distribuir.")
}

main().catch((error) => {
  console.error(`[onway/vision] error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
