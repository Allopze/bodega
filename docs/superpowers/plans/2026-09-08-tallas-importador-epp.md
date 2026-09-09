# Normalización de tallas en el importador de EPP — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el importador XLSX escriba la talla con el nombre de atributo de su familia canónica, con el valor canonizado y con `product_attributes.size_family` poblado, en vez de decidirlo con una heurística de dos dígitos y dejar la familia nula.

**Architecture:** Una función pura nueva (`resolveSizeAttribute`) reemplaza el `/^\d{2}$/` duplicado en las dos ramas de `normalizeEppRow`. Se apoya en `inferEppItemType`, que ya conoce el vocabulario del catálogo real, y en un mapa `EPP_TYPE_TO_SIZE_FAMILY` gemelo del `EPP_TYPE_TO_BODY_PART_CODE` que ya existe. Los códigos válidos de cada familia llegan como parámetro opcional leído de `size_catalog`, para no romper la restricción de que `epp-import.types.ts` sea libre de `@/db`. `normalizeSizeLabel` sigue siendo el dueño único de cómo se escribe una talla.

**Tech Stack:** TypeScript, Next.js 16, Drizzle ORM, PostgreSQL, Vitest (proyectos `non-pglite` y `pglite`), PGlite para integración.

**Spec:** `docs/superpowers/specs/2026-09-08-tallas-importador-epp-design.md`

## Global Constraints

- **`lib/services/epp-import.types.ts` NO puede importar `@/db`.** Lo importa un componente cliente (`app/(app)/admin/productos/importar/[batchId]/epp-import-review.tsx:12`). Sí puede importar `lib/products/product-size.ts` y `lib/products/size-catalog.ts`: ambos son puros y ya declaran «sin dependencias de servidor».
- **No se reescriben datos existentes.** Ninguna tarea emite UPDATE ni migración sobre `product_attributes` ya guardados. La vía de migración es reimportar la fila, que ya borra y reinserta atributos (`lib/services/epp-import.ts:172`).
- **No se cambia el esquema.** `product_attributes.size_family` ya existe.
- **No se toca el asistente de variantes ni el alta manual**, que ya usan el catálogo canónico.
- **`normalizeSizeLabel` es el dueño único de la forma de una talla.** Ninguna tarea introduce una cuarta regla de normalización (hallazgo F-5 de `AUDITORIA_TALLAS_EPP_2026-09-03.md`).
- Comentarios, mensajes de usuario y mensajes de commit en español, como el resto del repo. Los commits terminan con `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Comandos de prueba: `npm run test:fast -- <archivo>` para tests puros, `npm run test:pglite -- <archivo>` para los de PGlite. Un test PGlite nuevo debe registrarse en `tests/pglite-files.ts`.

## Desviación del diseño que este plan aplica

El diseño mapea `pantalon` y `jardinera` a la familia `pantalon` (cinturas `28..48`). **Este plan los mapea a `ropa`** (`XS..4XL`), por dos evidencias del catálogo real:

- EPP-083 «JARDINERA TERMICA 2XL» lleva `Talla: XS` — escala de letras.
- `lib/services/epp-clothing-sizes.ts` documenta que la escala `Talla` XS..2XL «alcanza a pantalones, buzos, chaquetas, chalecos y trajes por igual», y reserva `Talla inferior` para la numeración de cintura del padrón (`workers.size_bottom`).

Mapear a `pantalon` haría saltar la advertencia «no está en el catálogo de la familia pantalon» en cada pantalón y jardinera importados, y les asignaría una familia que el catálogo no usa. La familia `pantalon` queda disponible para el asistente de variantes, que es quien puede sizar por cintura a propósito.

**Si esta decisión se revierte**, el único cambio es la tabla de la Tarea 2 y los valores esperados de sus tests.

## File Structure

| Archivo | Responsabilidad | Cambio |
| --- | --- | --- |
| `lib/products/product-size.ts` | Dueño único de la identidad, forma y orden de una talla | Modificar: `T/` como prefijo de «Talla» en `normalizeSizeLabel` |
| `lib/products/__tests__/product-size.test.ts` o el test existente de ese módulo | Cobertura pura de la normalización | Modificar/crear |
| `lib/services/epp-import.types.ts` | Tipos, constantes y helpers puros del importador | Modificar: `EPP_TYPE_TO_SIZE_FAMILY`, `sizeFamilyForEppType`, `resolveSizeAttribute`, `EppAttribute.sizeFamily`, `normalizeEppRow`, `buildCorrections`, `RULE_LABELS`, `findProductMatches` |
| `lib/services/epp-import.types.test.ts` | Cobertura pura del resolvedor y del mapa | Modificar |
| `lib/services/epp-import.test.ts` | Cobertura pura de `normalizeEppRow` y `parseEppWorkbook` | Modificar: casos de talla existentes cambian de nombre de atributo |
| `lib/services/epp-import.ts` | Orquestación con base de datos del importador | Modificar: leer `getSizeFamilyOptions()` y pasarlo; persistir `sizeFamily` |
| `lib/__tests__/epp-import-size-family.test.ts` | Integración PGlite: la variante importada queda con familia | Crear |
| `tests/pglite-files.ts` | Registro de tests secuenciales | Modificar |
| `lib/__tests__/epp-clothing-sizes.test.ts` | Regresión: el backfill de ropa no toca guantes | Modificar |

No se crean módulos nuevos: el resolvedor vive junto a su gemelo `EPP_TYPE_TO_BODY_PART_CODE`, en el archivo que ya decide qué es una talla al importar.

---

### Task 1: `T/L` es la talla `L`

`normalizeSizeLabel` sólo quita el prefijo `t` cuando le sigue un dígito (`/^t(?=\d)/`), así que `T/L` y `T-XL` sobreviven enteros. Como `sizeSortKey` no encuentra rango para `T`, caen al grupo 2 («desconocido») y se ordenan al final. En el catálogo real eso son EPP-067 y EPP-077, ambos `Talla: T/L`.

`T/` es la abreviatura chilena de «Talla». Ningún sistema de tallas usa `T` como código, así que tratarlo como prefijo no colisiona con nada. Esto mejora de paso el orden del dropdown del catálogo, que ya usa `compareSizeLabels`.

**Files:**
- Modify: `lib/products/product-size.ts:105-130` (`normalizeSizeLabel`)
- Test: `lib/products/product-size.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `normalizeSizeLabel("T/L") === "L"`. Las tareas 3, 5 y 6 dependen de este comportamiento.

- [ ] **Step 1: Escribir los tests que fallan**

`lib/products/product-size.test.ts` ya existe y tiene `describe("normalizeSizeLabel")` en `:29` y `describe("compareSizeLabels")` en `:65`. Agrega los dos primeros casos dentro del primer bloque y el tercero dentro del segundo — no crees un `describe` duplicado.

Dentro de `describe("normalizeSizeLabel")`:

```ts
  it("lee `T/` como la abreviatura de «Talla», no como un código", () => {
    expect(normalizeSizeLabel("T/L")).toBe("L")
    expect(normalizeSizeLabel("t/xl")).toBe("XL")
    expect(normalizeSizeLabel("T-M")).toBe("M")
    expect(normalizeSizeLabel("T/42")).toBe("42")
  })

  it("no confunde una talla compuesta real con el prefijo", () => {
    // `S/M` es un rango de dos tallas, no «Talla M».
    expect(normalizeSizeLabel("S/M")).toBe("S/M")
    expect(normalizeSizeLabel("Talla 9-10")).toBe("9/10")
  })
```

Dentro de `describe("compareSizeLabels")`:

```ts
  it("deja `T/L` en su lugar de la escala y no al final", () => {
    const ordered = ["2XL", "T/L", "XS", "M"].sort(compareSizeLabels)
    expect(ordered).toEqual(["XS", "M", "T/L", "2XL"])
  })
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm run test:fast -- lib/products/product-size.test.ts`
Expected: FAIL. `normalizeSizeLabel("T/L")` devuelve `"T/L"` y se esperaba `"L"`; el orden deja `T/L` al final.

- [ ] **Step 3: Implementar el cambio mínimo**

