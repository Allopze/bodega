# Cierre del plan de pendientes de Prevención (2026-09-27)

Rama local **`prevencion/integracion-final`**. Integra todas las tandas del plan sobre el commit de T0 (`319598c7`). Sin push ni merge a `main`.

Auditoría de origen: [2026-09-26-prevencion-production-readiness.md](2026-09-26-prevencion-production-readiness.md) (54/100, 3 bloqueadores).

## Qué quedó integrado

| Tanda | Contenido | Informe |
|---|---|---|
| Fixes + T0 | B01–B03, C01, C04, rápidos; cierre de la rama y despliegue de 0329 | [fixes](2026-09-26-prevencion-fixes.md), [T0](2026-09-26-prevencion-t0.md) |
| T1 | Tope del % por actividad y mes; manual y acreditación de la misma semana cuentan una vez; techo de cantidad; I08-a; M07 | [T1](2026-09-26-prevencion-t1.md) |
| T5 | Cambio de año 2027: copia del año anterior, cierre anual (0330), año operativo | [T5](2026-09-26-prevencion-t5.md) |
| Integración T1+T5 | 6 correcciones de la revisión adversarial | [integración T1+T5](2026-09-26-prevencion-integracion-t1-t5.md) |
| T2 | Atrasos primero; "No aplica" con revisión (0331) | [T2](2026-09-26-prevencion-t2.md) |
| T4 | Evidencia: mime, historial de envíos, sha256, referencias únicas, cron de integridad | [T4](2026-09-26-prevencion-t4.md) |
| Laterales I14 + M10 | Etapas del ciclo de vida; vitest 4.1.11 | [laterales](2026-09-26-prevencion-laterales-i14-m10.md) |
| Decisiones | RE-36 con tope; reporte D6 | [ola 1](2026-09-26-prevencion-integracion-ola1.md) |
| T3 | Instancias ↔ ejecuciones, regla única de I08-a, FOR SHARE, backfill B01, RE-20 | [T3](2026-09-26-prevencion-t3.md) |
| Reglas del cierre anual | Faena dada de baja y faena nueva corporativa (0332) | [ola 2](2026-09-26-prevencion-integracion-ola2.md) |
| T6 | Ventanas por versión, año consolidado, traspaso al activar | [T6](2026-09-26-prevencion-t6.md) |
| T7a | Borrado restringido e índices (0333), acuses, GC en prueba, respaldos | [T7a](2026-09-26-prevencion-t7a.md), [ola 3](2026-09-27-prevencion-integracion-ola3.md) |
| T7b | Rendimiento del cálculo: tablero de 1.553 a 75 consultas con cifras idénticas (archivo de referencia) | [T7b](2026-09-27-prevencion-t7b.md) |
| Laterales I01 + W8 | "Registrar" alcanzable en móvil, paginación semanal, desborde a 390 px | [laterales](2026-09-27-prevencion-laterales-i01-w8.md) |

## Revisión adversarial final

Tres revisores de solo lectura sobre la rama completa: interacciones entre tandas, seguridad y despliegue, y re-auditoría de cada hallazgo original. Cada hallazgo se verificó en el código antes de corregirlo, y cada corrección tuvo primero su prueba en rojo. Rama `prevencion/revision-final-fixes`, integrada.

| Hallazgo | Corrección |
|---|---|
| Un usuario de la faena B podía enlazar un archivo de evidencia ya referenciado por la faena A y luego descargarlo | `assertPdtpEvidenceLinkable` rechaza, al enlazar, un archivo referenciado por otra faena fuera del alcance. Cubre planilla, obligaciones, instancias, seguimientos y CAPA |
| **NEW-01:** la acción de crear obligaciones aceptaba `origin: "integration"` del cliente y se saltaba la evidencia obligatoria (B02) y el control de fecha (I11) | La acción solo crea obligaciones manuales. Las de integración las crean únicamente los conectores del servidor |
| Un mes partido por una activación podía quedar medio cerrado y aun así permitir el cierre anual | El cierre anual exige el cierre de cada versión dueña de semanas en ese mes |
| La acreditación por integración y el importador XLSX no escribían el historial de envíos | Historial en la misma transacción, una entrada por transición |
| El corte del día de activación usaba la fecha UTC | Usa la fecha de Chile. Estaba oculto porque PGlite usa la zona `Etc/GMT+4`; la prueba fija UTC, como en producción |
| El GC dejaba solo 1 hora de gracia antes de borrar | 24 horas. La respuesta del endpoint admin quedó acotada. Un archivo nuevo que ya no existe da un error claro en vez de perderse en silencio |
| Cancelar una ocurrencia pedía un motivo de 3 caracteres | 10 caracteres |
| El documento de despliegue estaba desactualizado | Reescrito para esta rama: 0329–0333 con el riesgo y el control de cada una, consultas Q1–Q7, 11 crons, reportes de una sola ejecución (B01, D6), GC, comunicación a usuarios y una vuelta atrás que **ya no es transparente** después de 0331 y 0333 |

