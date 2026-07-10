/**
 * Reconstruye items_normalizados_importacion_fixed.xlsx desde los datos
 * originales con normalización: elimina duplicados, normaliza SKU y atributos.
 */

import ExcelJS from "exceljs"
import path from "node:path"

const FILE = process.argv[2] || "items_normalizados_importacion_fixed.xlsx"

// ─── DATOS ORIGINALES DEL XLSX ─────────────────────────
// (extraídos de la primera lectura exitosa)

const HEADER = ["SKU", "Nombre", "Proveedor", "Precio", "Atributos"]

const RAW_DATA = [
  //  TRECK items
  ["TRECK-LENTE-ACTIVEX-MATRIX-III-FULL-ANTIEMPANO-CON-SELLO-IN-", "Lente Activex Matrix III Full Antiempaño con sello in/out", "TRECK", 3500, "Modelo: Matrix III"],
  ["TRECK-CAMISA-ABSOLUTE-ZERO-LIGHTWIND-H2600-T-M-AZUL-MARINO", "Camisa Absolute Zero Lightwind H2600", "TRECK", 12900, "Talla: T/M; Color: Azul marino; Modelo: Lightwind H2600"],
  ["TRECK-CAMISA-ABSOLUTE-ZERO-LIGHTWIND-H2600-T-S-AZUL-MARINO", "Camisa Absolute Zero Lightwind H2600", "TRECK", 12900, "Talla: T/S; Color: Azul marino; Modelo: Lightwind H2600"],
  ["TRECK-CAMISA-ABSOLUTE-ZERO-LIGHTWIND-H2600-T-L-AZUL-MARINO", "Camisa Absolute Zero Lightwind H2600", "TRECK", 12900, "Talla: T/L; Color: Azul marino; Modelo: Lightwind H2600"],
  ["TRECK-PANTALON-LIGHTWIND-H3200-NYLON-SPANDEX-HOMBRE-T-S-BEIG", "Pantalón Lightwind H3200 nylon spandex hombre", "TRECK", 26400, "Talla: T/S; Color: Beige; Modelo: UV"],
  ["TRECK-PANTALON-LIGHTWIND-H3200-NYLON-SPANDEX-HOMBRE-T-L-BEIG", "Pantalón Lightwind H3200 nylon spandex hombre", "TRECK", 26400, "Talla: T/L; Color: Beige; Modelo: UV"],
  ["TRECK-PANTALON-LIGHTWIND-H3200-NYLON-SPANDEX-HOMBRE-T-XL-BEI", "Pantalón Lightwind H3200 nylon spandex hombre", "TRECK", 26400, "Talla: T/XL; Color: Beige; Modelo: UV"],
  ["TRECK-CHALECO-GEOLOGO-ACTIVEX-GABARDINA-TERRA-BICOLOR-T-L-AM", "Chaleco geólogo Activex gabardina terra bicolor", "TRECK", 9400, "Talla: T/L; Color: Amarillo; Modelo: Con logo Chome"],
  ["TRECK-CHALECO-GEOLOGO-ACTIVEX-GABARDINA-TERRA-BICOLOR-T-S-AM", "Chaleco geólogo Activex gabardina terra bicolor", "TRECK", 9400, "Talla: T/S; Color: Amarillo"],
  ["TRECK-VISOR-ACTIVEX-POLICARBONATO-C-PORTA-VISOR", "Visor Activex policarbonato c/porta visor", "TRECK", 5100, "Modelo: Control de residuos"],
  ["TRECK-FONO-HL-VERISHIELD-VS120DH-P-CASCO-DIELEC", "Fono HL Verishield VS120DH p/casco Dielec", "TRECK", 12200, "Modelo: SNR 31 dB 1035201"],
  ["TRECK-TRAJE-PU-VERDE-ACTIVEX-T-M-VERDE", "Traje PU Verde Activex", "TRECK", 13900, "Talla: T/M; Color: Verde; Modelo: Pantalón"],
  ["TRECK-TRAJE-PU-VERDE-ACTIVEX-T-L-VERDE", "Traje PU Verde Activex", "TRECK", 13900, "Talla: T/L; Color: Verde; Modelo: Pantalón"],
  ["TRECK-TRAJE-PU-VERDE-ACTIVEX-T-XL-VERDE", "Traje PU Verde Activex", "TRECK", 13900, "Talla: T/XL; Color: Verde; Modelo: Pantalón"],
  ["TRECK-TRAJE-PU-VERDE-ACTIVEX-T-XXL-VERDE", "Traje PU Verde Activex", "TRECK", 13900, "Talla: T/XXL; Color: Verde; Modelo: Pantalón"],
  ["TRECK-LENTE-ACTIVEX-FX-III-SELLADO-CLARO", "Lente Activex FX III sellado", "TRECK", 2240, "Color: Claro; Modelo: FX III"],
  ["TRECK-GUANTE-ACTIVEX-NITRILO-HEAVY-DUTY-PUNO-ROJO-T-L-ROJO", "Guante Activex Nitrilo Heavy Duty puño rojo", "TRECK", 1900, "Talla: T/L; Color: Rojo; Modelo: Seguridad"],
  ["TRECK-GUANTE-ACTIVEX-NITRILO-HEAVY-DUTY-PUNO-ROJO-T-XL-ROJO", "Guante Activex Nitrilo Heavy Duty puño rojo", "TRECK", 1900, "Talla: T/XL; Color: Rojo; Modelo: Seguridad"],
  ["TRECK-GUANTE-CABRITILLA-ACTIVEX-SIN-FORRO-GRIS-T-M-GRIS", "Guante Cabritilla Activex sin forro gris", "TRECK", 930, "Talla: T/M; Color: Gris; Modelo: Sin forro"],
  ["TRECK-GUANTE-CABRITILLA-ACTIVEX-SIN-FORRO-GRIS-T-L-GRIS", "Guante Cabritilla Activex sin forro gris", "TRECK", 930, "Talla: T/L; Color: Gris; Modelo: Sin forro"],
  ["TRECK-BOTIN-V-FLEX-THINSULATE-V15-N41-NEGRO-AZUL", "Botín V-Flex Thinsulate V15", "TRECK", 49900, "Talla: N41; Color: Negro/Azul; Modelo: V15"],
  ["TRECK-PANTALON-SLACK-CARGO-GABARDINA-GRIS-NARANJO-T-L-GRIS-N", "Pantalón Slack Cargo gabardina gris/naranjo", "TRECK", 11500, "Talla: T/L; Color: Gris/Naranjo; Modelo: Con logo"],
  ["TRECK-CHAQUETA-ACTIVEX-MICROPOLAR-NEGRO-MANGA-LARGA-T-M-NEGR", "Chaqueta Activex micropolar negro manga larga", "TRECK", 7900, "Talla: T/M; Color: Negro; Modelo: Micropolar"],
  ["TRECK-GUANTES-DE-CABRITILLA-T-XL", "Guantes de cabritilla", "TRECK", 930, "Talla: T/XL; Modelo: Cinta amarilla en el puño"],
  ["TRECK-GUANTE-CABRITILLA-CORTO-T-L", "Guante cabritilla corto", "TRECK", 930, "Talla: T/L; Modelo: Corto"],
  ["TRECK-MASCARILLA-PLEGABLE-KN95-SIN-VALVULA", "Mascarilla plegable KN95 sin válvula", "TRECK", 600, "Modelo: Pack 10 un"],
  ["TRECK-CASCO-ACTIVEX-I-NARANJO", "Casco Activex I", "TRECK", 2160, "Color: Naranjo; Modelo: Arnés cinta 6 puntas ratchet"],
  ["TRECK-BUZO-TYVEK-DUPONT-T-XL", "Buzo Tyvek Dupont", "TRECK", 4100, "Talla: T/XL; Modelo: Tyvek"],
  ["TRECK-GUANTE-ANSELL-HYFLEX-11-801-N-9", "Guante Ansell Hyflex 11-801", "TRECK", 2790, "Talla: N-9; Modelo: Hyflex 11-801"],
  ["TRECK-GUANTE-ANSELL-HYFLEX-11-801-N-10", "Guante Ansell Hyflex 11-801", "TRECK", 2790, "Talla: N-10; Modelo: Hyflex 11-801"],
  ["TRECK-GUANTES-DE-CABRITILLA-TALLA-9-10", "Guantes de cabritilla", "TRECK", 1150, "Talla: Talla 9-10; Modelo: Con forro"],
  ["TRECK-BOTIN-V-FLEX-V73-MICROFIBER-N41-NEGRO", "Botín V-Flex V73 Microfiber", "TRECK", 39900, "Talla: N41; Color: Negro; Modelo: Microfiber"],
  ["TRECK-BOTIN-V-FLEX-V73-MICROFIBER-N42-NEGRO", "Botín V-Flex V73 Microfiber", "TRECK", 39900, "Talla: N42; Color: Negro; Modelo: Microfiber"],
  ["TRECK-BOTIN-V-FLEX-V73-MICROFIBER-N43-NEGRO", "Botín V-Flex V73 Microfiber", "TRECK", 39900, "Talla: N43; Color: Negro; Modelo: Microfiber"],
  ["TRECK-BOTIN-V-FLEX-V73-MICROFIBER-N44-NEGRO", "Botín V-Flex V73 Microfiber", "TRECK", 39900, "Talla: N44; Color: Negro; Modelo: Microfiber"],
  // DUPLICATE rows (-2 suffix)
  ["TRECK-FONO-HL-VERISHIELD-VS120DH-P-CASCO-DIELEC-2", "Fono HL Verishield VS120DH p/casco Dielec", "TRECK", 12200, "Modelo: 1035201-VS"],
  ["TRECK-TRAJE-PU-VERDE-ACTIVEX-T-M-VERDE-2", "Traje PU Verde Activex", "TRECK", 13900, "Talla: T/M; Color: Verde; Modelo: Pantalón"],
  ["TRECK-TRAJE-PU-VERDE-ACTIVEX-T-L-VERDE-2", "Traje PU Verde Activex", "TRECK", 13900, "Talla: T/L; Color: Verde; Modelo: Pantalón"],
  ["TRECK-TRAJE-PU-VERDE-ACTIVEX-T-XL-VERDE-2", "Traje PU Verde Activex", "TRECK", 13900, "Talla: T/XL; Color: Verde; Modelo: Pantalón"],
  ["TRECK-TRAJE-PU-VERDE-ACTIVEX-T-2XL-VERDE", "Traje PU Verde Activex", "TRECK", 13900, "Talla: T/2XL; Color: Verde; Modelo: Pantalón"],
  ["TRECK-LENTE-ACTIVEX-FX-III-SELLADO-CLARO-2", "Lente Activex FX III sellado", "TRECK", 2240, "Color: Claro; Modelo: FX III"],
  ["TRECK-GUANTE-ACTIVEX-NITRILO-HEAVY-DUTY-PUNO-SEGURIDAD-T-L", "Guante Activex Nitrilo Heavy Duty Puño Seguridad", "TRECK", 1900, "Talla: T/L; Modelo: Puño seguridad"],
  ["TRECK-GUANTE-ACTIVEX-NITRILO-HEAVY-DUTY-PUNO-SEGURIDAD-T-XL", "Guante Activex Nitrilo Heavy Duty Puño Seguridad", "TRECK", 1900, "Talla: T/XL; Modelo: Puño seguridad"],
  ["TRECK-GUANTE-CABRITILLA-ACTIVEX-SIN-FORRO-GRIS-T-M-GRIS-2", "Guante Cabritilla Activex sin forro gris", "TRECK", 900, "Talla: T/M; Color: Gris; Modelo: Sin forro"],
  ["TRECK-GUANTE-CABRITILLA-ACTIVEX-SIN-FORRO-GRIS-T-L-GRIS-2", "Guante Cabritilla Activex sin forro gris", "TRECK", 900, "Talla: T/L; Color: Gris; Modelo: Sin forro"],
  ["TRECK-BOTIN-V-FLEX-THINSULATE-V15-T41-NEGRO-AZUL", "Botín V-Flex Thinsulate V15", "TRECK", 49900, "Talla: T41; Color: Negro/Azul"],
  // APRO items
  ["APRO-BOTIN-NORSEG-GRETA-CT-DAMA-GRIS", "Botín Norseg Greta CT dama", "APRO", 57513, "Color: Gris; Modelo: CT dama"],
  ["APRO-BOTIN-PROFLEX-125CDPH-CMZ-AISLANTE-ANTIACIDO-N40-CAFE", "Botín Proflex 125CDPH CMZ aislante antiácido", "APRO", 40900, "Talla: N40; Color: Café; Modelo: 125CDPH"],
  ["APRO-BOTA-PROFLEX-111-SOLDADOR-N41-NEGRO", "Bota Proflex 111 soldador", "APRO", 57749, "Talla: N41; Color: Negro; Modelo: Soldador"],
  ["APRO-BUZO-TYVEK-500-XPERT-TY198S-XL", "Buzo Tyvek 500 Xpert TY198S", "APRO", 3790, "Talla: XL; Modelo: TY198S"],
  ["APRO-GUANTE-NITRILO-TEXTURIZADO-8-0-GR-NARANJO-T-L-NARANJO", "Guante nitrilo texturizado 8.0 gr naranjo", "APRO", 7900, "Talla: T/L; Color: Naranjo; Modelo: Caja 50 un"],
  ["APRO-GUANTE-NITRILO-TEXTURIZADO-8-0-GR-NARANJO-T-XL-NARANJO", "Guante nitrilo texturizado 8.0 gr naranjo", "APRO", 7900, "Talla: T/XL; Color: Naranjo; Modelo: Caja 50 un"],
  ["APRO-POLERA-POLO-DRYFRESH-DAMA-T-L-AZUL-PIEDRA", "Polera Polo Dryfresh dama", "APRO", 6250, "Talla: T/L; Color: Azul piedra; Modelo: Dryfresh"],
  ["APRO-POLERA-POLO-DRYFRESH-HOMBRE-T-L-AZUL-PIEDRA", "Polera Polo Dryfresh hombre", "APRO", 6250, "Talla: T/L; Color: Azul piedra; Modelo: Dryfresh"],
]