En `normalizeSizeLabel`, dentro del bloque `stripped`, reemplaza la línea del prefijo numérico por las dos que cubren ambos casos:

```ts
  // «talla 42», «t42», «T/L», «T-M», «42 eur», «42 us»: ni el sistema de
  // medida ni la abreviatura de «talla» son la talla. `T/` sólo se quita
  // cuando le sigue un código de una escala conocida, para no partir un rango
  // real como `S/M`.
  const stripped = base
    .replace(/^talla\s+/, "")
    .replace(/^t(?=\d)/, "")
    .replace(/^t[/-](?=\d|x*[sml]\b)/, "")
    .replace(/\s*(eur?|us|uk|cl|br|mx|arg?)$/, "")
    .trim()
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm run test:fast -- lib/products/product-size.test.ts`
Expected: PASS

- [ ] **Step 5: Correr los consumidores del comparador para descartar regresión**

Run: `npm run test:fast -- lib/products/variant-grouping.test.ts app/\(app\)/solicitudes/variant-selector.helpers.test.ts lib/products/size-catalog.test.ts`
Expected: PASS. Los tres archivos existen; `size-catalog.test.ts` es el que más importa porque su `sizeCatalogRows()` deriva el `display_order` de `compareSizeLabels`.

- [ ] **Step 6: Commit**

```bash
git add lib/products/product-size.ts lib/products/product-size.test.ts
git commit -m "fix(tallas): lee \`T/\` como la abreviatura de «Talla»

\`normalizeSizeLabel\` sólo quitaba el prefijo \`t\` cuando le seguía un dígito, así
que \`T/L\` sobrevivía entero, \`sizeSortKey\` no le encontraba rango y caía al grupo
«desconocido»: EPP-067 y EPP-077 se ordenaban al final del dropdown en vez de
junto a \`L\`.

El strip exige que después de \`T/\` venga un código de una escala conocida, para
no partir un rango real como \`S/M\`.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Mapa de tipo de EPP a familia de talla

`inferEppItemType` ya traduce el nombre del producto al vocabulario de ítem del catálogo real (`guante`, `botin`, `casquete`…). Falta el gemelo de `EPP_TYPE_TO_BODY_PART_CODE` que lo lleve a la familia de talla.

Los tipos sin escala de talla no entran al mapa: devolver `null` antes que adivinar es el criterio que ya rige `classifyEppTypeIdByName`.

**Files:**
- Modify: `lib/services/epp-import.types.ts` (junto a `EPP_TYPE_TO_BODY_PART_CODE`, que termina en `:92`)
- Test: `lib/services/epp-import.types.test.ts`

**Interfaces:**
- Consumes: `EPP_TYPES`, `inferEppItemType` (ya existen en el mismo archivo).
- Produces:
  - `EPP_TYPE_TO_SIZE_FAMILY: Partial<Record<(typeof EPP_TYPES)[number], string>>`
  - `sizeFamilyForEppType(eppType: string | null): string | null`

- [ ] **Step 1: Escribir el test que falla**

Agrega al final de `lib/services/epp-import.types.test.ts`:

```ts
describe("sizeFamilyForEppType", () => {
  const familyOf = (name: string) => sizeFamilyForEppType(inferEppItemType(name))

  it("asigna la familia por el ítem que declara el nombre", () => {
    expect(familyOf("Guante Nitrilo Showa")).toBe("guantes")
    expect(familyOf("Botin de seguridad SteelPro")).toBe("calzado")
    expect(familyOf("Bota de agua")).toBe("calzado")
    expect(familyOf("Casco Activex I")).toBe("casco")
    expect(familyOf("Casquete ABS Porta Visor")).toBe("casco")
    expect(familyOf("Overol Activex Piloto Poplin")).toBe("ropa")
    expect(familyOf("Chaleco reflectante")).toBe("ropa")
  })

  it("sizea pantalones y jardineras con la escala de letras que usa el catálogo", () => {
    // EPP-083 «JARDINERA TERMICA 2XL» lleva `Talla: XS`, y el backfill de ropa
    // (`epp-clothing-sizes.ts`) trata pantalones como escala XS..2XL. La familia
    // `pantalon` son cinturas 28..48 y la usa el padrón, no el catálogo.
    expect(familyOf("Pantalón de trabajo")).toBe("ropa")
    expect(familyOf("JARDINERA TERMICA")).toBe("ropa")
  })

  it("devuelve null para los ítems que no tienen escala de talla", () => {
    expect(familyOf("Lente Activex FX III sellado")).toBeNull()
    expect(familyOf("Mascarilla plegable KN95 sin válvula")).toBeNull()
    expect(familyOf("Arnés de cuerpo completo")).toBeNull()
    expect(familyOf("Fono HL Verishield cintillo")).toBeNull()
    expect(familyOf("Respirador media cara")).toBeNull()
  })

  it("devuelve null cuando el nombre no declara ningún ítem", () => {
    expect(sizeFamilyForEppType(null)).toBeNull()
    expect(sizeFamilyForEppType("no-es-un-tipo")).toBeNull()
  })

  it("sólo usa familias que el catálogo canónico declara", () => {
    const known = new Set(SIZE_FAMILIES.map((definition) => definition.family))
    for (const family of Object.values(EPP_TYPE_TO_SIZE_FAMILY)) {
      expect(known).toContain(family)
    }
  })
})
```

Y extiende la línea de imports del archivo:

```ts
import {
  inferEppItemType,
  EPP_TYPE_TO_BODY_PART_CODE,
  EPP_TYPE_TO_SIZE_FAMILY,
  sizeFamilyForEppType,
} from "./epp-import.types"
import { SIZE_FAMILIES } from "@/lib/products/size-catalog"
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm run test:fast -- lib/services/epp-import.types.test.ts`
Expected: FAIL con un error de importación: `EPP_TYPE_TO_SIZE_FAMILY` y `sizeFamilyForEppType` no existen.

- [ ] **Step 3: Implementar el mapa y el helper**

Inserta en `lib/services/epp-import.types.ts` justo después del cierre de `EPP_TYPE_TO_BODY_PART_CODE`:

```ts
/**
 * Familia de talla (`lib/products/size-catalog.ts`) que corresponde al
 * vocabulario de ítem de este importador. Gemelo de
 * `EPP_TYPE_TO_BODY_PART_CODE`: uno traduce a la zona corporal con que
 * Prevención acredita, éste al eje por el que el ítem se sizea.
 *
 * Un tipo sin escala de talla —lentes, mascarillas, arnés, filtros— no entra
 * al mapa: su talla, si la trae la planilla, queda como el atributo genérico
 * `Talla` sin familia. Devolver `null` antes que adivinar es el mismo criterio
 * de `classifyEppTypeIdByName`.
 *
 * Pantalones y jardineras van a `ropa` y no a `pantalon`: el catálogo los
 * sizea con la escala de letras (EPP-083 «Jardinera Térmica» lleva `Talla: XS`,
 * y `addMissingClothingSizeVariants` ya los trata como XS..2XL). La familia
 * `pantalon` es la numeración de cintura del padrón (`workers.size_bottom`),
 * que sólo el asistente de variantes usa a propósito.
 */
export const EPP_TYPE_TO_SIZE_FAMILY: Partial<Record<(typeof EPP_TYPES)[number], string>> = {
  guante: "guantes",
  botin: "calzado",
  zapato: "calzado",
  bota: "calzado",
  casco: "casco",
  casquete: "casco",
  gorro: "casco",
  chaleco: "ropa",
  buzo: "ropa",
  traje: "ropa",
  pantalon: "ropa",
  chaqueta: "ropa",
  camisa: "ropa",
  polera: "ropa",
  blusa: "ropa",
  overol: "ropa",
  jardinera: "ropa",
  "primera capa": "ropa",
  capa: "ropa",
  coleto: "ropa",
}

