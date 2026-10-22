/**
 * Importación del histórico TAE. Se divide en `tae-import-plan` (planificación
 * y revisión, puras) y `tae-import-commit` (escritura transaccional); este
 * archivo conserva la superficie que importaban los llamadores y las pruebas.
 */
export * from "./tae-import-plan"
export { importTaeLegacyWorkbook, reprocessTaeImportRejectedRows } from "./tae-import-commit"