// ─── NORMALIZATION HELPERS ──────────────────────────────

function parseAttrs(raw) {
  if (!raw || typeof raw !== "string") return {}
  const obj = {}
  for (const part of raw.split(";")) {
    const [k, ...v] = part.split(":").map((s) => s.trim())
    if (k && v.length) obj[k] = v.join(":").trim()
  }
  return obj
}

const ATTR_KEY_ORDER = ["Talla", "Color", "Modelo", "Género", "Medida", "Presentación", "Gramaje", "Tipo", "Código", "Atenuación", "Espesor", "Largo"]

const TALLA_NORMALIZE = {
  "t/m": "T/M", "t/s": "T/S", "t-s": "T/S",
  "t/l": "T/L",
  "t/xl": "T/XL", "t-xl": "T/XL",
  "t/2xl": "T/2XL", "t-2xl": "T/2XL", "t/xxl": "T/2XL",
  "t/3xl": "T/3XL", "t-3xl": "T/3XL", "t/xxxl": "T/3XL",
  "n41": "N41", "n42": "N42", "n43": "N43", "n44": "N44", "n40": "N40",
  "t41": "N41", "t40": "N40",
  "n-9": "N9", "n-10": "N10",
  "xl": "T/XL",
}

function normalizeTalla(v) {
  if (!v) return v
  return TALLA_NORMALIZE[v.trim().toLowerCase().replace(/\s+/g, " ")] || v.trim()
}

