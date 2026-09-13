# Verificación y remediación de la auditoría integral

**Corte:** 2026-09-12 · **Base:** `AUDITORIA_INTEGRAL_CHOME_2026-09-12.md`

Cada hallazgo del informe se contrastó contra el código. Este documento registra el
veredicto y el estado de la remediación. El informe original no se modificó.

## Veredicto general

**Todos los reclamos concretos del informe son ciertos.** Se confirmaron con evidencia de
código o de ejecución S1-01, S1-02, S1-03, S2-01, S2-02, S2-03, S2-05, S3-01, S3-02 y
S3-03. Tres puntos, sin embargo, cambian el orden de trabajo respecto de la hoja de ruta
propuesta.

### 1. El hallazgo más grave no está en el informe: CI estaba rojo

`npm run check:security-audit` salía con código 1. Ese script corre en el job `static` de
`.github/workflows/ci.yml`, así que ningún PR podía mergear. El informe afirma que
`package.json` "no expone scripts de auditoría" (S2-05): es incorrecto —
`check:security-audit` existe y **es** la puerta. No faltaba el control; el control estaba
fallando y el informe no lo registró.

### 2. S1-01 afectaba a cuatro reportes, no a uno

La causa no vivía en `dte-conciliacion.ts` sino en el contrato de `excel-builder.ts`:
`sheets` *reemplazaba* la hoja primaria en vez de sumarse. Perdían su hoja de detalle
`dte-conciliacion`, `bodega-valorizacion`, `billing-cobranza` y `analitica`.

En `analitica` la pérdida era mayor de lo que parecía: su hoja primaria es el **único**
portador de `data.spendByModule` (gasto por módulo), que no aparece en ninguna sub-hoja.

### 3. `npm audit --omit=dev` reportaba cinco vulnerabilidades, no dos

El informe omitió `browserslist` (alta), `fast-uri` (alta) y `baseline-browser-mapping`
(moderada), las tres marcadas PROD en el lockfile.

### Correcciones puntuales al informe

| Hallazgo | Corrección |
|---|---|
| S2-05 | `AGENTS.md:158` ya condicionaba `audit:report` ("si no está, no lo inventes"); ese subreclamo sobraba. `qa/reports/latest.md` no era copia byte a byte del informe de trazabilidad: difería en una línea de puntero |
| S2-02 | Cierto, pero **latente**: `components/ui/file-dropzone.tsx` no se importa en ningún lado. El dropzone que sí está en producción (`ImportFileDropzone`) ya era operable por teclado |
| S3-01 | El input quedaba fuera del tab order por un `tabIndex={-1}` explícito, no sólo por estar oculto |
| S3-03 | Cierto en el efecto, equivocado en la causa: `odoo-19.0/` y `erpnext-develop/` están en `.gitignore`, no son parte del repo. El arreglo era `doctor.config.json` |
| S1-03 | Esfuerzo "medio" sobreestimado: la superficie MapLibre son ~8 llamadas en un archivo, sin `Popup`/`setHTML` —la superficie del advisory de XSS— así que el riesgo real era de cadena de suministro y de puerta de CI, no de explotación conocida |

## Hallazgos nuevos, no presentes en la auditoría

### N-01 — `pdf_text` nunca puede extraer líneas de detalle

`lib/services/purchasing-module/pdf-text-extractor.ts:33` une **todos** los fragmentos de
texto de una página con `" "`, y sólo separa con `\n` entre páginas. El texto de una
factura de una página es, por construcción, **una sola línea**.

`invoice-text-parser.ts` extrae las líneas de detalle recorriendo `text.split(/\n/)` y
aplicando patrones por fila. Con una sola línea no hay filas que reconocer, así que
`parsed.items` sale vacío siempre que la factura tenga una página.

La consecuencia está en `invoice-extractor.ts`: cuando la cabecera es utilizable pero no
hay líneas, el flujo **siempre** cae a OCR ("se intentó OCR adicional"). Es decir, toda
factura PDF digital de una página paga el costo completo del OCR aunque su capa de texto
sea perfecta. La cabecera —folio, fecha, montos— sí se extrae bien por `pdf_text`.

El efecto medido es peor que "lento": con el extractor anterior, la corrida E2E de
`invoice-extraction.spec.ts` **nunca terminó** dentro de un presupuesto de 20 minutos —el
formulario se quedaba en "Procesando archivo..."—, mientras que el propio OCR, invocado
fuera del servidor, no lograba leer nada del documento.

**Resuelto.** `pdf-text-extractor.ts` ahora reconstruye las filas agrupando los fragmentos
por su coordenada vertical (`transform[5]`, con tolerancia) y ordenándolos por la
horizontal, en vez de concatenar todo con espacios. Se agrupa por geometría y no por
`hasEOL` porque esa marca depende del generador del PDF; la posición siempre está. El
ordenamiento importa aparte: el orden de dibujo no es el orden de lectura —un pie de
página puede emitirse antes que su cabecera— y antes salía en el orden en que el PDF los
dibujaba.

Medición sobre la misma factura, antes y después:

| | Antes | Después |
|---|---|---|
| Método | OCR (fallback) | `pdf_text` |
| Líneas extraídas | 0 | 2 |
| Duración de la extracción | no terminó en 20 min | 572 ms |
| E2E `invoice-extraction` | colgado | 2,8 s ✓ |

