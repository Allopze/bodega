/**
 * Enlace público del formulario de carga en terreno que va dentro del QR.
 *
 * La página vive en `app/(public)/tae/access/[accessToken]`. Hasta el
 * 2026-10-30 el panel armaba `/tae/acceso/<token>`, una ruta que no existía:
 * todo QR generado desde julio abría el login en vez del formulario. Por eso
 * `/tae/acceso/<token>` quedó como redirección permanente para los QR ya
 * impresos, y el enlace se arma en un solo lugar con su prueba.
 */
export const TAE_ACCESS_PATH = "/tae/access"

export function taeAccessUrl(origin: string, accessToken: string): string {
  return `${origin.replace(/\/+$/, "")}${TAE_ACCESS_PATH}/${encodeURIComponent(accessToken)}`
}