function normalizeAttrs(raw) {
  if (!raw) return ""
  const a = parseAttrs(raw)
  for (const [k, v] of Object.entries(a)) {
    a[k] = k === "Talla" ? normalizeTalla(v) : v
  }
  const parts = []
  for (const k of ATTR_KEY_ORDER) if (k in a) parts.push(`${k}: ${a[k]}`)
  for (const [k, v] of Object.entries(a)) if (!ATTR_KEY_ORDER.includes(k)) parts.push(`${k}: ${v}`)
  return parts.join("; ")
}

function normalizeSku(sku) {
  if (!sku) return sku
  let s = String(sku).trim().toUpperCase()
  // trailing hyphen
  if (s.endsWith("-")) s = s.slice(0, -1)
  // truncations
  s = s.replace(/-BEIG$/, "-BEIGE").replace(/-BEI$/, "-BEIGE")
  s = s.replace(/-AM$/, "-AMARILLO")
  s = s.replace(/-NEGR$/, "-NEGRO")
  s = s.replace(/GRIS-N$/, "GRIS-NARANJO")
  // talla in SKU
  s = s.replace(/-N-(\d+)/g, "-N$1")        // N-9 → N9
  s = s.replace(/-T(\d+)$/g, "-N$1")        // T41 → N41 (shoe)
  s = s.replace(/-T-XXL/g, "-T-2XL")
  s = s.replace(/-T-XXXL/g, "-T-3XL")
  return s
}