También se corrigieron dos pruebas `*-postgres` que ya fallaban antes de este trabajo, porque se omiten por defecto y nadie las veía:
- `prevention-permits`: le faltaba el bloqueador de acuse de PER-001;
- `prevention-capa`: le faltaba la declaración que exige PPAI-003.

## Verificación de la rama final

| Puerta | Resultado |
|---|---|
| `npm run typecheck` / `npm run lint` | PASS |
| `db:generate` / cadena de migraciones | Sin cambios pendientes / 334 entradas hasta 0333, checksums verificados |
| `npm run check:security-audit` | PASS (0 vulnerabilidades tras M10) |
| `npm run test:fast` | 774 archivos / **10.101 pruebas PASS**, 32 archivos omitidos (`*-postgres`) |
| `npm run test:pglite` sobre el HEAD final | 214 archivos / **2.626 pruebas PASS**, 1 omitida (sonda que solo corre con `PDTP_PROBE_OUT`) |
| Suites `*-postgres` (32, una base `_test` desechable cada una en `:55432`) | 28 PASS. Siguen fallando `combustibles-scope` (2), `receiving-concurrency` (1) y `trabajadores-scope` (3), **iguales en `main` antes de este trabajo** (`9c862fd0`) y ajenas a Prevención |
| E2E `pdtp-*` + `prevencion-*` sobre el HEAD final, servidor aislado reconstruido | **170 PASS, 2 omitidas condicionales** |
| `npm run test:e2e` **completo** sobre `4ef0a33d` (todo salvo las correcciones de la revisión final) | **746 PASS, 4 omitidas, 0 fallos** (30,5 min) |
| `npm run doctor` | 49/100, código de salida 1, **igual que la línea base** (49/100). Los 25 errores de seguridad que muestra son 2 reales —los mismos que en la línea base— más 23 copias de migraciones antiguas dentro de los worktrees de agentes (`.claude/worktrees/`), que doctor también escanea. Errores de bugs: 10 contra 10 |
| Recálculo del RE-36 en LibreOffice | PASS |

## Nota estimada de production readiness

La re-auditoría de solo lectura revisó uno por uno los 39 hallazgos originales en el código y las pruebas: **30 resueltos, 9 parciales, 0 abiertos**. NEW-01 se encontró y se corrigió después. Con el mismo método de la auditoría original:

**54/100 → alrededor de 86–87/100.** Este informe no recalcula la nota con NEW-01 corregido.

La nota cuenta como hechas correcciones que solo están verificadas en código, pruebas y bases desechables. **Nada de esto se aplicó todavía a datos reales.**

**Parciales que siguen abiertos:**
- **C07:** el "No aplica" de una ocurrencia programada no pasa por revisión. Quedó fuera de alcance en T2.
- **I03:** la responsabilidad por cargo y los roles globales siguen sin cambios.
- **M02-B:** un archivo recién subido y todavía sin referenciar podría enlazarlo otra faena si alguien adivina su nombre (nanoid de 20 caracteres). Cerrarlo exige un registro de dueño por subida; decisión D11, diferido.
- **M03:** el estado de la evidencia vive en 4 tablas.
- **M06:** los acuses no tienen caducidad, por decisión D27.
- **M09:** `prevention-inspections.ts` sigue siendo un archivo enorme y las obligaciones no se paginan.
- **I13:** no hay alertas externas; solo logs, por decisión D28.

## Antes de desplegar (orden sugerido)

1. Revisar y fusionar `prevencion/integracion-final` a `main` (decisión tuya; nada se subió).
2. Seguir `docs/deploy/DESPLIEGUE_PREVENCION_2026-09.md`:
   - consultas Q1–Q7 de solo lectura sobre producción;
   - `npm run pdtp:report-closure-drift` (D6) desde el checkout nuevo;
   - reporte del backfill B01;
   - estimación del bloqueo de 0333 según el tamaño de las tablas;
   - aviso a usuarios 48 h antes.
3. Después del despliegue:
   - verificar los 11 crons en `cron_runs`;
   - revisar 1–2 semanas del GC en modo de prueba antes de activar el borrado;
   - revisar el backfill B01 con Prevención antes de correr `--apply`.

## Sin recorrer

- Nada se aplicó ni se corrió contra producción ni contra la base de desarrollo; la clonación del programa real no se autorizó. Tampoco hubo prueba de realidad con 10 actividades del programa 2026 ni una v+1 o un 2027 sobre una copia real.
- Migraciones 0329–0333 sobre datos reales, con su duración y el EXPLAIN real.
- Crons, GC, respaldos y simulacro de restauración en el contenedor de producción.
- Navegadores distintos de Chromium (WebKit/Safari).
- `test:e2e` completo después de las correcciones de la revisión final: se corrió `pdtp-*` + `prevencion-*` (170 PASS).
- Fuera del alcance de Prevención, encontrado de paso por la tanda I01/W8: `e2e/reflow-anchos.spec.ts` mide solo `documentElement` y no ve el desborde dentro del contenedor del shell. Sin corregir desbordan Solicitudes y Trazabilidad (59 px a 390 px), entre otras pantallas.