/** Familia de talla de un tipo de ítem, o `null` si ese ítem no se sizea. */
export function sizeFamilyForEppType(eppType: string | null): string | null {
  if (!eppType) return null
  return EPP_TYPE_TO_SIZE_FAMILY[eppType as (typeof EPP_TYPES)[number]] ?? null
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm run test:fast -- lib/services/epp-import.types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/services/epp-import.types.ts lib/services/epp-import.types.test.ts
git commit -m "feat(epp-import): mapea el tipo de ítem a su familia de talla

Gemelo de \`EPP_TYPE_TO_BODY_PART_CODE\`: \`inferEppItemType\` ya conocía el
vocabulario del catálogo real, pero nada llevaba «guante» a la familia
\`guantes\` del catálogo canónico de tallas.

Los ítems sin escala de talla no entran al mapa. Pantalones y jardineras van a
\`ropa\` y no a \`pantalon\` porque el catálogo los sizea por letras; \`pantalon\`
es la numeración de cintura del padrón.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: El resolvedor de atributo de talla

Reemplaza la heurística `/^\d{2}$/.test(valor) ? "Talla calzado" : "Talla"` que está duplicada en la rama multi-talla (`:216`) y en la simple (`:228`).

Recibe los códigos válidos como parámetro opcional para que el archivo siga libre de `@/db`. Sin el parámetro cae a `SIZE_FAMILIES`, el mismo respaldo que `getSizeFamilyOptions` usa consigo mismo cuando la tabla está vacía.

**Files:**
- Modify: `lib/services/epp-import.types.ts`
- Test: `lib/services/epp-import.types.test.ts`

**Interfaces:**
- Consumes: `sizeFamilyForEppType` (Tarea 2); `normalizeSizeLabel` de la Tarea 1; `SIZE_FAMILIES` de `lib/products/size-catalog.ts`.
- Produces:

```ts
export interface SizeFamilyCodes { family: string; attributeName: string; codes: readonly string[] }
export interface ResolvedSizeAttribute {
  name: string
  values: string[]
  sizeFamily: string | null
  issues: Array<{ severity: ImportSeverity; message: string }>
}
export function resolveSizeAttribute(
  rawValues: readonly string[],
  eppType: string | null,
  familyOptions?: readonly SizeFamilyCodes[],
): ResolvedSizeAttribute
```

  La Tarea 4 la llama desde `normalizeEppRow`; la Tarea 7 le pasa `familyOptions` desde el servidor. `SizeFamilyCodes` es estructuralmente el `SizeFamilyOptions` que `lib/services/sizes.ts` ya devuelve.

- [ ] **Step 1: Escribir el test que falla**

Agrega a `lib/services/epp-import.types.test.ts`:

```ts
describe("resolveSizeAttribute", () => {
  it("nombra el atributo con la familia del ítem, no con una heurística de dos dígitos", () => {
    expect(resolveSizeAttribute(["M"], "guante").name).toBe("Talla guantes")
    expect(resolveSizeAttribute(["42"], "botin").name).toBe("Talla calzado")
    expect(resolveSizeAttribute(["L"], "casco").name).toBe("Talla casco")
    expect(resolveSizeAttribute(["XL"], "overol").name).toBe("Talla")
  })

  it("canoniza el valor con la regla compartida", () => {
    expect(resolveSizeAttribute(["T/L"], "guante").values).toEqual(["L"])
    expect(resolveSizeAttribute(["XXXL"], "overol").values).toEqual(["3XL"])
    expect(resolveSizeAttribute(["42.0"], "botin").values).toEqual(["42"])
    expect(resolveSizeAttribute(["Mediana"], "overol").values).toEqual(["M"])
  })

  it("declara la familia para que la variante pueda cruzarse con el padrón", () => {
    expect(resolveSizeAttribute(["M"], "guante").sizeFamily).toBe("guantes")
    expect(resolveSizeAttribute(["42"], "botin").sizeFamily).toBe("calzado")
  })

  it("no inventa familia para un ítem que no se sizea", () => {
    const resolved = resolveSizeAttribute(["M"], "lente")
    expect(resolved.name).toBe("Talla")
    expect(resolved.sizeFamily).toBeNull()
    expect(resolved.issues).toEqual([])
  })

  it("acepta con advertencia no bloqueante una talla fuera del catálogo de su familia", () => {
    const resolved = resolveSizeAttribute(["Talla 9-10"], "guante")
    expect(resolved.values).toEqual(["9/10"])
    expect(resolved.sizeFamily).toBe("guantes")
    expect(resolved.issues).toHaveLength(1)
    expect(resolved.issues[0]!.severity).toBe("warning")
    expect(resolved.issues[0]!.message).toContain("9/10")
    expect(resolved.issues[0]!.message).toContain("guantes")
  })

  it("no advierte cuando el valor sí está en el catálogo de su familia", () => {
    expect(resolveSizeAttribute(["2XL"], "guante").issues).toEqual([])
  })

  it("resuelve todas las tallas de una fila multi-talla", () => {
    const resolved = resolveSizeAttribute(["S", "M", "L", "XL"], "guante")
    expect(resolved.name).toBe("Talla guantes")
    expect(resolved.values).toEqual(["S", "M", "L", "XL"])
    expect(resolved.issues).toEqual([])
  })

  it("advierte por cada talla fuera de catálogo de una fila multi-talla", () => {
    const resolved = resolveSizeAttribute(["S", "9-10"], "guante")
    expect(resolved.values).toEqual(["S", "9/10"])
    expect(resolved.issues).toHaveLength(1)
  })

  it("valida contra los códigos inyectados y no contra la semilla", () => {
    // Ésta es la ruta real del servidor: los códigos vienen de `size_catalog`,
    // donde una talla puede estar dada de baja o haberse agregado.
    const options = [{ family: "guantes", attributeName: "Talla guantes", codes: ["S", "M"] }]
    expect(resolveSizeAttribute(["M"], "guante", options).issues).toEqual([])
    expect(resolveSizeAttribute(["XL"], "guante", options).issues).toHaveLength(1)
  })

  it("usa el nombre de atributo que declaran los códigos inyectados", () => {
    const options = [{ family: "guantes", attributeName: "Talla de guante", codes: ["M"] }]
    expect(resolveSizeAttribute(["M"], "guante", options).name).toBe("Talla de guante")
  })
})
```

Extiende los imports del test con `resolveSizeAttribute`.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm run test:fast -- lib/services/epp-import.types.test.ts`
Expected: FAIL. `resolveSizeAttribute` no existe.

- [ ] **Step 3: Implementar el resolvedor**

Agrega el import al encabezado de `lib/services/epp-import.types.ts` (junto al `import { toCode } from "@/lib/utils"` que ya está):

```ts
import { normalizeSizeLabel } from "@/lib/products/product-size"
import { SIZE_FAMILIES } from "@/lib/products/size-catalog"
```

E inserta después de `sizeFamilyForEppType`:

```ts
/** Códigos válidos de una familia. Estructura de `SizeFamilyOptions`. */
export interface SizeFamilyCodes {
  family: string
  attributeName: string
  codes: readonly string[]
}

export interface ResolvedSizeAttribute {
  /** Nombre del atributo a crear («Talla guantes»). */
  name: string
  /** Valores ya canonizados, en el orden de la planilla. */
  values: string[]
  /** Familia canónica a persistir en `product_attributes.size_family`. */
  sizeFamily: string | null
  issues: Array<{ severity: ImportSeverity; message: string }>
}

/**
 * Cómo se llama el atributo de talla de una fila, cómo se escriben sus valores
 * y a qué familia pertenece.
 *
 * Sustituye la heurística `/^\d{2}$/ ? "Talla calzado" : "Talla"` que estaba
 * duplicada en las dos ramas de `normalizeEppRow` y por la que ningún guante
 * recibía nunca `Talla guantes`, ningún casco `Talla casco`, y nada quedaba con
 * `size_family`.
 *
 * Una talla fuera de los códigos de su familia se acepta con advertencia y no
 * bloquea: las planillas de proveedor traen numeración que el catálogo no
 * declara (`9-10` de guante), y bloquear las dejaría inutilizables. La
 * advertencia es la señal de que alguien decida si esa talla se agrega a
 * `size_catalog` o se corrige.
 *
 * `familyOptions` viene de `size_catalog` cuando llama el servidor. Sin él cae
 * a la semilla, el mismo respaldo que `getSizeFamilyOptions` usa para una tabla
 * vacía: quedarse sin poder importar es peor que usar los valores por defecto.
 */
export function resolveSizeAttribute(
  rawValues: readonly string[],
  eppType: string | null,
  familyOptions?: readonly SizeFamilyCodes[],
): ResolvedSizeAttribute {
  const values = rawValues.map((value) => normalizeSizeLabel(value) || cleanText(value).toUpperCase())
  const family = sizeFamilyForEppType(eppType)
  const definition = family
    ? (familyOptions ?? SIZE_FAMILIES).find((option) => option.family === family)
    : undefined

  if (!definition) return { name: "Talla", values, sizeFamily: null, issues: [] }

  const known = new Set(definition.codes.map((code) => normalizeSizeLabel(code)))
  const issues = values
    .filter((value) => !known.has(normalizeSizeLabel(value)))
    .map((value) => ({
      severity: "warning" as const,
      message: `La talla «${value}» no está en el catálogo de la familia ${definition.family}.`,
    }))

  return { name: definition.attributeName, values, sizeFamily: definition.family, issues }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm run test:fast -- lib/services/epp-import.types.test.ts`
Expected: PASS

- [ ] **Step 5: Verificar que el archivo sigue libre de `@/db`**

Run: `grep -n "@/db" lib/services/epp-import.types.ts`
Expected: sin resultados. Si aparece algo, el componente cliente de revisión se rompe al empaquetar.

- [ ] **Step 6: Commit**

```bash
git add lib/services/epp-import.types.ts lib/services/epp-import.types.test.ts
git commit -m "feat(epp-import): resuelve nombre, valor y familia de la talla

\`resolveSizeAttribute\` reemplaza la heurística de dos dígitos duplicada en las
dos ramas de talla. Canoniza el valor con \`normalizeSizeLabel\` —el dueño único
de esa regla— y declara la familia canónica para poder persistirla.

Una talla fuera de los códigos de su familia se acepta con advertencia no
bloqueante: las planillas de proveedor traen numeración que el catálogo no
declara, y bloquearlas las dejaría inutilizables.

Los códigos llegan por parámetro para que este archivo siga libre de \`@/db\`;
sin parámetro cae a la semilla.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `normalizeEppRow` usa el resolvedor

Tres cambios acoplados que deben ir juntos porque comparten los mismos tests:

1. `EppAttribute` gana `sizeFamily?: string | null`.
2. `inferEppItemType` se mueve **antes** del bloque de talla: el resolvedor necesita el tipo, y hoy el tipo se calcula después. Es seguro porque el ítem (`guante`) está en el nombre tanto antes como después de quitarle la talla.
3. Un helper `upsertSizeAttribute` deja **un solo** atributo de talla por fila. Sin él, una planilla con `Talla: M` en la columna `atributos` produciría `Talla` (de `parseNamedAttributes`) y `Talla guantes` (del resolvedor) a la vez.

**Files:**
- Modify: `lib/services/epp-import.types.ts` (`EppAttribute` en `:11`, `normalizeEppRow` en `:180-252`, helpers internos cerca de `:276`)
- Test: `lib/services/epp-import.test.ts:43-90` y `:5-17`

**Interfaces:**
- Consumes: `resolveSizeAttribute` (Tarea 3), `isSizeAttributeName` de `lib/products/product-size.ts`.
- Produces:
  - `EppAttribute` con `sizeFamily?: string | null`.
  - `normalizeEppRow(source: Record<string, string>, familyOptions?: readonly SizeFamilyCodes[]): NormalizedEppRow`. La Tarea 7 usa el segundo parámetro.
  - Todo atributo de talla de `normalized.attributes` lleva `sizeFamily`. Las Tareas 5, 6 y 8 lo leen.

- [ ] **Step 1: Actualizar los tests de talla existentes a la conducta nueva**

En `lib/services/epp-import.test.ts`, reemplaza los cuatro casos de talla y el primero por:

```ts
  it("extracts color and size from a messy EPP name", () => {
    const result = normalizeEppRow({ name: "GUANTE NITRILO AZUL TALLA M", unitOfMeasure: "uni" })

    expect(result.name).toBe("Guante Nitrilo")
    expect(result.unitOfMeasure).toBe("unidad")
    expect(result.attributes).toEqual(expect.arrayContaining([
      { name: "Color", value: "Azul" },
      { name: "Talla guantes", value: "M", sizeFamily: "guantes" },
      { name: "Material", value: "Nitrilo" },
    ]))
    expect(result.issues).toEqual([])
  })
```

```ts
  it("handles multi-talla from comma-separated column", () => {
    const result = normalizeEppRow({ name: "GUANTE NITRILO AZUL", unitOfMeasure: "unidad", size: "S, M, L, XL" })

    expect(result.attributes).toEqual(expect.arrayContaining([
      { name: "Color", value: "Azul" },
      { name: "Talla guantes", value: "S, M, L, XL", values: ["S", "M", "L", "XL"], sizeFamily: "guantes" },
      { name: "Material", value: "Nitrilo" },
    ]))
    expect(result.issues).toEqual([])
    expect(result.name).toBe("Guante Nitrilo")
    expect(result.identityKey).not.toContain("talla")
  })

  it("handles multi-talla calzado from comma-separated column", () => {
    const result = normalizeEppRow({ name: "BOTIN SEGURIDAD", unitOfMeasure: "par", size: "38, 39, 40, 41, 42" })

    expect(result.attributes).toEqual(expect.arrayContaining([
      { name: "Talla calzado", value: "38, 39, 40, 41, 42", values: ["38", "39", "40", "41", "42"], sizeFamily: "calzado" },
    ]))
    expect(result.issues).toEqual([])
    expect(result.identityKey).not.toContain("talla")
  })

  it("single talla from column still works (backward compat)", () => {
    const result = normalizeEppRow({ name: "GUANTE NITRILO AZUL", unitOfMeasure: "unidad", size: "M", color: "Azul" })

    expect(result.attributes).toEqual(expect.arrayContaining([
      { name: "Color", value: "Azul" },
      { name: "Talla guantes", value: "M", sizeFamily: "guantes" },
    ]))
    // La talla singular sigue formando parte de la identidad de la variante.
    expect(result.identityKey).toContain("talla guantes=m")
  })

  it("preserves multi-talla through review round-trip", () => {
    const original = normalizeEppRow({ name: "GUANTE NITRILO AZUL", unitOfMeasure: "unidad", size: "S, M, L, XL" })
    const reParsed = normalizeEppRow({ name: "GUANTE NITRILO AZUL", unitOfMeasure: "unidad", size: "S, M, L, XL" })

    expect(original.identityKey).toBe(reParsed.identityKey)
    expect(original.attributes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Talla guantes", values: ["S", "M", "L", "XL"] }),
    ]))
  })
