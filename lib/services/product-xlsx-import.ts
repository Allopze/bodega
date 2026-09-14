import ExcelJS from "exceljs"
import { asc, eq, inArray, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { productAttributes, productCategories, products, productSuppliers, suppliers } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { toCode } from "@/lib/utils"
import { loadActiveUnitCodes, normalizeUnitCode, unitNotInCatalogMessage } from "@/lib/services/product-unit-catalog"

const DEFAULT_EPP_CATEGORY = {
  id: "cat-epp",
  name: "Elementos de Protección Personal",
  slug: "epp",
  isEpp: true,
  requiresPrevencion: true,
  sortOrder: 10,
}

const HEADER_ALIASES: Record<string, keyof ProductImportColumns> = {
  sku: "sku",
  codigo: "sku",
  cod: "sku",
  nombre: "name",
  producto: "name",
  descripcion: "description",
  detalle: "description",
  proveedor: "supplierName",
  precio: "price",
  valor: "price",
  unidad: "unitOfMeasure",
  categoria: "categoryName",
  atributos: "attributes",
  atributo: "attributes",
  notas: "notes",
  nota: "notes",
}

interface ProductImportColumns {
  sku?: number
  name?: number
  description?: number
  supplierName?: number
  price?: number
  unitOfMeasure?: number
  categoryName?: number
  attributes?: number
  notes?: number
}

export interface ParsedProductImportItem {
  rowNumber: number
  sku: string
  name: string
  description: string | null
  supplierName: string | null
  price: number | null
  unitOfMeasure: string
  categoryName: string | null
  attributes: Array<{ name: string; value: string }>
  notes?: string | null
}

export interface ParsedProductImport {
  items: ParsedProductImportItem[]
  errors: string[]
}

export interface ProductImportResult {
  totalRows: number
  created: number
  updated: number
  suppliersCreated: number
  categoriesCreated: number
  errors: string[]
}

export async function parseProductImportWorkbook(buffer: Buffer): Promise<ParsedProductImport> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer as never)
  } catch {
    return { items: [], errors: ["El archivo no es un Excel válido o está dañado."] }
  }

  const sheet = workbook.worksheets[0]
  if (!sheet) return { items: [], errors: ["El archivo no contiene hojas."] }

  const headerRow = sheet.getRow(1)
  const columns = readHeaderColumns(headerRow.values)
  const errors: string[] = []

  if (!columns.sku) errors.push("Falta la columna SKU.")
  if (!columns.name) errors.push("Falta la columna Nombre.")
  if (errors.length > 0) return { items: [], errors }

  const items: ParsedProductImportItem[] = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    if (isBlankRow(row.values)) return

    const sku = toCode(cellText(row.getCell(columns.sku!).value))
    const name = cellText(row.getCell(columns.name!).value)
    const rowErrors: string[] = []
    if (!sku) rowErrors.push(`Fila ${rowNumber}: SKU es obligatorio.`)
    if (!name) rowErrors.push(`Fila ${rowNumber}: Nombre es obligatorio.`)
    if (rowErrors.length > 0) {
      errors.push(...rowErrors)
      return
    }

    const notes = optionalCell(row, columns.notes)
    items.push({
      rowNumber,
      sku,
      name,
      description: optionalCell(row, columns.description),
      supplierName: optionalCell(row, columns.supplierName),
      price: parsePrice(optionalCell(row, columns.price)),
      unitOfMeasure: optionalCell(row, columns.unitOfMeasure) ?? "unidad",
      categoryName: optionalCell(row, columns.categoryName),
      attributes: parseAttributes(optionalCell(row, columns.attributes)),
      ...(notes ? { notes } : {}),
    })
  })

  return { items, errors }
}