// ─── DUPLICATE DETECTION ───────────────────────────────

/** Strict fingerprint (incluye precio) */
function fingerprint(nombre, proveedor, precio, attrsRaw) {
  const a = parseAttrs(attrsRaw)
  for (const [k, v] of Object.entries(a)) if (k === "Talla") a[k] = normalizeTalla(v)
  const sorted = JSON.stringify(Object.entries(a).sort(([x], [y]) => x.localeCompare(y)))
  return JSON.stringify({
    nombre: String(nombre).trim().toLowerCase(),
    proveedor: String(proveedor).trim().toLowerCase(),
    precio: Number(precio),
    attrs: sorted,
  })
}

/** Fingerprint sin precio: solo nombre + proveedor + atributos normalizados */
function productFingerprint(nombre, proveedor, attrsRaw) {
  const a = parseAttrs(attrsRaw)
  for (const [k, v] of Object.entries(a)) if (k === "Talla") a[k] = normalizeTalla(v)
  const sorted = JSON.stringify(Object.entries(a).sort(([x], [y]) => x.localeCompare(y)))
  return JSON.stringify({
    nombre: String(nombre).trim().toLowerCase(),
    proveedor: String(proveedor).trim().toLowerCase(),
    attrs: sorted,
  })
}

// ─── MAIN ───────────────────────────────────────────────

