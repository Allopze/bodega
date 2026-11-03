# Historial de mantención: plan de implementación

**Objetivo:** importar y consultar el consolidado histórico con trazabilidad y sin alterar los registros firmados.

**Arquitectura:** lector Excel validado y conciliación determinista; tabla propia y servicio transaccional con autorización en servidor; consulta histórica separada de las mantenciones firmadas.

**Tecnologías:** Next.js, ExcelJS, Drizzle y PostgreSQL; Vitest/PGlite y Playwright cuando estén disponibles.

**Especificación:** `docs/superpowers/specs/2026-11-03-historial-mantencion-design.md`.

## Verificación

- [ ] Cubrir lectura, preservación de datos útiles, fechas, duplicados y conflictos de identidad con ejemplos sintéticos.
- [ ] Generar una migración nueva y validar cadena, checksum y ausencia de cambios posteriores.
- [ ] Cubrir vista previa, importación atómica, reimportación, vínculos pendientes, auditoría y alcance por faena con base de prueba.
- [ ] Conectar acciones y páginas autorizadas al módulo vigente, con paginación y consulta del detalle original.
- [ ] Ejecutar pruebas enfocadas, typecheck, lint y recorrido local autorizado si está disponible. Documentar cualquier cobertura pendiente.