export async function importProductsFromXlsx(buffer: Buffer): Promise<ProductImportResult> {
  const parsed = await parseProductImportWorkbook(buffer)
  if (parsed.errors.length > 0) {
    return {
      totalRows: parsed.items.length,
      created: 0,
      updated: 0,
      suppliersCreated: 0,
      categoriesCreated: 0,
      errors: parsed.errors,
    }
  }

  /*
   * CAT-003 (auditoría 2026-09-14): la unidad de cada fila tiene que existir en
   * el catálogo `product_units` y estar activa. Este importador escribía el
   * texto crudo de la planilla —sin normalizar siquiera espacios ni caja—, así
   * que era el camino por el que entraban las unidades fuera de catálogo
   * ("Cajas ", "UN.") que la migración 0229 tuvo que sanear a mano.
   *
   * Se comprueba ANTES de abrir la transacción y para todas las filas juntas:
   * el importador tiene contrato de "todo o nada con errores por fila", y
   * dejar que la FK de base reventara a mitad del lote devolvería un error del
   * driver sin decir qué fila lo causó.
   */
  const activeUnits = await loadActiveUnitCodes()
  const normalizedItems = parsed.items.map((item) => ({ ...item, unitOfMeasure: normalizeUnitCode(item.unitOfMeasure) }))
  const unitErrors = normalizedItems
    .filter((item) => !activeUnits.has(item.unitOfMeasure))
    .map((item) => `Fila ${item.rowNumber}: ${unitNotInCatalogMessage(item.unitOfMeasure)}`)
  if (unitErrors.length > 0) {
    return {
      totalRows: parsed.items.length,
      created: 0,
      updated: 0,
      suppliersCreated: 0,
      categoriesCreated: 0,
      errors: unitErrors,
    }
  }

  const result: ProductImportResult = {
    totalRows: parsed.items.length,
    created: 0,
    updated: 0,
    suppliersCreated: 0,
    categoriesCreated: 0,
    errors: [],
  }

  await db.transaction(async (tx) => {
    const categoryCache = new Map<string, { id: string; created: boolean }>()
    const supplierCache = new Map<string, { id: string; created: boolean }>()
    const importSkus = [...new Set(normalizedItems.map((item) => item.sku))]
    // This import mutates a batch one row at a time, but it first locks all
    // existing targets in the same database order as EPP request preflight.
    // That removes a multi-product lock cycle regardless of Excel row order.
    const existingBySku = new Map(
      (await tx
        .select({ id: products.id, sku: products.sku })
        .from(products)
        .where(inArray(products.sku, importSkus))
        .orderBy(asc(products.id))
        .for("update"))
        .map((product) => [product.sku, product] as const),
    )

    for (const item of normalizedItems) {
      const category = await resolveCategory(tx, item.categoryName, categoryCache)
      if (category.created) result.categoriesCreated += 1

      const supplier = item.supplierName
        ? await resolveSupplier(tx, item.supplierName, supplierCache)
        : null
      if (supplier?.created) result.suppliersCreated += 1

      let existing = existingBySku.get(item.sku)
      const productId = existing?.id ?? nanoid()
      const notes = [
        item.notes,
        `Importado desde Excel. Fila ${item.rowNumber}.`,
      ].filter(Boolean).join(" ")

      if (existing) {
        result.updated += 1
        await tx.update(products).set({
          name: item.name,
          description: item.description,
          categoryId: category.id,
          unitOfMeasure: item.unitOfMeasure,
          isEpp: true,
          requiresPrevencion: true,
          referencePrice: item.price,
          notes,
          isActive: true,
          updatedAt: new Date().toISOString(),
        }).where(eq(products.id, productId))
      } else {
        result.created += 1
        await tx.insert(products).values({
          id: productId,
          sku: item.sku,
          name: item.name,
          description: item.description,
          categoryId: category.id,
          unitOfMeasure: item.unitOfMeasure,
          isEpp: true,
          requiresPrevencion: true,
          referencePrice: item.price,
          notes,
          isActive: true,
        })
        // Preserve the historical behavior for a repeated SKU within the same
        // workbook: subsequent rows update the row created by the first one.
        existing = { id: productId, sku: item.sku }
        existingBySku.set(item.sku, existing)
      }

      await tx.delete(productAttributes).where(eq(productAttributes.productId, productId))
      if (item.attributes.length > 0) {
        await tx.insert(productAttributes).values(item.attributes.map((attribute, index) => ({
          id: nanoid(),
          productId,
          categoryId: null,
          name: attribute.name,
          type: "select",
          isRequired: true,
          options: JSON.stringify([attribute.value]),
          sortOrder: index,
        })))
      }

      if (supplier) {
        await tx.insert(productSuppliers).values({
          id: nanoid(),
          productId,
          supplierId: supplier.id,
          unitPrice: item.price,
          isPreferred: true,
          notes: item.description,
        }).onConflictDoUpdate({
          target: [productSuppliers.productId, productSuppliers.supplierId],
          set: {
            unitPrice: item.price,
            isPreferred: true,
            notes: item.description,
            lastUpdated: new Date().toISOString(),
          },
        })
      }
    }
  })

  return result
}