const items = RAW_DATA.map((r, i) => ({
  idx: i,
  sku: String(r[0]),
  nombre: String(r[1]),
  proveedor: String(r[2]),
  precio: r[3],
  attrsRaw: String(r[4] ?? ""),
}))

const toRemove = new Set()

// ── PASADA 1: agrupar por SKU base (sin sufijo -2) ──

const byBaseSku = new Map()
for (const item of items) {
  const base = item.sku.toUpperCase().replace(/-2$/, "")
  if (!byBaseSku.has(base)) byBaseSku.set(base, [])
  byBaseSku.get(base).push(item)
}

for (const [baseSku, group] of byBaseSku) {
  if (group.length < 2) continue
  const fps = group.map(i => fingerprint(i.nombre, i.proveedor, i.precio, i.attrsRaw))
  const unique = new Set(fps)
  if (unique.size === 1) {
    const idxs = group.map(i => i.idx)
    console.log(`  🔴 [SKU] "${group[0].nombre}" — ${group.length} duplicados (idxs ${idxs.join(", ")}) → eliminando`)
    for (const i of group) toRemove.add(i.idx)
  } else {
    console.log(`  🟡 [SKU] "${group[0].nombre}" — difiere en atributos/precio:`)
    const fpNoPrice = group.map(i => JSON.stringify({
      n: i.nombre.toLowerCase(), p: i.proveedor.toLowerCase(),
      a: JSON.stringify(Object.entries(parseAttrs(i.attrsRaw)).sort()),
    }))
    const deduped = new Set(fpNoPrice)
    if (deduped.size === 1) {
      console.log(`       Mismo producto y atributos, difiere PRECIO → eliminando ambos`)
      for (const i of group) toRemove.add(i.idx)
    } else {
      for (const i of group) {
        console.log(`       idx ${i.idx}: ${i.sku} | $${i.precio} | ${i.attrsRaw}`)
      }
    }
  }
}

// ── PASADA 2: detección GLOBAL por nombre + proveedor + atributos ──
// (captura duplicados con SKUs diferentes como XXL vs 2XL, N41 vs T41, etc.)

const byProduct = new Map()
for (const item of items) {
  if (toRemove.has(item.idx)) continue
  const fp = productFingerprint(item.nombre, item.proveedor, item.attrsRaw)
  if (!byProduct.has(fp)) byProduct.set(fp, [])
  byProduct.get(fp).push(item)
}

for (const [fp, group] of byProduct) {
  if (group.length < 2) continue
  // Different SKUs but same product → remove all copies
  const idxs = group.map(i => i.idx)
  console.log(`  🔴 [GLOBAL] "${group[0].nombre}" — ${group.length} coincidencias (idxs ${idxs.join(", ")}) → eliminando`)
  for (const i of group) toRemove.add(i.idx)
}

const kept = items.filter(i => !toRemove.has(i.idx))

console.log(`\n📊 ${items.length} items totales → ${kept.length} items (eliminados ${items.length - kept.length})`)

// ─── WRITE XLSX ─────────────────────────────────────────

const wb = new ExcelJS.Workbook()
const ws = wb.addWorksheet("items_normalizados")

// Header
for (let c = 0; c < HEADER.length; c++) ws.getCell(1, c + 1).value = HEADER[c]
ws.getRow(1).font = { bold: true }

// Data
for (let i = 0; i < kept.length; i++) {
  const item = kept[i]
  const sku = normalizeSku(item.sku)
  const attrs = normalizeAttrs(item.attrsRaw)
  ws.getCell(i + 2, 1).value = sku
  ws.getCell(i + 2, 2).value = item.nombre
  ws.getCell(i + 2, 3).value = item.proveedor
  ws.getCell(i + 2, 4).value = item.precio
  ws.getCell(i + 2, 5).value = attrs
}

// Column widths
ws.getColumn(1).width = 55
ws.getColumn(2).width = 45
ws.getColumn(3).width = 10
ws.getColumn(4).width = 10
ws.getColumn(5).width = 50

await wb.xlsx.writeFile(path.resolve(FILE))
console.log(`✅ Escrito ${FILE}`)
