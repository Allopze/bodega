/**
 * Guarda de seguridad para los seeds de desarrollo.
 *
 * El repositorio tiene dos bases locales con nombres casi idénticos:
 * `bodega` (producción) y `bodega_dev` (desarrollo). Un `DATABASE_URL`
 * heredado del shell o copiado de un `.env` equivocado basta para sembrar
 * datos ficticios sobre producción, así que la comprobación es deliberadamente
 * estricta y se ejecuta antes de abrir la conexión.
 */

export type DevSeedTarget = {
  url: URL
  database: string
  host: string
  port: string
}

const LOCAL_HOSTS = new Set(["", "localhost", "127.0.0.1", "::1", "[::1]"])
const FORBIDDEN_DATABASES = /^(bodega|bodega_prod|production|prod|prd)$/i
const DEV_DATABASE = /(_dev|_test|_e2e)$/i

export function assertDevSeedTarget(
  rawUrl: string | undefined,
  options: { apply?: boolean } = {},
): DevSeedTarget {
  if (!rawUrl) {
    throw new Error(
      "DATABASE_URL es obligatorio. Para desarrollo usa .env.dev.local con la URL de bodega_dev; nunca la de producción.",
    )
  }

  /*
   * `NODE_ENV` no sirve como guarda: la imagen standalone de la app corre con
   * `production` incluso en desarrollo. La base y el host sí distinguen, y son
   * las comprobaciones que siguen.
   */
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error("DATABASE_URL no es una URL válida.")
  }

  const host = url.hostname
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""))

  /*
   * En `deploy:dev` el seed corre dentro del compose y la base se llama `db`,
   * no `127.0.0.1`. Se acepta ese host sólo con una señal explícita del
   * despliegue: `DEPLOY_LABEL=dev` (lo pasa deploy-prod.sh) y el opt-in del
   * servicio `seed-dev`. deploy:prod nunca activa ninguno de los dos, y la
   * denylist de abajo sigue rechazando `bodega`, `prod`, etc.
   */
  const deployedDev = process.env.SEED_DEV_ALLOW_DEPLOYED === "true"
    && process.env.DEPLOY_LABEL === "dev"

  if (!LOCAL_HOSTS.has(host) && !deployedDev) {
    throw new Error(
      `Destino no local (${host || "(sin host)"}). Este seed sólo escribe en una base de desarrollo local o en el servicio seed-dev de deploy:dev.`,
    )
  }

  if (!database) {
    throw new Error("DATABASE_URL no indica el nombre de la base.")
  }

  if (FORBIDDEN_DATABASES.test(database)) {
    throw new Error(
      `La base "${database}" es de producción. Abortado antes de abrir la conexión: usa bodega_dev.`,
    )
  }

  if (!DEV_DATABASE.test(database)) {
    throw new Error(
      `La base "${database}" no parece de desarrollo (se esperaba un nombre terminado en _dev, _test o _e2e).`,
    )
  }

  if (options.apply && process.argv.includes("--dry-run")) {
    throw new Error("--apply y --dry-run son incompatibles.")
  }

  return {
    url,
    database,
    host: host || "socket local",
    port: url.port || "5432",
  }
}

export function formatDevSeedTarget(target: DevSeedTarget): string {
  return `${target.host}:${target.port}/${target.database}`
}