function readHeaderColumns(values: ExcelJS.CellValue[] | { [key: string]: ExcelJS.CellValue }): ProductImportColumns {
  const columns: ProductImportColumns = {}
  if (!Array.isArray(values)) return columns

  values.forEach((value, index) => {
    const header = normalizeHeader(cellText(value))
    const column = HEADER_ALIASES[header]
    if (column && !columns[column]) columns[column] = index
  })

  return columns
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("es-CL")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
}

function isBlankRow(values: ExcelJS.CellValue[] | { [key: string]: ExcelJS.CellValue }): boolean {
  if (!Array.isArray(values)) return true
  return values.every((value) => cellText(value) === "")
}

function optionalCell(row: ExcelJS.Row, index: number | undefined): string | null {
  if (!index) return null
  const value = cellText(row.getCell(index).value)
  return value || null
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return ""
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === "object") {
    if ("text" in value && value.text != null) return String(value.text).trim()
    if ("result" in value && value.result != null) return cellText(value.result as ExcelJS.CellValue)
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("").trim()
    }
    if ("hyperlink" in value && "text" in value && value.text != null) return String(value.text).trim()
    return ""
  }
  return String(value).trim()
}

function parsePrice(value: string | null): number | null {
  if (!value) return null
  const normalized = value
    .replace(/\$/g, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function parseAttributes(value: string | null): Array<{ name: string; value: string }> {
  if (!value) return []
  return value
    .split(/[;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [rawName, ...rawValue] = part.split(":")
      const name = rawName?.trim()
      const attributeValue = rawValue.join(":").trim()
      if (!name || !attributeValue) return null
      return { name, value: attributeValue }
    })
    .filter((attribute): attribute is { name: string; value: string } => attribute != null)
}

async function resolveCategory(
  tx: Tx,
  categoryName: string | null,
  cache: Map<string, { id: string; created: boolean }>,
) {
  const name = categoryName || DEFAULT_EPP_CATEGORY.name
  const slug = categoryName ? toCode(categoryName).toLocaleLowerCase("es-CL") : DEFAULT_EPP_CATEGORY.slug
  const cached = cache.get(slug)
  if (cached) return { id: cached.id, created: false }

  const existing = await tx.query.productCategories.findFirst({ where: eq(productCategories.slug, slug) })
  if (existing) {
    cache.set(slug, { id: existing.id, created: false })
    return { id: existing.id, created: false }
  }

  const id = categoryName ? `cat-${slug}` : DEFAULT_EPP_CATEGORY.id
  await tx.insert(productCategories).values({
    id,
    name,
    slug,
    isEpp: true,
    requiresPrevencion: true,
    sortOrder: DEFAULT_EPP_CATEGORY.sortOrder,
  }).onConflictDoNothing()
  cache.set(slug, { id, created: true })
  return { id, created: true }
}

async function resolveSupplier(
  tx: Tx,
  supplierName: string,
  cache: Map<string, { id: string; created: boolean }>,
) {
  const key = toCode(supplierName).toLocaleLowerCase("es-CL")
  const cached = cache.get(key)
  if (cached) return { id: cached.id, created: false }

  const [existing] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(sql`lower(${suppliers.name}) = ${supplierName.toLocaleLowerCase("es-CL")}`)
    .limit(1)
  if (existing) {
    cache.set(key, { id: existing.id, created: false })
    return { id: existing.id, created: false }
  }

  const id = `sup-${key}`
  await tx.insert(suppliers).values({
    id,
    name: supplierName,
    isActive: true,
    notes: "Creado por importación Excel de EPP.",
  }).onConflictDoNothing()
  cache.set(key, { id, created: true })
  return { id, created: true }
}
