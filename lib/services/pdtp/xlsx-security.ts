import type ExcelJS from "exceljs"

export const PDTP_XLSX_MAX_BYTES = 15 * 1024 * 1024
const MAX_ZIP_ENTRIES = 2_000
const MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024
const MAX_SINGLE_ENTRY_BYTES = 20 * 1024 * 1024
const MAX_WORKSHEETS = 32
const MAX_ROWS_PER_SHEET = 2_000
const MAX_COLUMNS_PER_SHEET = 256
const ALLOWED_MIME = new Set([
  "",
  "application/octet-stream",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
])

type UploadEnvelope = { name: string; type: string; size: number; buffer: Buffer }

function findEndOfCentralDirectory(buffer: Buffer) {
  const minimum = Math.max(0, buffer.length - 65_557)
  for (let offset = buffer.length - 22; offset >= minimum; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  return -1
}

/** Valida la envolvente ZIP antes de entregarla a ExcelJS. Esto limita la
 * expansión y rechaza archivos cifrados, rutas inseguras y XLS renombrados. */
export function validatePdtpXlsxEnvelope(upload: UploadEnvelope) {
  if (!upload.name.toLocaleLowerCase("es-CL").endsWith(".xlsx")) {
    throw new Error("El archivo debe usar el formato .xlsx; .xls no está permitido.")
  }
  if (upload.size <= 0 || upload.buffer.length <= 0) throw new Error("El archivo Excel está vacío.")
  if (upload.size !== upload.buffer.length) throw new Error("El tamaño declarado del archivo no coincide con su contenido.")
  if (upload.size > PDTP_XLSX_MAX_BYTES) throw new Error("El archivo Excel supera el límite de 15 MB.")
  if (!ALLOWED_MIME.has(upload.type.toLocaleLowerCase("en-US"))) throw new Error("El tipo MIME del archivo no corresponde a Excel.")
  if (upload.buffer.length < 4 || upload.buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("El archivo no tiene una firma ZIP/Excel válida.")
  }

  const eocd = findEndOfCentralDirectory(upload.buffer)
  if (eocd < 0) throw new Error("El contenedor Excel está incompleto o corrupto.")
  const entryCount = upload.buffer.readUInt16LE(eocd + 10)
  const centralSize = upload.buffer.readUInt32LE(eocd + 12)
  const centralOffset = upload.buffer.readUInt32LE(eocd + 16)
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("Los contenedores ZIP64 no están permitidos para este importador.")
  }
  if (entryCount <= 0 || entryCount > MAX_ZIP_ENTRIES) throw new Error("El Excel contiene una cantidad de archivos internos no permitida.")
  if (centralOffset + centralSize > eocd) throw new Error("El directorio del Excel está corrupto.")

  let offset = centralOffset
  let totalUncompressed = 0
  const names = new Set<string>()
  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > upload.buffer.length || upload.buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("El directorio del Excel contiene una entrada inválida.")
    }
    const flags = upload.buffer.readUInt16LE(offset + 8)
    const method = upload.buffer.readUInt16LE(offset + 10)
    const uncompressed = upload.buffer.readUInt32LE(offset + 24)
    const fileNameLength = upload.buffer.readUInt16LE(offset + 28)
    const extraLength = upload.buffer.readUInt16LE(offset + 30)
    const commentLength = upload.buffer.readUInt16LE(offset + 32)
    const end = offset + 46 + fileNameLength + extraLength + commentLength
    if (end > upload.buffer.length) throw new Error("El directorio del Excel está truncado.")
    if ((flags & 0x1) !== 0) throw new Error("Los Excel cifrados no están permitidos.")
    if (method !== 0 && method !== 8) throw new Error("El Excel usa un método de compresión no permitido.")
    if (uncompressed === 0xffffffff || uncompressed > MAX_SINGLE_ENTRY_BYTES) {
      throw new Error("Una parte interna del Excel supera el límite permitido.")
    }
    totalUncompressed += uncompressed
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) throw new Error("El Excel excede el límite de expansión permitido.")
    const name = upload.buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8")
    if (!name || name.includes("..") || name.startsWith("/") || name.includes("\\")) {
      throw new Error("El Excel contiene una ruta interna no permitida.")
    }
    names.add(name)
    offset = end
  }
  if (!names.has("[Content_Types].xml") || !names.has("xl/workbook.xml")) {
    throw new Error("El ZIP no contiene la estructura mínima de un libro Excel.")
  }

  return { entryCount, totalUncompressedBytes: totalUncompressed }
}

export function validateLoadedPdtpWorkbook(workbook: ExcelJS.Workbook) {
  if (workbook.worksheets.length === 0 || workbook.worksheets.length > MAX_WORKSHEETS) {
    throw new Error(`El libro debe contener entre 1 y ${MAX_WORKSHEETS} hojas.`)
  }
  let totalCells = 0
  for (const worksheet of workbook.worksheets) {
    if (worksheet.rowCount > MAX_ROWS_PER_SHEET) throw new Error(`La hoja ${worksheet.name} supera ${MAX_ROWS_PER_SHEET} filas.`)
    if (worksheet.columnCount > MAX_COLUMNS_PER_SHEET) throw new Error(`La hoja ${worksheet.name} supera ${MAX_COLUMNS_PER_SHEET} columnas.`)
    totalCells += worksheet.rowCount * worksheet.columnCount
  }
  return { worksheetCount: workbook.worksheets.length, totalCells }
}