```

Y agrega los casos nuevos que cubren lo que el diseño promete:

```ts
  it("canoniza la talla escrita como la trae la planilla real", () => {
    const guante = normalizeEppRow({ name: "GUANTE CABRITILLA SIN FORRO", unitOfMeasure: "par", size: "T/L" })
    expect(guante.attributes).toEqual(expect.arrayContaining([
      { name: "Talla guantes", value: "L", sizeFamily: "guantes" },
    ]))
    expect(guante.issues).toEqual([])

    const overol = normalizeEppRow({ name: "OVEROL ACTIVEX PILOTO POPLIN", unitOfMeasure: "unidad", size: "XXXL" })
    expect(overol.attributes).toEqual(expect.arrayContaining([
      { name: "Talla", value: "3XL", sizeFamily: "ropa" },
    ]))
  })

  it("acepta con advertencia una talla que el catálogo de la familia no declara", () => {
    const result = normalizeEppRow({ name: "GUANTES DE CABRITILLA", unitOfMeasure: "par", size: "Talla 9-10" })

    expect(result.attributes).toEqual(expect.arrayContaining([
      { name: "Talla guantes", value: "9/10", sizeFamily: "guantes" },
    ]))
    expect(result.issues).toEqual([
      { severity: "warning", message: "La talla «9/10» no está en el catálogo de la familia guantes." },
    ])
  })

  it("advierte cuando un pantalón trae numeración de cintura", () => {
    // Consecuencia visible de mapear `pantalon` a la escala de letras: una
    // cintura 32 no está en `ropa`, entra igual y queda advertida para que
    // alguien decida si esa familia debe sizarse por `Talla inferior`.
    const result = normalizeEppRow({ name: "PANTALON DE TRABAJO", unitOfMeasure: "unidad", size: "32" })

    expect(result.attributes).toEqual(expect.arrayContaining([
      { name: "Talla", value: "32", sizeFamily: "ropa" },
    ]))
    expect(result.issues).toEqual([
      { severity: "warning", message: "La talla «32» no está en el catálogo de la familia ropa." },
    ])
  })

  it("no le pone familia a la talla de un ítem que no se sizea", () => {
    const result = normalizeEppRow({ name: "LENTE ACTIVEX FX III SELLADO", unitOfMeasure: "unidad", size: "M" })

    expect(result.attributes).toEqual(expect.arrayContaining([
      { name: "Talla", value: "M", sizeFamily: null },
    ]))
    expect(result.issues).toEqual([])
  })

  it("deja un solo atributo de talla cuando la columna de atributos ya trae una", () => {
    const result = normalizeEppRow({ name: "GUANTE NITRILO", unitOfMeasure: "par", attributes: "Talla: M; Marca: Showa" })

    const sizeAttributes = result.attributes.filter((attribute) => attribute.name.startsWith("Talla"))
    expect(sizeAttributes).toEqual([{ name: "Talla guantes", value: "M", sizeFamily: "guantes" }])
    expect(result.attributes).toEqual(expect.arrayContaining([{ name: "Marca", value: "Showa" }]))
  })
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm run test:fast -- lib/services/epp-import.test.ts`
Expected: FAIL. Los atributos siguen llamándose `Talla` sin `sizeFamily`, y el caso de la columna `atributos` produce dos atributos de talla.

- [ ] **Step 3: Agregar `sizeFamily` al tipo**

En `lib/services/epp-import.types.ts:11`:

```ts
export interface EppAttribute { name: string; value: string; values?: string[]; sizeFamily?: string | null }
```

- [ ] **Step 4: Agregar el helper que deja una sola talla**

Junto a `addAttribute` y `findMatchingAttribute` (cerca de `:276`):

```ts
/**
 * Deja exactamente un atributo de talla en la fila, con el nombre y la familia
 * que resolvió el catálogo.
 *
 * Reemplaza en vez de agregar porque la talla puede llegar por dos vías a la
 * vez: la columna `talla` y la columna `atributos` («Talla: M»). Sin esto, una
 * fila terminaba con `Talla` y `Talla guantes` a la vez, y el catálogo mostraba
 * la misma talla dos veces con nombres distintos.
 */