Cubierto por `lib/services/purchasing-module/pdf-text-extractor.test.ts`, que antes no
existía: los tres primeros casos fallan contra el extractor anterior.

### N-02 — El artefacto de despliegue llevaba documentos reales de usuarios

La auditoría clasificó S3-04 como "oportunidad de rendimiento… no se midió aún impacto de
usuario". **Estaba mal clasificado**, y la medición lo dimensiona:

| | Antes | Después |
|---|---|---|
| `.next/standalone` | 2,5 GB | **417 MB** |
| Archivos de usuario en el artefacto | **10.316** | **0** |
| Avisos de patrón dinámico en el build | 9 | **0** |
| Traza NFT de `compras/[id]` | 16.491 archivos | 1.841 |

Dentro de la imagen de producción viajaban `storage/` completo —evidencia de inspecciones,
importaciones de riesgo, un `.sql` de rollback—, más `docs/` (1,9 GB), `odoo-19.0/`, `e2e/`,
`qa/` y `audit/`.

Causa: Turbopack evalúa `path.join` como patrón de archivo y traza todo lo que calce; con un
primer argumento de runtime el patrón globea el proyecto entero. El repositorio **ya
documentaba el arreglo** —`lib/storage/config.ts` explica que sin `/*turbopackIgnore: true*/`
"Turbopack traza el directorio entero del proyecto al bundle standalone"— pero los sitios de
escritura se lo saltaban. La auditoría contó 9; eran 13 sin comentar, más 8 comentados a
mano y dos subdirectorios armados con un join suelto.

**Resuelto** concentrando el join en `resolveStorageFile()` (`lib/storage/config.ts`), que
además valida el nombre —el punto de escritura no tenía esa defensa contra traversal, sólo
la tenía la construcción de la ruta relativa—. Los 22 sitios pasan por ahí y ya no importan
`node:path`. Una regla `no-restricted-imports` impide reintroducirlo; se verificó que la
regla falla al reponer el import.

### N-03 — 20 timeouts E2E por falta de `actionTimeout`

`playwright.config.ts` no definía `actionTimeout`, y el default de Playwright es esperar
indefinidamente: una acción sobre un locator que ya no resuelve colgaba los 150 s completos
del test en vez de fallar nombrando el locator. Eran **20 × 150 s ≈ 50 minutos de reloj
muerto** en la corrida completa, y explicaban buena parte de los 90 minutos en que la suite
no alcanzaba a terminar.

Fijado en 15 s. El mismo fallo pasó de 150 s mudos a 17,6 s diciendo exactamente qué locator
no resolvía.

## Estado de la remediación

| # | Hallazgo | Estado |
|---|---|---|
| S1-01 | Hoja primaria de los libros Excel | **Resuelto** — contrato del builder corregido; 4 reportes recuperan su detalle |
| S1-02 | `sharp` vulnerable | **Resuelto** — `0.35.4` |
| S1-03 | `maplibre-gl` advisory crítico | **Resuelto** — `6.9.0` |
| — | `browserslist`, `fast-uri`, `baseline-browser-mapping` (omitidos por el informe) | **Resuelto** |
| S2-01 | Identidad de línea DTE | **Resuelto** — regla única `resolveOrderItemMatchName` |
| S2-02 | Dropzone sin teclado | **Resuelto** |
| S2-03 | Etiquetas SST sin asociar | **Resuelto** |
| S2-05 | Contrato QA y documentación | **Resuelto** — RUNBOOK escrito, README y `AGENTS.md` corregidos, `latest.md` convertido en índice |
| S3-01 | `supervisor_terreno` sin faena | **Resuelto** — con test derivado de `SYSTEM_ROLES` |
| S3-02 | Documentación RBAC desactualizada | **Resuelto** — 15 roles / 270 permisos / 21 módulos, con test que ata la doc al código |
| S3-03 | Métrica React Doctor contaminada | **Resuelto** — proyectos de referencia excluidos |
| S2-04 | E2E como puerta determinista | **En curso** |
| S3-04 | Imports dinámicos amplios | **Resuelto y reclasificado** — ver N-02: no era rendimiento |
| S3-05 | `nextDueOn` que no avanza | Backlog — no reproducido, no confirmado como defecto |

## Evidencia de verificación

- `npm audit --omit=dev`: **0 vulnerabilidades**; `npm run check:security-audit` sale 0.
- `npm run typecheck`, `npm run lint`: pasan.
- `npm run test:fast`: 662 archivos, 6.831 pruebas pasadas, 313 omitidas.
- `npm run test:pglite`: 133 archivos, 1.590 pruebas pasadas.
- `npm run build`: verde con MapLibre 6 (ESM-only) sobre Next 16/Turbopack.
- `npm run test:e2e -- export-volume.spec.ts`: 11/11, incluidos los dos casos que validan
  la hoja `Conciliación OC-Factura-DTE` y la columna de discrepancia — la evidencia que el
  informe citaba como fallando.

Las regresiones de S1-01 y S3-01 se verificaron revirtiendo el arreglo: sin él, el libro
DTE traía sólo `Calidad de la referencia`, y el test de roles señalaba `supervisor_terreno`.
