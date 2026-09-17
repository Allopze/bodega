# QA — Export del programa PDTP en formato RE-36 (Task 1.7, cierre de fase)

Fecha: 2026-09-17
Alcance: `app/api/prevencion/pdtp/export/route.ts` (dispatch por `?formato=`), menú de
acciones del detalle del programa (`app/(app)/prevencion/pdtp/[programId]/page.tsx`),
tests de ruta y E2E.
Entorno: worktree `/home/allopze/dev/chome/bodega-pdtp-exec`, rama
`feat/pdtp-mejoras-exec`. Postgres E2E en `bodega-e2e-postgres` (puerto 55432).

## Resultado

`formato=re36` (default) llama a `buildPdtpRe36Document` + `renderPdtpRe36Buffer`
(tareas 1.5/1.6) conservando las dos guardas de faena existentes
(`assertWorksiteAccess`, `isActivePdtpWorksite`) antes de decidir el formato.
`formato=plano` sigue llamando exactamente a `buildPdtpExport` + `buildXlsxBuffer`,
sin cambios de comportamiento. Un `?formato=` desconocido cae al default (`re36`)
en vez de fallar. El `newState` de la auditoría registra el `formato` elegido en
los tres resultados (`success`/`denied`/`invalid`/`error`).

El nombre del archivo RE-36 usa el año y la versión del **programa resuelto**
(`doc.program.year`/`doc.program.version`) y el código de la **faena resuelta**
(`doc.worksite.code`), no los valores de la query string — mismo criterio que ya
usaba `buildPdtpExport` (comentario preexistente sobre `view.program.year`).

## Comprobaciones deterministas

| Puerta | Resultado | Evidencia |
|---|---|---|
| `npx vitest run app/api/prevencion/pdtp/export/route.test.ts` | PASS | 20/20 (16 preexistentes + 4 nuevos: default re36, re36 explícito, formato desconocido → re36, re36 sin programId → 400) |
| `npm run test:fast` | PASS | 714 archivos, 30 omitidos (744); 7377 pruebas, 317 omitidas (7694) — sube en exactamente 4 sobre el baseline de la tarea 1.6 (7373), las 4 nuevas de `route.test.ts` |
| `NODE_OPTIONS="--max-old-space-size=6144" npx tsc --noEmit --incremental false` | PASS | Sin errores |
| `npx eslint app/api/prevencion/pdtp/export/route.ts app/api/prevencion/pdtp/export/route.test.ts "app/(app)/prevencion/pdtp/[programId]/page.tsx" e2e/pdtp-templates-exports.spec.ts e2e/pdtp-lifecycle-approvals.spec.ts` | PASS | Sin hallazgos |
| `E2E_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/bodega_e2e npx playwright test e2e/pdtp-templates-exports.spec.ts e2e/pdtp-lifecycle-approvals.spec.ts` | PASS | 13/13 (build con `next build --webpack`, sin problema de Turbopack — el script de arranque E2E ya construye con `--webpack`) |

No corrí `npm run db:migrate` ni la suite PGlite completa (indicado explícitamente
como gate de cierre de fase a cargo de otro agente).

### Por qué se tocó `e2e/pdtp-lifecycle-approvals.spec.ts`

Ese spec (no listado en el brief) tenía una aserción literal sobre el ítem único
"Exportar programa" del menú de acciones del programa (`pdtp-prog-e2e`). Al
dividirlo en "Exportar RE-36" / "Exportar planilla plana" (punto 5 del encargo),
esa aserción habría quedado rota. Se actualizó a los dos nuevos nombres —cambio
mínimo, mismo test, misma intención (verificar que el menú hidrata sin errores).

## E2E — qué verifica cada test nuevo (`e2e/pdtp-templates-exports.spec.ts`)

Todos anclados al fixture `pdtp-prog-e2e` (año 2026, versión 1, sin
`documentCode` propio → cae al default `RE-36`) / `ws-e2e` (código `E2E-001`,
"Faena E2E"), que ya usan sin modificarlo `pdtp-reporte-gestion.spec.ts` y
`pdtp-lifecycle-approvals.spec.ts` — seguro de anclar en la suite compartida
(1 solo worker, orden alfabético).

1. **`?formato=re36`**: 200, `Content-Type` xlsx, `Content-Disposition` con
   `RE-36-PDTP-2026-E2E-001-v1.xlsx` (año/versión del programa, código de la
   faena resueltos, no de la query). Abre el buffer con ExcelJS y confirma:
   - Las hojas `Hoja E2E` (la única propia del programa) y `Desvíos` existen.
   - `F1` ("CÓDIGO: RE-36") contiene "RE-36".
   - `A2` ("Faena: Faena E2E (E2E-001)") contiene el nombre y el código de la faena.
   - El total P de la única fila de datos (`F17`, con `firstDataRow=16` y 1
     actividad) es un objeto `{formula: "SUM(F16:F16)"}`, no texto ni número.
2. **`?formato=plano`**: 200, mismo `Content-Type`, `Content-Disposition` con
   `pdtp-sg-sst-2026-s1.xlsx` — el nombre y la ruta de la planilla plana no
   cambiaron.
3. **Menú del programa**: abre "Más acciones" en `/prevencion/pdtp/pdtp-prog-e2e`
   y confirma que "Exportar RE-36" y "Exportar planilla plana" son visibles y
   que sus `href` contienen `formato=re36`/`formato=plano` respectivamente.