function upsertSizeAttribute(attributes: EppAttribute[], resolved: ResolvedSizeAttribute) {
  for (let index = attributes.length - 1; index >= 0; index--) {
    if (isSizeAttributeName(attributes[index]!.name)) attributes.splice(index, 1)
  }
  attributes.push({
    name: resolved.name,
    value: resolved.values.join(", "),
    ...(resolved.values.length > 1 ? { values: resolved.values } : {}),
    sizeFamily: resolved.sizeFamily,
  })
}
```

Extiende el import de `product-size` que agregó la Tarea 3:

```ts
import { isSizeAttributeName, normalizeSizeLabel } from "@/lib/products/product-size"
```

- [ ] **Step 5: Reescribir el bloque de talla de `normalizeEppRow`**

Cambia la firma:

```ts
export function normalizeEppRow(
  source: Record<string, string>,
  familyOptions?: readonly SizeFamilyCodes[],
): NormalizedEppRow {
```

Mueve el cálculo del tipo para que quede **inmediatamente después** del bloque de color y **antes** del de talla, borrándolo de su posición actual (`:235-236`):

```ts
  // Antes del bloque de talla: `resolveSizeAttribute` necesita el tipo para
  // elegir la familia. Es seguro calcularlo aquí porque el ítem que el nombre
  // declara («guante») está presente tanto antes como después de quitarle la
  // talla, que es un código de una o dos posiciones.
  const eppType = inferEppItemType(workingName)
  if (!eppType) issues.push({ severity: "blocking", message: "No se pudo identificar un tipo de EPP en el nombre." })
```

Y reemplaza el bloque completo `const explicitSize = ...` hasta el cierre del `else` (hoy `:212-234`) por:

```ts
  // La talla puede llegar por la columna `talla`, por la columna `atributos`
  // («Talla: M») o dentro del nombre. Se unifican antes de resolver para que la
  // fila termine con un solo atributo de talla.
  const namedSize = corrections.find((attribute) => isSizeAttributeName(attribute.name))
  const explicitSize = cleanText(source.size)
    || (namedSize ? (namedSize.values ?? [namedSize.value]).join(", ") : "")
  const rawSizes = explicitSize
    ? explicitSize.split(",").map((value) => value.trim()).filter(Boolean)
    : []

  if (rawSizes.length === 0) {
    const sizeInName = cleanText(source.model) ? null : extractSize(workingName)
    if (sizeInName) {
      rawSizes.push(sizeInName)
      workingName = cleanText(workingName.replace(new RegExp(`\\btalla\\s+${escapeRegex(sizeInName)}\\b`, "i"), ""))
      workingName = removeToken(workingName, sizeInName)
    }
  }

  if (rawSizes.length > 0) {
    const resolved = resolveSizeAttribute(rawSizes, eppType, familyOptions)
    issues.push(...resolved.issues)
    upsertSizeAttribute(corrections, resolved)
  }
```

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `npm run test:fast -- lib/services/epp-import.test.ts lib/services/epp-import.types.test.ts`
Expected: PASS

- [ ] **Step 7: Correr el typecheck**

Run: `npm run typecheck`
Expected: aprobado. `EppAttribute` es un tipo público que consume el componente de revisión; el campo es opcional, así que no debería romper nada.

- [ ] **Step 8: Commit**

```bash
git add lib/services/epp-import.types.ts lib/services/epp-import.test.ts
git commit -m "feat(epp-import): la talla importada lleva nombre, valor y familia canónicos

\`normalizeEppRow\` usa \`resolveSizeAttribute\` en vez de la heurística de dos
dígitos. Un guante entra como \`Talla guantes\` con \`sizeFamily: guantes\`, un
overol \`XXXL\` como \`Talla: 3XL\`, y un lente —que no se sizea— sigue con el
\`Talla\` genérico sin familia.

\`inferEppItemType\` se calcula antes del bloque de talla porque el resolvedor
necesita el tipo. Es seguro: el ítem que el nombre declara está presente tanto
antes como después de quitarle la talla.

\`upsertSizeAttribute\` deja una sola talla por fila: podía llegar por la columna
\`talla\` y por la columna \`atributos\` a la vez, y la fila terminaba con \`Talla\` y
\`Talla guantes\` juntas.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Correcciones visibles en la revisión

Hoy `buildCorrections` sólo registra una corrección de talla cuando la talla se extrajo del nombre (`:374`). Con la canonización, el operador tiene que poder ver y editar que su `XXXL` se guardó como `3XL` y que se le asignó una familia.

`add()` ya descarta los no-cambios, así que una talla que ya venía canónica no genera ruido.

**Files:**
- Modify: `lib/services/epp-import.types.ts` (`RULE_LABELS` en `:131-138`, `buildCorrections` al final del archivo)
- Test: `lib/services/epp-import.test.ts`

**Interfaces:**
- Consumes: `EppAttribute.sizeFamily` (Tarea 4), `isSizeAttributeName`.
- Produces: correcciones con `ruleId` `canonicalize_size` y `assign_size_family`. El UI de revisión las etiqueta vía `RULE_LABELS` sin cambios (`epp-import-review.tsx:108` cae al `ruleId` crudo si falta la etiqueta).

- [ ] **Step 1: Escribir el test que falla**

Agrega a `lib/services/epp-import.test.ts` (y extiende su import con `buildCorrections`):

```ts
describe("buildCorrections", () => {
  const corrections = (source: Record<string, string>) => buildCorrections(source, normalizeEppRow(source))

  it("registra que la talla se canonizó", () => {
    const result = corrections({ name: "OVEROL ACTIVEX", unitOfMeasure: "unidad", size: "XXXL" })

    expect(result).toEqual(expect.arrayContaining([
      { field: "size", from: "XXXL", to: "3XL", ruleId: "canonicalize_size", confidence: 95 },
    ]))
  })

  it("registra la familia asignada por el tipo de EPP", () => {
    const result = corrections({ name: "GUANTE NITRILO", unitOfMeasure: "par", size: "M" })

    expect(result).toEqual(expect.arrayContaining([
      { field: "sizeFamily", from: null, to: "guantes", ruleId: "assign_size_family", confidence: 90 },
    ]))
  })

  it("no registra corrección de talla cuando ya venía canónica", () => {
    const result = corrections({ name: "GUANTE NITRILO", unitOfMeasure: "par", size: "M" })

    expect(result.filter((correction) => correction.field === "size")).toEqual([])
  })

  it("sigue registrando la talla extraída del nombre", () => {
    const result = corrections({ name: "GUANTE NITRILO TALLA M", unitOfMeasure: "par" })

    expect(result).toEqual(expect.arrayContaining([
      { field: "size", from: null, to: "M", ruleId: "extract_size_from_name", confidence: 85 },
    ]))
  })

  it("no registra familia para un ítem que no se sizea", () => {
    const result = corrections({ name: "LENTE ACTIVEX FX III", unitOfMeasure: "unidad", size: "M" })

    expect(result.filter((correction) => correction.field === "sizeFamily")).toEqual([])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm run test:fast -- lib/services/epp-import.test.ts`
Expected: FAIL. No existen las correcciones `canonicalize_size` ni `assign_size_family`.

- [ ] **Step 3: Agregar las etiquetas**

En `RULE_LABELS`, después de `extract_size_from_name`:

```ts
  canonicalize_size: "Talla estandarizada",
  assign_size_family: "Familia de talla asignada por el tipo de EPP",
```

- [ ] **Step 4: Reemplazar la línea de talla de `buildCorrections`**

Borra la línea `if (!source.size && normalized.attributes.some((attribute) => attribute.name.startsWith("Talla")))...` y pon en su lugar:

```ts
  const sizeAttribute = normalized.attributes.find((attribute) => isSizeAttributeName(attribute.name))
  if (sizeAttribute) {
    // Sin columna `talla`, la talla se dedujo del nombre; con columna, lo que
    // se registra es la canonización de lo que el operador escribió.
    if (!source.size) add("size", null, sizeAttribute.value, "extract_size_from_name", 85)
    else add("size", source.size, sizeAttribute.value, "canonicalize_size", 95)
    if (sizeAttribute.sizeFamily) add("sizeFamily", null, sizeAttribute.sizeFamily, "assign_size_family", 90)
  }
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npm run test:fast -- lib/services/epp-import.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/services/epp-import.types.ts lib/services/epp-import.test.ts
git commit -m "feat(epp-import): muestra la canonización de talla en la revisión

Dos correcciones nuevas con su etiqueta: \`canonicalize_size\` («Talla
estandarizada») y \`assign_size_family\`. El operador ve y puede editar que su
\`XXXL\` quedó como \`3XL\` y que se le asignó la familia \`ropa\`.

La corrección de talla existente sólo se emitía cuando la talla venía en el
nombre; ahora también cuando venía en la columna y se canonizó. \`add()\` descarta
los no-cambios, así que una talla ya canónica no genera ruido.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: El cruce con el catálogo sobrevive al cambio de nombre

`findProductMatches` puntúa «Atributos equivalentes» comparando el nombre del atributo de forma exacta. Al pasar de `Talla` a `Talla guantes`, una fila pierde esos 10-20 puntos y puede caer bajo el umbral 70: entraría como `create` sin que el operador vea el aviso de posible producto existente, es decir, duplicando la variante en silencio.

La corrección deja el matching mejor que hoy: `XXXL` de la planilla pasa a cruzar con `3XL` del catálogo, que hoy no cruza.

**Files:**
- Modify: `lib/services/epp-import.types.ts` (`findProductMatches`, y el helper `attrOptionIncludes` que está justo antes)
- Test: `lib/services/epp-import.test.ts`

**Interfaces:**
- Consumes: `isSizeAttributeName`, `normalizeSizeLabel`, `parseSizeOptions` de `lib/products/product-size.ts`.
- Produces: `findProductMatches` sin cambio de firma.

- [ ] **Step 1: Escribir el test que falla**

Agrega a `lib/services/epp-import.test.ts` (extendiendo su import con `findProductMatches`):

```ts
describe("findProductMatches", () => {
  const existing = [{
    id: "p-guante",
    name: "Guante Nitrilo",
    unitOfMeasure: "par",
    productAttributes: [{ name: "Talla", options: JSON.stringify(["M"]) }],
  }]

  it("cruza la talla aunque el atributo se llame distinto", () => {
    const normalized = normalizeEppRow({ name: "GUANTE NITRILO", unitOfMeasure: "par", size: "M" })
    const matches = findProductMatches(normalized, existing)

    expect(matches).toHaveLength(1)
    expect(matches[0]!.reasons).toContain("Atributos equivalentes")
  })

  it("cruza dos formas de escribir la misma talla", () => {
    const catalogo3xl = [{
      id: "p-overol",
      name: "Overol Activex",
      unitOfMeasure: "unidad",
      productAttributes: [{ name: "Talla", options: JSON.stringify(["3XL"]) }],
    }]
    const normalized = normalizeEppRow({ name: "OVEROL ACTIVEX", unitOfMeasure: "unidad", size: "XXXL" })

    expect(findProductMatches(normalized, catalogo3xl)[0]!.reasons).toContain("Atributos equivalentes")
  })

  it("no cruza tallas distintas de la misma familia", () => {
    const normalized = normalizeEppRow({ name: "GUANTE NITRILO", unitOfMeasure: "par", size: "XL" })

    expect(findProductMatches(normalized, existing)[0]!.reasons).not.toContain("Atributos equivalentes")
  })

  it("sigue exigiendo nombre exacto para los atributos que no son talla", () => {
    const catalogo = [{
      id: "p-lente",
      name: "Lente Activex",
      unitOfMeasure: "unidad",
      productAttributes: [{ name: "Modelo", options: JSON.stringify(["FX III"]) }],
    }]
    const normalized = normalizeEppRow({ name: "LENTE ACTIVEX", unitOfMeasure: "unidad", model: "Matrix III" })

    expect(findProductMatches(normalized, catalogo)[0]!.reasons).not.toContain("Atributos equivalentes")
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm run test:fast -- lib/services/epp-import.test.ts`
Expected: FAIL en los dos primeros casos: `Talla guantes` no cruza con `Talla`, y `3XL` no cruza con `XXXL`.

- [ ] **Step 3: Implementar la equivalencia de talla**

Extiende el import de `product-size`:

```ts
import { isSizeAttributeName, normalizeSizeLabel, parseSizeOptions } from "@/lib/products/product-size"
```

Agrega junto a `attrOptionIncludes`:

```ts
/**
 * Una opción de talla equivale a un valor si coinciden ya canonizadas. Es lo
 * que permite que `XXXL` de la planilla cruce con `3XL` del catálogo, y lo que
 * evita que renombrar el atributo a `Talla guantes` le quite a la fila los
 * puntos de «atributos equivalentes» y la deje entrar como producto nuevo.
 */
function sizeOptionIncludes(options: string | null, value: string): boolean {
  const target = normalizeSizeLabel(value)
  return parseSizeOptions(options).some((option) => normalizeSizeLabel(option) === target)
}
```

Y reemplaza el cálculo de `sameAttributes` dentro de `findProductMatches`:

```ts
    const sameAttributes = normalized.attributes.filter((attribute) => {
      const values = attribute.values ?? [attribute.value]
      const attributeIsSize = isSizeAttributeName(attribute.name)
      return values.some((value) => product.productAttributes.some((existing) => {
        // Dos atributos de talla son el mismo eje aunque se llamen distinto:
        // el catálogo tiene `Talla`, `Talla guantes` y `Talla calzado` para lo
        // que conceptualmente es una sola cosa.
        const sameAxis = attributeIsSize
          ? isSizeAttributeName(existing.name)
          : normalizeKey(existing.name) === normalizeKey(attribute.name)
        if (!sameAxis) return false
        return attributeIsSize
          ? sizeOptionIncludes(existing.options, value)
          : attrOptionIncludes(existing.options, value)
      }))
    }).length
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm run test:fast -- lib/services/epp-import.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/services/epp-import.types.ts lib/services/epp-import.test.ts
git commit -m "fix(epp-import): el cruce con el catálogo sobrevive al renombre de la talla

\`findProductMatches\` comparaba el nombre del atributo de forma exacta. Al pasar
de \`Talla\` a \`Talla guantes\`, una fila perdía los 10-20 puntos de «atributos
equivalentes» y podía caer bajo el umbral 70: entraría como \`create\` sin avisar
del posible producto existente, duplicando la variante en silencio.

Dos atributos de talla son el mismo eje aunque se llamen distinto, y sus valores
se comparan canonizados. Queda mejor que antes: \`XXXL\` de la planilla ahora
cruza con \`3XL\` del catálogo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Los códigos válidos vienen de `size_catalog`

`normalizeEppRow` tiene dos llamadores en el servidor y ambos deben pasarle los códigos reales de la base. Las opciones se leen **antes** de abrir la transacción: son dato de referencia y no necesitan ser tx-aware.

**Files:**
- Modify: `lib/services/epp-import.ts:57-108` (`stageEppImportXlsx`), `:122-141` (`reviewEppImportRow`), `:193-217` (`validateReviewedNormalized`)
- Test: cubierto por la Tarea 8 (PGlite) y por el typecheck

**Interfaces:**
- Consumes: `normalizeEppRow(source, familyOptions?)` (Tarea 4); `getSizeFamilyOptions()` de `lib/services/sizes.ts`, que devuelve `Array<{ family: string; attributeName: string; codes: string[] }>`.
- Produces: `validateReviewedNormalized(value, sourceCode, familyOptions)` — tercer parámetro obligatorio, función privada del módulo.

- [ ] **Step 1: Agregar el import**

En `lib/services/epp-import.ts`, junto a los otros imports de servicios:

```ts
import { getSizeFamilyOptions } from "@/lib/services/sizes"
```

- [ ] **Step 2: Pasar las opciones al staging**

En `stageEppImportXlsx`, después de la lectura de `existingProducts` y **antes** de `await db.transaction(...)`:

```ts
  // Dato de referencia, no tx-aware: los códigos de cada familia no cambian
  // durante el lote y leerlos dentro de la transacción sólo la alargaría.
  const sizeFamilyOptions = await getSizeFamilyOptions()
```

Y en el `for` de filas, cambia la llamada:

```ts
      const normalized = normalizeEppRow(source.values, sizeFamilyOptions)
```

- [ ] **Step 3: Pasar las opciones a la revisión de una fila**

En `reviewEppImportRow`, reemplaza la línea que construye `normalized`:

```ts
  const previous = JSON.parse(row.normalizedJson) as NormalizedEppRow
  const sizeFamilyOptions = input.normalizedJson ? await getSizeFamilyOptions() : []
  const normalized = input.normalizedJson
    ? validateReviewedNormalized(input.normalizedJson, previous.sourceCode, sizeFamilyOptions)
    : previous
```

- [ ] **Step 4: Aceptar el parámetro en el validador**

En `validateReviewedNormalized`, cambia la firma y la llamada interna. El filtro de atributos ya usa `startsWith("Talla")`, que sigue capturando `Talla guantes`, así que no cambia:

```ts
function validateReviewedNormalized(
  value: string,
  sourceCode: string | null,
  familyOptions: readonly SizeFamilyCodes[],
) {
```

```ts
  const normalized = normalizeEppRow({
    sourceCode: sourceCode ?? "", name: raw.name ?? "", description: raw.description ?? "", supplierName: raw.supplierName ?? "",
    price: raw.price == null ? "" : String(raw.price), categoryName: raw.categoryName ?? DEFAULT_CATEGORY.name,
    unitOfMeasure: raw.unitOfMeasure ?? "", attributes: attrString,
    size,
    color,
    brand: raw.brand ?? "", model: raw.model ?? "", material: raw.material ?? "",
  }, familyOptions)
```

Agrega `type SizeFamilyCodes` al import que ya trae `normalizeEppRow` desde `./epp-import.types`.

- [ ] **Step 5: Correr el typecheck y los tests del importador**

Run: `npm run typecheck && npm run test:fast -- lib/services/epp-import.test.ts lib/services/epp-import.types.test.ts`
Expected: aprobado y PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/services/epp-import.ts
git commit -m "feat(epp-import): valida la talla contra \`size_catalog\` y no contra la semilla

Los dos llamadores de \`normalizeEppRow\` en el servidor —el staging del lote y la
revisión de una fila— le pasan los códigos que la base declara, honrando la
decisión ya registrada en \`size-catalog.ts\` de que la base manda: una talla dada
de baja con \`is_active = false\` deja de aceptarse como canónica.

Las opciones se leen antes de abrir la transacción: son dato de referencia y no
cambian durante el lote.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `size_family` llega a la base

Es el defecto de fondo: `persistProductDetails` inserta los atributos sin ese campo, así que **todo lo importado tiene `product_attributes.size_family = NULL`** y no puede cruzarse con `size_catalog` ni con las tallas habituales del padrón, aunque `workerSizeFieldFor` ya sepa mapearlas.

**Files:**
- Modify: `lib/services/epp-import.ts:264-283` (`persistProductDetails`)
- Create: `lib/__tests__/epp-import-size-family.test.ts`
- Modify: `tests/pglite-files.ts`

**Interfaces:**
- Consumes: `EppAttribute.sizeFamily` (Tarea 4), `confirmEppImportBatch` (ya existe).
- Produces: filas de `product_attributes` con `size_family` poblado. Ningún consumidor nuevo.

- [ ] **Step 1: Escribir el test de integración que falla**

Crea `lib/__tests__/epp-import-size-family.test.ts`, calcado del andamiaje de `lib/__tests__/epp-import-family-type.test.ts`:

```ts
/**
 * `product_attributes.size_family` es lo que permite cruzar una variante con
 * `size_catalog` y con la talla habitual del padrón (`workers.size_*`). El
 * importador nunca lo escribía, así que todo el catálogo importado lo tenía en
 * NULL: `workerSizeFieldFor` sabía mapear `Talla guantes → sizeGloves`, pero
 * ninguna variante importada llevaba ese nombre ni esa familia.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { normalizeEppRow, confirmEppImportBatch } = await import("@/lib/services/epp-import")

const userId = nanoid()

async function stageAndConfirm(source: Record<string, string>) {
  const batchId = nanoid()
  await inMemoryDb.insert(schema.eppImportBatches).values({
    id: batchId, fileName: "tallas.xlsx", fileHash: nanoid(), status: "review",
    sourceFileData: "", createdBy: userId,
  })
  const normalized = normalizeEppRow(source)
  await inMemoryDb.insert(schema.eppImportRows).values({
    id: nanoid(), batchId, rowNumber: 1, sourceCode: normalized.sourceCode,
    originalJson: JSON.stringify(source), normalizedJson: JSON.stringify(normalized),
    identityKey: normalized.identityKey, severity: "info", decision: "create",
  })
  await confirmEppImportBatch(batchId, userId)
  return normalized
}

beforeAll(async () => {
  await inMemoryDb.insert(schema.productCategories).values({
    id: "cat-epp", name: "Elementos de Protección Personal", slug: "epp",
    isEpp: true, requiresPrevencion: true,
  }).onConflictDoNothing()
})

describe("importación de EPP y familia de talla", () => {
  it("deja la variante de guante con su nombre de atributo y su familia", async () => {
    await stageAndConfirm({ name: "GUANTE NITRILO SHOWA", unitOfMeasure: "par", size: "T/L" })

    const product = await inMemoryDb.query.products.findFirst({
      where: eq(schema.products.name, "Guante Nitrilo Showa"),
      with: { productAttributes: true },
    })

    const size = product!.productAttributes.find((attribute) => attribute.name.startsWith("Talla"))
    expect(size).toBeDefined()
    expect(size!.name).toBe("Talla guantes")
    expect(size!.sizeFamily).toBe("guantes")
    expect(JSON.parse(size!.options!)).toEqual(["L"])
  })

  it("deja la variante de botín con la familia de calzado", async () => {
    await stageAndConfirm({ name: "BOTIN SEGURIDAD STEELPRO", unitOfMeasure: "par", size: "42.0" })

    const product = await inMemoryDb.query.products.findFirst({
      where: eq(schema.products.name, "Botin Seguridad Steelpro"),
      with: { productAttributes: true },
    })

    const size = product!.productAttributes.find((attribute) => attribute.name.startsWith("Talla"))
    expect(size!.name).toBe("Talla calzado")
    expect(size!.sizeFamily).toBe("calzado")
    expect(JSON.parse(size!.options!)).toEqual(["42"])
  })

  it("no le inventa familia a la talla de un ítem que no se sizea", async () => {
    await stageAndConfirm({ name: "LENTE ACTIVEX FX III", unitOfMeasure: "unidad", size: "M" })

    const product = await inMemoryDb.query.products.findFirst({
      where: eq(schema.products.name, "Lente Activex Fx Iii"),
      with: { productAttributes: true },
    })

    const size = product!.productAttributes.find((attribute) => attribute.name.startsWith("Talla"))
    expect(size!.name).toBe("Talla")
    expect(size!.sizeFamily).toBeNull()
  })
})
```

Si el nombre canónico que espera alguna consulta no calza, corrígelo con el valor real que devuelve `normalizeEppRow` en el mismo test (`titleCase` lo produce), no con un `ilike`.

- [ ] **Step 2: Registrar el test en el proyecto secuencial**

En `tests/pglite-files.ts`, junto a `"lib/__tests__/epp-import-family-type.test.ts"`:

```ts
  "lib/__tests__/epp-import-size-family.test.ts",
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npm run test:pglite -- lib/__tests__/epp-import-size-family.test.ts`
Expected: FAIL. `size_family` viene `null` para el guante y el botín.

- [ ] **Step 4: Persistir el campo**

En `persistProductDetails`:

```ts
  if (normalized.attributes.length) await tx.insert(productAttributes).values(normalized.attributes.map((attribute, index) => ({
    id: nanoid(), productId, categoryId: null, name: attribute.name, type: "select",
    isRequired: true, options: JSON.stringify(attribute.values ?? [attribute.value]),
    sizeFamily: attribute.sizeFamily ?? null, sortOrder: index,
  })))
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npm run test:pglite -- lib/__tests__/epp-import-size-family.test.ts`
Expected: PASS

- [ ] **Step 6: Correr los otros tests PGlite del importador y del catálogo**

Run: `npm run test:pglite -- lib/__tests__/epp-import-family-type.test.ts lib/__tests__/admin-product-attributes-persistence.test.ts lib/__tests__/epp-stock-availability.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/services/epp-import.ts lib/__tests__/epp-import-size-family.test.ts tests/pglite-files.ts
git commit -m "fix(epp-import): persiste \`size_family\` en los atributos importados

\`persistProductDetails\` insertaba los atributos sin ese campo, así que todo el
catálogo importado tenía \`product_attributes.size_family = NULL\`. Es el defecto
de fondo del sistema de tallas: sin familia, una variante importada no puede
cruzarse con \`size_catalog\` ni con la talla habitual del padrón, aunque
\`workerSizeFieldFor\` ya supiera mapear \`Talla guantes → sizeGloves\`.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Regresión — el backfill de ropa deja de tocar guantes

`addMissingClothingSizeVariants` decide que una familia usa la escala de ropa cuando su atributo de talla normaliza a exactamente `"talla"`. Como hasta ahora un guante importado llevaba `Talla: T/L`, ese backfill **le inyectaba variantes XS..2XL de ropa a familias de guantes**. Con `Talla guantes` quedan correctamente excluidas.

Esta tarea no cambia código: fija con un test que el bug quedó cerrado, para que nadie lo reabra renombrando el atributo.

**Files:**
- Modify: `lib/__tests__/epp-clothing-sizes.test.ts`

**Interfaces:**
- Consumes: `addMissingClothingSizeVariants` y el helper `createFamilyWithVariant` que el test ya define, con su parámetro `sizeAttrName`.
- Produces: nada.

- [ ] **Step 1: Leer los helpers del test para usarlos tal como están**

Run: `sed -n 1,120p lib/__tests__/epp-clothing-sizes.test.ts`

Confirma la firma de `createFamilyWithVariant` y cómo el archivo cuenta las variantes creadas. Usa esos helpers, no unos nuevos.

- [ ] **Step 2: Escribir el test**

Agrega un caso al `describe` existente, adaptando los nombres de helper a lo que el Step 1 mostró:

```ts
  it("no le inyecta la escala de ropa a una familia de guantes", async () => {
    // El importador dejaba los guantes con `Talla: T/L`, que normaliza a
    // "talla", así que este backfill los tomaba por ropa y les creaba
    // XS..2XL. Con `Talla guantes` la familia queda fuera.
    await createFamilyWithVariant({
      familyId: "fam-guante",
      canonicalName: "Guante Nitrilo Showa",
      productName: "Guante Nitrilo Showa",
      sizeAttrName: "Talla guantes",
      size: "L",
    })

    const summary = await addMissingClothingSizeVariants()

    expect(summary.results.some((result) => result.familyId === "fam-guante")).toBe(false)
    const variants = await inMemoryDb.query.products.findMany({
      where: eq(schema.products.familyId, "fam-guante"),
    })
    expect(variants).toHaveLength(1)
  })
```

- [ ] **Step 3: Correr el test y verificar que pasa**

Run: `npm run test:pglite -- lib/__tests__/epp-clothing-sizes.test.ts`
Expected: PASS. Este test pasa sin cambiar código: fija la conducta que las tareas anteriores hicieron alcanzable.

- [ ] **Step 4: Verificación final del conjunto**

Run: `npm run typecheck`
Expected: aprobado

Run: `npm run test:fast -- lib/products lib/services/epp-import.test.ts lib/services/epp-import.types.test.ts app/\(app\)/solicitudes`
Expected: PASS

Run: `npm run test:pglite -- lib/__tests__/epp-import-size-family.test.ts lib/__tests__/epp-import-family-type.test.ts lib/__tests__/epp-clothing-sizes.test.ts lib/__tests__/epp-delivery-scale-reconciliation.test.ts lib/__tests__/deliveries-size-stock-pglite.test.ts`
Expected: PASS

Run: `npx eslint lib/products/product-size.ts lib/services/epp-import.ts lib/services/epp-import.types.ts`
Expected: sin errores

Run: `git diff --check`
Expected: sin salida

- [ ] **Step 5: Commit**

```bash
git add lib/__tests__/epp-clothing-sizes.test.ts
git commit -m "test(epp): fija que el backfill de ropa no toca familias de guantes

\`addMissingClothingSizeVariants\` reconoce «familia de ropa» por el atributo que
normaliza a \"talla\". Con el importador dejando los guantes en \`Talla: T/L\`, les
inyectaba variantes XS..2XL. Ahora que entran como \`Talla guantes\` quedan fuera,
y este test evita que se reabra el bug renombrando el atributo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Fuera de alcance de este plan

- **Conciliar los datos ya importados** (`T/L`, `TALLA 9-10`, `XXXL` que están hoy en `product_attributes`). Cambia la identidad de variantes con histórico de stock, compras y entregas, y el editor de productos bloquea justamente ese cambio cuando la variante ya se usó. Es el «punto 3» y necesita su propio diseño.
- **Uniformar la familia** cuando una de sus variantes se reimporta.
- **Que `size_catalog` aprenda tallas nuevas** de lo que se importa. La advertencia de la Tarea 3 es la señal para que una persona lo decida.
- **La equivalencia numérica↔letra de guantes** (`9/10 → L`). Varía por fabricante; una tabla única estaría mal para algún proveedor y el error quedaría invisible dentro de la importación.
