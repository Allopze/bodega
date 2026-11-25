/**
 * Decodificación de la imagen del tablero de reCAPTCHA.
 *
 * Google sirve el tablero como **JPEG** (medido: 300×300, 3 canales) aunque la
 * URL o el nombre del archivo digan `png`. Se usa `sharp`, que ya es dependencia
 * de producción por el render de PDF, en vez de sumar un decodificador nuevo.
 */

export interface OnwayCaptchaDecodedImage {
  width: number
  height: number
  channels: number
  data: Buffer
}

/** Límite defensivo: un tablero real pesa decenas de KB, no megabytes. */
export const ONWAY_CAPTCHA_MAX_IMAGE_BYTES = 2 * 1024 * 1024

/**
 * Decodifica a RGB crudo. Devuelve `null` si la imagen no es utilizable: el
 * solver lo trata como desafío fallido y no insiste.
 */
export async function decodeOnwayCaptchaImage(
  input: Buffer,
): Promise<OnwayCaptchaDecodedImage | null> {
  if (input.length === 0 || input.length > ONWAY_CAPTCHA_MAX_IMAGE_BYTES) return null
  try {
    const { default: sharp } = await import("sharp")
    const pipeline = sharp(input, { failOn: "none" })
    const metadata = await pipeline.metadata()
    if (!metadata.width || !metadata.height) return null
    if (metadata.width < 32 || metadata.height < 32) return null
    if (metadata.width > 4096 || metadata.height > 4096) return null

    const data = await pipeline.removeAlpha().toColourspace("srgb").raw().toBuffer()
    const channels = Math.round(data.length / (metadata.width * metadata.height))
    if (channels < 1) return null
    return { width: metadata.width, height: metadata.height, channels, data }
  } catch {
    return null
  }
}
