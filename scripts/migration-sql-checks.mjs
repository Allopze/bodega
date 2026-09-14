/**
 * scripts/migration-sql-checks.mjs
 *
 * DAT-002 — La verificación de la cadena de migraciones no inspeccionaba el
 * SQL. `verify-migration-chain.mjs` comprobaba que el journal y los archivos
 * coincidieran (índices contiguos, tags únicos, timestamps crecientes, prefijo
 * alineado con el idx) y el propio preflight citaba la limitación: *"This does
 * not inspect the SQL"*. Con casi 300 migraciones acumuladas, la única barrera
 * automática era de forma, no de contenido.
 *
 * Este módulo aporta el contenido. Las funciones son puras y se prueban sin
 * tocar el disco (`scripts/migration-sql-checks.test.ts`).
 *
 * ── Qué se comprueba, y por qué estas tres y no más ────────────────────────
 *
 * El criterio de admisión es duro a propósito: **una comprobación entra sólo
 * si es objetiva y no puede producir un falso positivo**. Un verificador que
 * cría falsos positivos se desactiva en la primera urgencia de deploy y deja
 * de proteger nada. Todo lo que exige juicio —¿es reversible?, ¿es seguro en
 * caliente?, ¿bloquea la tabla demasiado tiempo?— queda fuera: eso lo revisa
 * una persona, y el preflight lo complementa aparte.
 *
 * 1. **Inmutabilidad** (`compareChecksums`). Una migración ya publicada no
 *    puede cambiar de contenido. Reescribir un archivo que producción ya
 *    aplicó no vuelve a ejecutarlo: la base queda en un estado que el repo ya
 *    no describe, en silencio y para siempre. Se compara contra el manifiesto
 *    `db/migrations/meta/_sql-checksums.json`. Un tag AUSENTE del manifiesto
 *    es una migración nueva y pasa —de otro modo, dos ramas paralelas se
 *    bloquearían entre sí—; lo que falla es un tag presente cuyo SHA-256
 *    cambió. Sin juicio: o el archivo es el mismo o no lo es.
 *
 * 2. **`DROP` sin guarda** (`findUnguardedDrops`). Un `DROP` de un objeto sin
 *    `IF EXISTS` aborta la migración entera si el objeto ya no está —y con
 *    casi 300 migraciones, bases restauradas de respaldos parciales y entornos
 *    que divergieron, eso pasa—. Con la guarda, la migración es reaplicable.
 *    Se excluyen los `DROP` que NO borran un objeto (`DROP DEFAULT`,
 *    `DROP NOT NULL`, `DROP IDENTITY`, `DROP EXPRESSION`: son cambios de
 *    atributo de columna y no admiten `IF EXISTS`), y se ignoran comentarios y
 *    literales de texto para no leer un `DROP` que sólo está mencionado en
 *    prosa. Lo heredado se congela por conteo, igual que ya se hace con los
 *    identificadores sobre-largos: el chequeo 1 impide que los archivos
 *    existentes cambien, así que cualquier aumento del conteo es nuevo.
 *
 * 3. **Migración vacía** (`isEffectivelyEmpty`). Un `.sql` sin una sola
 *    sentencia ejecutable —sólo comentarios o espacio— es siempre un error de
 *    empaquetado: alguien registró la entrada en el journal y el contenido se
 *    perdió. Objetivo y sin matices.
 */

import { createHash } from "node:crypto"

/** SHA-256 del contenido, normalizando saltos de línea (CRLF ≠ contenido). */
export function sqlChecksum(text) {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex")
}

/**
 * Quita comentarios (`--` de línea, `/* * /` de bloque) y literales de texto
 * ('…', $$…$$, $tag$…$tag$), reemplazándolos por espacio.
 *
 * Sin esto, un `DROP TABLE` mencionado dentro de un comentario explicativo o
 * dentro del cuerpo de una función se contaría como sentencia real.
 */
export function stripSqlNoise(sql) {
  let out = ""
  let i = 0
  while (i < sql.length) {
    const two = sql.slice(i, i + 2)
    if (two === "--") {
      const end = sql.indexOf("\n", i)
      i = end === -1 ? sql.length : end
      out += " "
      continue
    }
    if (two === "/*") {
      const end = sql.indexOf("*/", i + 2)
      i = end === -1 ? sql.length : end + 2
      out += " "
      continue
    }
    if (sql[i] === "'") {
      i++
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue }
        if (sql[i] === "'") { i++; break }
        i++
      }
      out += " "
      continue
    }
    const dollar = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i))
    if (dollar) {
      const tag = dollar[0]
      const end = sql.indexOf(tag, i + tag.length)
      i = end === -1 ? sql.length : end + tag.length
      out += " "
      continue
    }
    out += sql[i]
    i++
  }
  return out
}

/**
 * Objetos cuyo `DROP` sí admite `IF EXISTS` en Postgres. `DROP DEFAULT`,
 * `DROP NOT NULL`, `DROP IDENTITY` y `DROP EXPRESSION` quedan fuera a
 * propósito: no borran un objeto y la guarda no existe para ellos.
 */
const DROPPABLE_OBJECTS = [
  "table", "column", "constraint", "index", "view", "materialized\\s+view",
  "sequence", "type", "schema", "function", "procedure", "trigger", "policy",
  "domain", "extension", "rule", "publication", "subscription",
]

const DROP_RE = new RegExp(
  `\\bdrop\\s+(?:concurrently\\s+)?(${DROPPABLE_OBJECTS.join("|")})\\b(?:\\s+concurrently\\b)?(\\s+if\\s+exists\\b)?`,
  "gi",
)

/**
 * `DROP` de un objeto sin `IF EXISTS`. Devuelve el fragmento tal cual aparece,
 * para que el mensaje de error señale la línea y no obligue a buscarla.
 */
export function findUnguardedDrops(sql) {
  const cleaned = stripSqlNoise(sql)
  const found = []
  for (const match of cleaned.matchAll(DROP_RE)) {
    if (match[2]) continue
    found.push(match[0].replace(/\s+/g, " ").trim().toUpperCase())
  }
  return found
}

/** True si el archivo no contiene una sola sentencia ejecutable. */
export function isEffectivelyEmpty(sql) {
  return stripSqlNoise(sql)
    .replace(/-->\s*statement-breakpoint/gi, "")
    .replace(/[\s;]/g, "")
    .length === 0
}

/**
 * Compara los checksums actuales contra el manifiesto.
 *
 * @param {Record<string,string>} manifest tag → sha256 publicado
 * @param {Record<string,string>} actual   tag → sha256 en el árbol
 * @returns {{ changed: string[], missing: string[], added: string[] }}
 *   `changed`: publicada y reescrita — es el error.
 *   `missing`: publicada y ya no está el archivo — también lo es.
 *   `added`:   migración nueva todavía sin registrar. No es error.
 */
export function compareChecksums(manifest, actual) {
  const changed = []
  const missing = []
  const added = []
  for (const [tag, hash] of Object.entries(manifest)) {
    if (!(tag in actual)) { missing.push(tag); continue }
    if (actual[tag] !== hash) changed.push(tag)
  }
  for (const tag of Object.keys(actual)) {
    if (!(tag in manifest)) added.push(tag)
  }
  return { changed: changed.sort(), missing: missing.sort(), added: added.sort() }
}
