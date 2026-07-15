# Análisis en profundidad — Módulo de Combustibles e Importación

**Fecha:** 2026-07-15 · **Rama:** `Allopze/feat/move-buttons-to-pageheader-actions` · **Verificado contra el working tree actual** (incluye los cambios sin commitear en `lib/combustibles/{fuel-log,anomaly-detector,validation,consumption-dashboard,evidence-management}.ts`)

**Método:** lectura dirigida de la capa completa (25 rutas → server actions → servicios → schema → rutas API públicas/privadas → 3 crons → manifest RBAC), verificación uno a uno de los 12 hallazgos de la auditoría previa (`docs/auditoria/AUDITORIA-COMBUSTIBLES.md`, 2026-06-28), y verificación ejecutable: **111 tests del módulo en verde** (18 archivos, vitest) y **`npm run typecheck` limpio**.

---

## 1. Contexto: la remediación de la auditoría 2026-06-28 se ejecutó casi completa

La auditoría anterior encontró 3 hallazgos críticos y 9 medios/bajos. Verifiqué cada uno contra el código actual:

| # | Hallazgo 2026-06-28 | Estado hoy | Evidencia |
|---|---|---|---|
| H1 🔴 | Fuga entre faenas en cuenta corriente y lecturas por ID | ✅ Corregido* | Página gateada a `isGlobalRole` ([cuenta-corriente/page.tsx:17](app/(app)/combustibles/cuenta-corriente/page.tsx#L17)); detalle de carga con `canAccessWorksite` + `notFound()` ([[id]/page.tsx:42-43](app/(app)/combustibles/[id]/page.tsx#L42-L43)). *Matiz en N4. |
| H2 🔴 | Import confiaba en montos del cliente | ✅ Corregido | Coherencia `total = base + IEC + IVA ± 1 CLP` en la ruta ([import/route.ts:147-151](app/api/combustibles/import/route.ts#L147-L151)) y en create/update manual |
| H3 🔴 | Import sin dedup contra BD | ✅ Corregido | Clave compuesta proveedor+factura+vehículo+fecha+litros consultada por mes ([import/route.ts:120-141](app/api/combustibles/import/route.ts#L120-L141)) |
| H4 🟠 | Editar corrompe IEC | ✅ Corregido | `updateFuelLoadAction` usa los valores existentes como default; recálculo solo con `autoCalc` explícito en creación |
| H5 🟠 | Resumen desfasado al editar carga asignada | ✅ Corregido | Editar/borrar bloqueado si `statementId != null` ([loads.ts:170-172](app/(app)/combustibles/actions-module/loads.ts#L170-L172)) |
| H6 🟠 | update/delete/register sin scope | ✅ Corregido | `canAccessWorksite` en las tres actions |
| H7 🟠 | Import creaba faenas sin control ni transacción | ✅ Corregido | Todo en `db.transaction`, `faenaMapping` explícito por decisión del usuario, scope por fila |
| H8 🟠 | Sin auditoría financiera | ✅ Corregido | `recordAudit` en cargas/pagos/resúmenes/importaciones + módulo Bitácora completo con historial por entidad y permiso `combustibles:view_audit` |
| H9 🟡 | Actions seguras huérfanas | ✅ Resuelto | `actions-module/` es la ruta viva y con guards; la UI la consume |
| H10 🟡 | Estados/columnas muertos | ✅ Mayormente | `reconciled` y `cancelled` hoy tienen guards que los usan; no encontré rastro de `costCenterId` |
| H11 🟡 | Corrimiento de fecha por `toISOString` | ✅ Corregido | Parse con `getFullYear/getMonth/getDate` locales ([import.ts:86-100](lib/combustibles/import.ts#L86-L100)) |
| H12 🟡 | Validaciones/UX menores | ✅ Mayormente | Validación cruzada vehículo↔faena en alta manual e import; dropdowns con scope |

Es un caso poco común de remediación disciplinada: los fixes citan los códigos de hallazgo en comentarios (`H2`, `H3`, `H7`) y quedaron cubiertos por tests.

## 2. Mapa del módulo hoy

| Área | Superficie |
|---|---|
| Cargas + cuenta corriente | `/combustibles`, `/nueva`, `/[id]`, `/cuenta-corriente/**` · `actions-module/` (loads, statements, suppliers, vehicles, export) |
| Importación cartola (TCT/TAE facturado) | `/combustibles/importar` · parser cliente `lib/combustibles/import.ts` · `POST /api/combustibles/import` |
| Importación operacional | `/combustibles/importar/operaciones/**` · `actions-operaciones.ts` · `operations-import.ts` (gate global + hash de archivo) |
| TAE digital (PWA pública) | `app/(public)/tae/**` · `/api/tae/{access,identity,submit,evidence}` · `lib/services/fuel-tae.ts` (726 LOC) · OCR `tae-ocr.ts` |
| TAE interno | `/combustibles/tae/**` (revisión, conciliación Copec, import histórico con dry-run/revert/reprocesar) |
| Anomalías | `/combustibles/anomalias/**` · `anomaly-detector.ts` + `anomaly-cases.ts` · cron `fuel-anomaly-detection` |
| Otros | Bitácora unificada (`fuel-log.ts`), sellos, facturas, ciclo, análisis, reportes, estadísticas de rendimiento · crons `fuel-copec-sync`, `fuel-statement-notifications` |

**Salud transversal:** exports 100% XLSX con cap de filas y permiso `export_sensitive` para montos; layout PageHeader/PageContainer correcto (los 2 "faltantes" son stubs `redirect()` a `/admin/flota-catalogos`); sin `<h1>` sueltos ni sonner; `/combustibles` registrado en `ROUTES_WITH_OWN_SEARCH`; schema con 27 índices/uniques en TAE y uniques compuestos donde importa.

---

## 3. Hallazgos nuevos (ordenados por severidad)

### N1 — Revertir un lote TAE falla con error crudo si alguna carga ya generó movimientos de sello 🟠 media

[fuelSealMovements.submissionId](db/schema/fuel-tae.ts#L236) **no tiene `onDelete`** (a diferencia de `fuelTaeEvidence`, que sí es `cascade`). `revertTaeImportBatchAction` ([importar/actions.ts:106-147](app/(app)/combustibles/tae/importar/actions.ts#L106-L147)) hace `DELETE` de todas las submissions del lote validando **solo el estado del batch** — no si alguna submission fue revisada después. Si un revisor validó una carga importada como "observada" (lo que crea movimientos de sello en [reviewTaeSubmission](lib/services/fuel-tae.ts#L565-L596)), el revert choca con la FK, la transacción se revierte y el usuario ve el mensaje crudo de Postgres. Decidir: o bloquear el revert con un mensaje claro ("N cargas ya fueron revisadas manualmente"), o definir la limpieza de movimientos de sello como parte de la reversa.

### N2 — `toggleReviewMarkAction`: escritura sin scope y con permiso de solo-lectura 🟠 media-baja

[bitacora/actions.ts:85-110](app/(app)/combustibles/bitacora/actions.ts#L85-L110): marcar/desmarcar "revisado" en la bitácora exige solo `combustibles:view` y **no valida** que la entidad pertenezca a una faena del scope del usuario. Un usuario de faena puede togglear la marca de revisión de cualquier carga de la empresa conociendo su ID (y las marcas son metadatos de control interno de un log financiero). También es el único punto del módulo que usa `db.execute(sql...)` crudo en vez del query builder. Fix: resolver la entidad, `canAccessWorksite`, y un permiso de escritura (p. ej. `combustibles:review_anomalies` o uno propio).

### N3 — El OCR pisa la lectura manual del medidor 🟡 decisión de producto

[fuel-tae.ts:259-262](lib/services/fuel-tae.ts#L259-L262): `meterReading: ocrResult?.value ?? input.meterReading` — si Tesseract produce un valor, **descarta lo que el operador tipeó**, sin registrar el valor humano en ninguna parte. La alerta `low_ocr_confidence` solo salta con confianza <0.7; un OCR "confiado" pero equivocado (dígito cortado, reflejo) entra silenciosamente como lectura oficial y alimenta las alertas de regresión de lectura y el rendimiento. Sugerencia mínima: invertir la precedencia (humano gana, OCR como verificación) o persistir ambos valores y alertar cuando difieren.

### N4 — Cuenta corriente: el gate global vive solo en la página, no en las actions 🟡 baja (defensa en profundidad)

`createMonthlyStatementAction` y `addPaymentAction` ([statements.ts:23,96](app/(app)/combustibles/actions-module/statements.ts#L23)) exigen solo `combustibles:create`, mientras la página exige `isGlobalRole`. Las server actions son invocables sin pasar por la página. Hoy es teórico — `combustibles:create` solo se concede a roles globales en el manifest — pero un rol custom con `create` y scope de faena podría crear resúmenes y registrar pagos. La auditoría anterior ya recomendaba un permiso dedicado (`combustibles:manage_statements`); sigue sin existir y el `isGlobalRole` de la página es el parche. Mismo patrón en `revertBatchOperationsAction` (ahí sí resuelto con `requireGlobalImportSession` — replicarlo).

### N5 — Replay de `clientSubmissionId` devuelve el token de resultado de otra carga 🟡 baja

[fuel-tae.ts:199-203](lib/services/fuel-tae.ts#L199-L203): la idempotencia del envío público busca `clientSubmissionId` **globalmente** y, si existe, devuelve `{ id, publicResultToken }` de esa carga — sin verificar que pertenezca al mismo enlace/faena del token con que se envía. Quien tenga un token de acceso válido de *cualquier* faena y conozca el `clientSubmissionId` de otra carga (p. ej. dispositivo compartido) obtiene su token de resultado. El ID es un nanoid del cliente, así que no es adivinable a ciegas — riesgo bajo. Fix de una línea: scoping del lookup por `worksiteId`/`loadingPointId` del link.

### N6 — Mensajes de error internos reenviados al cliente 🟢 menor

- `dbErrMsg` ([loads.ts:27-33](app/(app)/combustibles/actions-module/loads.ts#L27-L33)) reenvía `e.message` y hasta `cause.message` del driver de Postgres a la UI.
- Los crons `fuel-anomaly-detection` y `fuel-copec-sync` devuelven `err.message` crudo en el JSON de error, inconsistente con la convención H-B11 que el cron de PDTP sí aplica (genérico en producción).

### N7 — Exports como server actions con base64 🟢 menor

`exportFuelLoadsXlsxAction` y los exports de bitácora devuelven el XLSX en base64 por server action (con cap `MAX_FUEL_EXPORT_ROWS`, bien), mientras TAE/PPA/PDTP usan rutas API con streaming. Funciona, pero duplica patrón y paga la serialización RSC — mismo apunte que en el informe de prevención para indicadores.

### N8 — Micro-limpiezas 🟢

- **Dedup de cartola sin factura:** la clave incluye `receiptNumber ?? ""` ([import/route.ts:63-64](app/api/combustibles/import/route.ts#L63-L64)); dos cargas legítimas del mismo vehículo/día/litros **sin número de factura** colisionan y la segunda se descarta como duplicada. Edge real en surtidores sin boleta.
- **`loadDate` sin validar formato** en el payload del import (`z.string().min(1)` vs el regex que sí tiene `month`): una fecha malformada del parser entraría cruda a la BD.
- [evidence/[id]/route.ts:28](app/api/tae/evidence/[id]/route.ts#L28) permite redirect a `externalUrl` con protocolo `http:` (no solo `https:`); el dato viene del import histórico (interno), riesgo mínimo.
- Stubs `redirect()` en `vehiculos/` y `proveedores-combustible/` → mover a `redirects()` de `next.config.ts` o borrar (mismo patrón que documentación en prevención).
- `registerFuelLoadAction` es la única mutación de cargas sin `recordAudit`.

---

## 4. Lo que está muy bien (y conviene proteger)

- **La PWA pública TAE es la superficie pública mejor defendida del repo:** rate limit doble (volumen por IP + ventana por huella de token), tokens de acceso **hasheados en DB** (mejor que el token PPA), validación de imagen por magic bytes + `sharp` con límite anti-pixel-bomb, 4 evidencias obligatorias con SHA-256, idempotencia offline por `clientSubmissionId`, archivos escritos antes de la transacción con limpieza compensatoria si falla, y minimización de PII calcada de PPA en la identificación por RUT.
- **OCR bien acotado:** semáforo de concurrencia configurable, diccionarios desactivados en init (con el comentario explicando por qué `setParameters` no sirve), whitelist de dígitos, fallback de PSM, y confianza persistida que alimenta la alerta de revisión.
- **Importaciones con ciclo de vida completo:** dry-run con reporte XLSX descargable, frase de confirmación, lote con hash de archivo (dedup con override explícito), revert transaccional auditado, reprocesamiento de filas rechazadas, y decisiones de mapeo persistidas por faena con validación de scope — es el flujo de import más maduro del sistema.
- **Integridad financiera:** `SELECT ... FOR UPDATE` en la creación de resúmenes y pagos, `paidAmount` recalculado desde `SUM` real, coherencia de montos en tres puntos de entrada, y auditoría con estados previos/nuevos.
- **Revisión TAE con concurrencia optimista** (expectedStatus + update condicional dentro de la transacción) y máquina de estados explícita.

## 5. Sugerencias priorizadas

| # | Acción | Esfuerzo | Impacto |
|---|---|---|---|
| S1 | Decidir y arreglar la reversa de lotes TAE con sellos (guard con mensaje o limpieza definida) (N1) | Bajo | Evita revert roto con error críptico en producción |
| S2 | Scope + permiso de escritura en `toggleReviewMarkAction` (N2) | Bajo | Cierra escritura cross-faena |
| S3 | Precedencia humano>OCR o persistir ambos valores (N3) | Bajo | Credibilidad de lecturas y alertas de regresión |
| S4 | Permiso `combustibles:manage_statements` + gate en actions (N4) | Bajo | Defensa en profundidad en el flujo financiero |
| S5 | Scoping del lookup de idempotencia TAE por faena/link (N5) | Trivial | Cierra el replay de tokens de resultado |
| S6 | Helper `toActionError(e)` compartido y mensajes genéricos en crons (N6) — aplica también a prevención | Bajo | Sin fuga de internals |
| S7 | Micro-limpiezas N7–N8 | Bajo | Higiene |
| S8 | Marcar la auditoría 2026-06-28 como remediada (tabla de la sección 1) para que no se re-trabaje | Trivial | Documentación honesta |

---

*Generado el 2026-07-15 sobre el working tree de `Allopze/feat/move-buttons-to-pageheader-actions`. Verificación: 111 tests del módulo en verde (18 archivos), typecheck limpio. Informe hermano: `ANALISIS_PREVENCION_2026-07-15.md`.*
