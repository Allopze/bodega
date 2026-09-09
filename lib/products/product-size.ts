/**
 * Identidad y orden de la talla de una variante de producto.
 *
 * En esta plataforma **la variante es el producto**: una fila de `products` por
 * talla, y la talla vive en `product_attributes` como un atributo `select` con
 * un único valor (`options = '["42"]'`). El stock, los movimientos, las
 * recepciones y las entregas cuelgan de `product_id`, así que la talla ya viaja
 * por todo el ciclo sin columnas propias — lo que faltaba era leerla.
 *
 * Este módulo es el único lugar que decide qué atributo *es* una talla, cómo se
 * escribe y en qué orden se muestra. Vivía duplicado entre el selector de
 * variantes de solicitudes (que sólo sabía detectarla) y el importador (que
 * sólo sabía mayusculizarla), y ninguna de las dos reglas alcanzaba a Entregas.
 *
 * Sin dependencias de servidor: lo importan componentes de cliente, acciones de
 * servidor y consultas de página.
 */

/** Atributos de talla y el campo del padrón donde vive la talla habitual. */
const SIZE_ATTRIBUTE_FIELDS = {
  talla:              "sizeTop",
  "talla superior":   "sizeTop",
  "talla inferior":   "sizeBottom",
  "talla calzado":    "sizeShoe",
  "talla guantes":    "sizeGloves",
  "talla casco":      "sizeHelmet",
} as const satisfies Record<string, WorkerSizeField>

export type WorkerSizeField =
  | "sizeTop"
  | "sizeBottom"
  | "sizeShoe"
  | "sizeGloves"
  | "sizeHelmet"

/** Tallas habituales del trabajador, tal como las guarda `workers`. */
export type WorkerSizes = Partial<Record<WorkerSizeField, string | null>>

function normalizeName(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
}

/**
 * Un atributo es de talla si su nombre contiene «talla» o «size» como palabra.
 * Deliberadamente laxo: el catálogo real trae «Talla», «Talla calzado» y
 * «Talla guantes», y una categoría puede declarar otros.
 */
export function isSizeAttributeName(name: string): boolean {
  return /\b(talla|size)\b/.test(normalizeName(name))
}

/**
 * Campo de talla habitual que corresponde a un atributo, si lo hay. Un atributo
 * de talla sin equivalente en el padrón (una talla de arnés, por ejemplo) no
 * tiene sugerencia y eso no es un error.
 */
export function workerSizeFieldFor(attributeName: string): WorkerSizeField | null {
  const key = normalizeName(attributeName) as keyof typeof SIZE_ATTRIBUTE_FIELDS
  return SIZE_ATTRIBUTE_FIELDS[key] ?? null
}

/** Talla habitual del trabajador para un atributo, ya normalizada. */
export function suggestedWorkerSize(
  attributeName: string,
  worker: WorkerSizes | null | undefined,
): string | null {
  if (!worker) return null
  const field = workerSizeFieldFor(attributeName)
  if (!field) return null
  const raw = worker[field]
  return raw ? normalizeSizeLabel(raw) : null
}

/* ── Normalización ────────────────────────────────────────────────────────── */

const WORD_FORMS: Record<string, string> = {
  "extra small": "XS", "extrachica": "XS", "extra chica": "XS",
  small: "S", pequena: "S", pequeno: "S", chica: "S", chico: "S",
  medium: "M", mediana: "M", mediano: "M",
  large: "L", grande: "L",
  "extra large": "XL", "extra grande": "XL", extragrande: "XL",
}

/** `XXL` y `2XL` son la misma talla: el catálogo escribe la forma numérica. */
function canonicalScaleCode(value: string): string {
  const repeated = /^(X{2,})(S|L)$/.exec(value)
  if (repeated) return `${repeated[1]!.length}X${repeated[2]!}`
  return value
}

/**
 * Forma canónica de una etiqueta de talla, para **comparar** — no para
 * reescribir lo ya guardado. Resuelve las variantes que el catálogo real trae
 * mezcladas: `42.0`, `T42`, `N42`, `42 EUR` → `42`; `medium`, `Mediana` → `M`;
 * `T/L` → `L`; `XXL` → `2XL`.
 */
export function normalizeSizeLabel(value: string): string {
  const base = normalizeName(value).replace(/\.$/, "")
  if (!base) return ""

  const word = WORD_FORMS[base]
  if (word) return word

  // «talla 42», «t42», «T/L», «T-M», «42 eur», «42 us»: ni el sistema de
  // medida ni la abreviatura de «talla» son la talla. `T/` sólo se quita
  // cuando le sigue un código de una escala conocida, para no partir un rango
  // real como `S/M`.
  const stripped = base
    .replace(/^talla\s+/, "")
    .replace(/^t(?=\d)/, "")
    .replace(/^t[/-](?=\d|x*[sml]\b)/, "")
    // «N41», «N-9», «N/42»: `N` es «número» en las planillas de calzado y
    // guantes. Exige un dígito detrás, así que no se come una letra (`NM`) ni
    // la `N` sola. Sin esto `N41` y `41` eran dos tallas distintas, y los
    // botines N41..N44 caían al grupo «desconocido» ordenados por texto.
    .replace(/^n[/-]?(?=\d)/, "")
    .replace(/\s*(eur?|us|uk|cl|br|mx|arg?)$/, "")
    .trim()

  // `42.0` y `42` son la misma talla; `8.5` no es `8`.
  if (/^\d+([.,]\d+)?$/.test(stripped)) {
    return String(Number(stripped.replace(",", ".")))
  }

  // Compuestas de la escala de ropa: `s/m`, `m-l`.
  const parts = stripped.split(/\s*[/\-]\s*/).filter(Boolean)
  if (parts.length > 1) {
    return parts.map((part) => canonicalScaleCode(part.toUpperCase())).join("/")
  }

  return canonicalScaleCode(stripped.toUpperCase())
}