## Verificación manual del archivo RE-36 (LibreOffice no disponible)

Punto 6 del encargo: **no fue posible abrir el archivo en LibreOffice**. `soffice`
no está instalado en este entorno (`command -v soffice` → exit 1) y no hay
`sudo` para instalarlo — mismo hueco que documentaron las tareas 1.5/1.6. No se
intentó instalar el paquete.

En su lugar, se generó el documento real contra la base E2E (mismo fixture
`pdtp-prog-e2e`/`ws-e2e` de arriba, llamando directamente a
`buildPdtpRe36Document` + `renderPdtpRe36Buffer` con un script descartable,
`.tmp/re36-manual-check.mjs`, borrado tras la corrida junto con el `.xlsx`
generado) y se abrió con **openpyxl** (disponible en este entorno,
`python3 -c "import openpyxl"` funciona). Se verificó, con la API pública de
openpyxl:

| Verificación | Resultado |
|---|---|
| Nombres de hoja | `['Hoja E2E', 'Desvíos']` |
| Celda de código (`F1`) | `'CÓDIGO: RE-36'` — contiene "RE-36" |
| Faena en la cabecera (`A2`) | `'Faena: Faena E2E (E2E-001)'` |
| Título (`A1`) | `'PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026'` |
| Total P (`F17`) | `'=SUM(F16:F16)'` — fórmula, no texto/número literal |
| Total E (`G18`) | `'=SUM(G16:G16)'` — fórmula |
| Reglas de formato condicional, columnas E | 3 reglas en el mismo bloque (`sqref` multi-rango): `expression LEN(TRIM(...))=0` prioridad 1, `cellIs equal 0` prioridad 2, `cellIs between [1, 1000000000]` prioridad 3 |
| Regla de formato condicional, columnas P | 1 regla `colorScale`, prioridad 4 |

Esto confirma la estructura del archivo (hojas, cabecera, fórmulas vivas, las
tres reglas de semáforo) tal como la documentó la tarea 1.6. **Queda pendiente
de un entorno con LibreOffice**: la verificación de que el archivo abre sin
diálogo de reparación y que las fórmulas (`SUM`, `IFERROR`, las 24 celdas de
suma explícita del % trimestral) recalculan correctamente sin errores de rango
o referencia — ninguna herramienta disponible en este entorno evalúa fórmulas
ni resuelve el formato condicional en conflicto. Mismo hueco heredado y no
cerrado por las tareas 1.5/1.6; recomendado re-correr `openpyxl`/LibreOffice
real en un entorno con `soffice` antes de considerar la Fase 1 completamente
cerrada.

## Preocupaciones abiertas

1. **Recálculo real en LibreOffice, no verificado** (ver arriba) — heredado de
   las tareas 1.5/1.6, no cerrado por esta.
2. **`formato=re36` sin `programId` devuelve 400** ("Falta indicar el programa
   para exportar el RE-36."): a diferencia de `buildPdtpExport`, que puede
   resolver el programa por `?year=` cuando no se pasa `programId`,
   `buildPdtpRe36Document` exige `programId` explícito (no tiene ese
   fallback). En la práctica el menú del programa siempre incluye `programId`
   en el enlace, así que no debería ocurrir desde la UI; queda como
   defensa explícita en la ruta, auditada como `invalid`.
3. Preocupaciones heredadas de las tareas 1.5/1.6 (bloque de indicador de
   plataforma como mini-tabla, `quarterFormula` default `"ratio"` en vez de
   `"average"`, filas heredadas de documentCode/glosario) siguen abiertas sin
   cambios de esta tarea — ver `task-1.5-report.md`/`task-1.6-report.md`.

## Verificación de recálculo con LibreOffice (2026-09-17, cierre de la brecha)

La brecha declarada en este informe —"no se pudo verificar que las fórmulas recalculen porque LibreOffice no está instalado"— **queda cerrada**. Se ejecutó LibreOffice en un contenedor (`linuxserver/libreoffice`, `soffice` en `/usr/bin/soffice`) sobre libros generados por `renderPdtpRe36Buffer` con un documento de 4 actividades en 3 objetivos, una de ellas a demanda, dos hojas (general y de cargo) y un texto que empieza con `=` en el control de cambios.

| Comprobación | Resultado |
|---|---|
| Apertura y conversión por LibreOffice | sin diálogo de reparación, ambos modos |
| Errores de fórmula (`#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, `#N/A`…) | **0** |
| Totales `SUM` por semana | P = 0, 1, 0, 2 · E = 0, 1, 0, 1 — correctos |
| `%` semanal con `IFERROR` | emite `""` en las semanas sin planificación, no error |
| `%` trimestral, modo `ratio` (ΣE/ΣP, el default) | **0,80** |
| `%` trimestral, modo `average` (réplica del Excel legado) | **0,875** |

La diferencia de 0,075 entre ambos modos es la demostración numérica del defecto P-4 del informe comparativo: promediar porcentajes semanales infla el cumplimiento respecto de dividir los totales. El default `ratio` es deliberado; `average` queda disponible para quien necesite la réplica literal de la planilla histórica.

Queda **fuera** de esta verificación el aspecto visual (resolución de conflictos de formato condicional, apariencia del achurado), que ninguna herramienta disponible evalúa sin abrir el archivo a ojo.
