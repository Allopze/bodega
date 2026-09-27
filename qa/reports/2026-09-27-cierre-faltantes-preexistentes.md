# Cierre de faltantes y preexistentes (2026-09-27)

Rama local **`prevencion/integracion-final-2`**, sobre `prevencion/integracion-final` (`33a10750`). Sin push ni merge a `main`.

## Qué se integró

| Rama | Contenido | Informe |
|---|---|---|
| `prevencion/c07-m02b` | **C07 en ocurrencias:** el "No aplica" y la cancelación de una ocurrencia programada nacen en revisión, la hace otra persona con `prevention:pdtp:approve`, no se permite un "No aplica" a futuro y no se puede cerrar un mes con solicitudes pendientes. **M02-B:** registro del dueño de cada archivo subido (`pdtp_evidence_uploads`); un archivo sin referencias solo lo enlaza quien lo subió, para su faena. Migración **0334** | [C07 + M02-B](2026-09-27-prevencion-c07-m02b.md) |
| `prevencion/i03-m09-i13` | **I03:** solo el responsable del cargo o el asignado registra la actividad; Prevención y administración, cualquiera. El servidor lo exige y la interfaz oculta "Registrar". **M09:** obligaciones paginadas en SQL; `prevention-inspections.ts` e `inspection-run-detail.tsx` divididos sin cambiar comportamiento. **I13:** alertas por notificación y correo cuando se pierde evidencia o falla un cron de Prevención. **M03:** ADR-002 | [I03, M09, I13](2026-09-27-prevencion-i03-m09-i13.md) |
| `fix/reflow-desbordes` | La prueba de reflow ahora mide el contenedor real. 151 rutas × 320/390/768/1024 px quedan en 0 px (antes 22 desbordes en 14 rutas). La paginación mide 44 px en móvil. La planilla PDTP pagina igual en la vista anual y en la semanal | [reflow](2026-09-27-reflow-desbordes.md) |
| `fix/preexistentes` | Suites `*-postgres` reparadas, errores de doctor, allowlist de npm audit y 5 suites que CI nunca corría | [preexistentes](2026-09-27-preexistentes.md) |

## Preexistentes: qué se encontró

- **Seguridad, `lib/services/password-reset.ts`:** tenía `"use server"`, así que sus tres funciones eran server actions públicas. Eso permitía saltarse el límite por IP de correos de restablecimiento y el largo mínimo de la contraseña nueva. Se quitó la directiva, y una prueba nueva falla si un módulo de `lib/` la declara.
- **Endurecimiento, `facturacion/propuestas/actions.ts`:** la acción validaba la entrada antes de mirar la sesión. Ahora el permiso va primero.
- **Suites `*-postgres`:** las fallas de combustibles, recepción y trabajadores eran fixtures desactualizados; ninguna aserción de autorización ni de concurrencia se debilitó.
  - La de recepción pasaba sin probar nada. Ahora se verificó que falla si se quitan los locks.
  - La de facturas no creaba su base y vitest 4 mostraba el error como "omitida".
- **CI:** la guarda nueva `postgres-suites-gating.test.ts` encontró 5 suites que nunca corrían en CI. Quedaron habilitadas en `ci.yml`.
- **Doctor:** de 12 errores reales a 0; puntaje de 49 a 69. Ahora ignora `.claude/**`.
- **npm audit:** las 4 entradas del allowlist estaban vencidas y se eliminaron. Una entrada que ya no respalda un hallazgo real ahora hace fallar la puerta.
- **Las "2 pruebas omitidas tras el cambio de vitest":** dependen de planillas reales que solo existen en el checkout principal y se omiten en un worktree. Es correcto y no se tocaron.

## Ajustes hechos al integrar

- `scheduled-execution.ts` chocó entre C07 (solicitud en revisión) e I03 (actor de registro); se conservaron los dos.
- La suite de I03 enlazaba archivos sin registro de subida, que M02-B ahora rechaza. Se ajustó el fixture: 16/16.
- Runbook: Q8, actividades sin responsable mapeado a un rol activo, que quedarán solo para Prevención (I03). Validada contra el esquema migrado.

## Verificación de la rama integrada (`86964845` + ajuste del fixture de I03)

| Puerta | Resultado |
|---|---|
| `npm ci`, `typecheck`, `lint`, `check:security-audit` | PASS |
| `db:generate` / cadena | Sin cambios pendientes / 335 entradas hasta 0334 |
| `npm run test:fast` | 782 archivos / **10.222 pruebas PASS** |
| `npm run test:pglite` | 218 archivos / **2.690 pruebas PASS**, 1 omitida (sonda) |
| Suites `*-postgres` (32, una base `_test` cada una en `:55432`) | **32/32 PASS** |
| `npm run test:e2e` completo | **754 PASS, 4 omitidas, 0 fallos** (31 min) |
| `npm run doctor` | **69/100, 0 errores**, código 0 (antes 49/100 con errores) |

Dos agentes vieron fallar, en sus corridas, E2E de inspecciones que pasan al correrlas solas (`prevencion-inspecciones-ejecucion:314` y `prevencion-inspecciones-offline-sync:54`). En la corrida completa final pasaron las dos. Se consideran intermitentes y quedan para vigilar.

## Qué queda

- **Por decisión o fuera de alcance:**
  - M03, la unificación del estado de celda: se documentó el ADR y no hubo cambio de código.
  - M06 (acuses sin caducidad, D27).
  - Un botón de entrada único para Catálogos PDTP a 1024 px (regla de layout 5).
  - Una ruta de detalle `[id]` con rejillas sin columnas declaradas, que no se barrió.
- **Requiere producción o datos reales:**
  - consultas Q1–Q8, el reporte D6 y el reporte del backfill B01;
  - aplicar las migraciones 0329–0334;
  - crons, correo real, GC y respaldos en el contenedor.
- **Navegadores:** solo Chromium; no se probó WebKit.