/* ── Orden lógico ─────────────────────────────────────────────────────────── */

/**
 * La escala de ropa se ordena por talla, no alfabéticamente: `XS S M L XL 2XL`
 * y no `L M S XL XS`. `S` es el ancla en 0 para que las X negativas y positivas
 * caigan a cada lado sin casos especiales.
 */
const SCALE_RANK: Record<string, number> = { S: 0, M: 1, L: 2 }

function scaleRank(code: string): number | null {
  const direct = SCALE_RANK[code]
  if (direct != null) return direct

  const extended = /^(\d*)X(S|L)$/.exec(code)
  if (!extended) return null
  const multiplier = extended[1] ? Number(extended[1]) : 1
  // XS → -1, 2XS → -2 … XL → 3, 2XL → 4 (una X sobre `L`, que vale 2).
  return extended[2] === "S" ? -multiplier : 2 + multiplier
}

/**
 * Posición de una talla en su escala. El primer elemento es el grupo (numéricas
 * antes que la escala de ropa, y lo desconocido al final) para que un catálogo
 * con las dos formas mezcladas no las intercale.
 */
function sizeSortKey(label: string): [number, number, string] {
  const normalized = normalizeSizeLabel(label)

  if (/^\d+(\.\d+)?$/.test(normalized)) return [0, Number(normalized), normalized]

  const first = normalized.split("/")[0] ?? normalized
  const rank = scaleRank(first)
  if (rank != null) return [1, rank, normalized]

  return [2, 0, normalized]
}

/** Comparador de etiquetas de talla en orden lógico. */
export function compareSizeLabels(left: string, right: string): number {
  const [leftGroup, leftRank, leftLabel] = sizeSortKey(left)
  const [rightGroup, rightRank, rightLabel] = sizeSortKey(right)
  if (leftGroup !== rightGroup) return leftGroup - rightGroup
  if (leftRank !== rightRank) return leftRank - rightRank
  return leftLabel.localeCompare(rightLabel, "es-CL")
}

/* ── Lectura de la talla de una variante ──────────────────────────────────── */

export interface SizeAttributeLike {
  name: string
  /** JSON array (`'["42"]'`) o texto separado por comas del catálogo antiguo. */
  options?: string | null
  sizeFamily?: string | null
}

export interface ProductSize {
  /** Nombre del atributo tal como lo declara el catálogo («Talla calzado»). */
  attributeName: string
  /** Etiqueta tal como está guardada: es la que ve y firma el usuario. */
  label: string
  /** Familia canónica de tallas (`ropa`, `calzado`, `guantes`…), si se declaró. */
  sizeFamily: string | null
}

/**
 * Opciones de un atributo `select`. Acepta el JSON actual y el texto separado
 * por comas de los registros antiguos, igual que el resto de la plataforma.
 */
export function parseSizeOptions(options: string | null | undefined): string[] {
  if (!options) return []
  try {
    const parsed = JSON.parse(options)
    if (Array.isArray(parsed)) return parsed.map((option) => String(option).trim()).filter(Boolean)
  } catch {
    // Atributos previos a la normalización guardaban coma/salto de línea.
  }
  return options.split(/[\n,]/).map((option) => option.trim()).filter(Boolean)
}

/**
 * Talla de una variante de producto, o `null` si el producto no usa talla.
 *
 * Devuelve `null` —y no una talla ficticia— cuando el atributo declara más de
 * un valor: ese producto es un molde de catálogo sin variantes generadas, no
 * una unidad concreta que se pueda entregar.
 */
export function resolveProductSize(
  attributes: readonly SizeAttributeLike[],
): ProductSize | null {
  for (const attribute of attributes) {
    if (!isSizeAttributeName(attribute.name)) continue
    const options = parseSizeOptions(attribute.options)
    if (options.length !== 1) continue
    return {
      attributeName: attribute.name,
      label: options[0]!,
      sizeFamily: attribute.sizeFamily ?? null,
    }
  }
  return null
}

/**
 * Nombre de un producto con su talla, para los registros que se leen fuera de
 * la pantalla que los creó: comprobantes firmados, PDF, historial y exportes.
 *
 * El catálogo importado guarda el mismo nombre en todas las tallas, así que sin
 * esto el comprobante que firma el trabajador decía «Zapato de seguridad
 * SteelPro» sin indicar cuál talla recibió.
 */
export function formatSizedProductName(
  name: string,
  size: Pick<ProductSize, "attributeName" | "label"> | null | undefined,
): string {
  return size ? `${name} · ${size.attributeName} ${size.label}` : name
}
