# Plan de mejora UI/UX — Módulos nuevos (2026-08-05)

Auditoría visual de los módulos agregados desde el 25-07-2026: **Facturación y cobranza**
(9 rutas), **DTE** (`/compras/dte`, `/admin/dte`), páginas nuevas de **PDTP**
(`actividades`, `programas`) y **Prevención → Privacidad**. Se revisó también
`/pendientes` por regresiones (auditado el 07-29).

> **Remediación 2026-08-05 (misma tarde):** C1–C3, A1–A5, M2 y M3 corregidos y
> verificados con re-captura (evidencia post-fix en
> `audit/screenshots/2026-08-05-modulos-nuevos-post-fix/`, 25 PNG; typecheck limpio,
> 27 tests de billing pasan, `console-errors.txt` de la re-captura sin errores de key).
> Cada hallazgo lleva su nota **Estado**. Lo pendiente quedó consolidado en la §8.
>
> **Segunda pasada 2026-08-05 (fases 2–3):** M1, M4–M10, los tres seguimientos
> (C1-bis, A2-bis, A1-bis) y B1a/B2/B3/B4 corregidos y verificados con una tercera
> captura (`audit/screenshots/2026-08-05-modulos-nuevos-post-fase2/`; typecheck
> limpio, 73 tests afectados + 27 de integración en verde, consola sin errores).
> Lo que queda vivo está en la §8 reescrita al final.

## 1. Contexto y método

- **Superficie:** SaaS enterprise back-office, escritorio 1920×1080, tema claro (único).
- **Evidencia:** 25 capturas en `audit/screenshots/2026-08-05-modulos-nuevos/` (gitignored),
  tomadas contra `bodega_capture` (clon de la BD dev + seed de facturación/DTE con 14
  facturas, pagos, duplicados, propuestas y corridas de sync en todos los estados).
- **Medición:** ratios WCAG calculados desde los tokens oklch de `app/globals.css`
  (conversión OKLab → sRGB). Cada hallazgo cita el valor medido.
- **Veredicto global:** el sistema de tokens es sano (todos los pares ink/tint de chips
  pasan AA con holgura), pero el módulo de facturación **no usa los componentes
  compartidos** en sus botones y eso produce el peor defecto de contraste de la
  plataforma. Puntuación: Usabilidad 6.5 · Jerarquía 7 · Accesibilidad 5 · Global **6/10**.
  Responsividad no evaluada (solo desktop).

## 2. Hallazgos críticos — bloquean despliegue, corregir hoy

### C1. Botones primarios ilegibles en TODO facturación — 2.33:1 (exige 4.5:1)

- **Problema:** los botones verdes del módulo ("Nueva propuesta", "Nuevo contrato",
  "Agregar vínculo", "Guardar datos internos", "Sincronizar", diálogos de cobranza y
  duplicados) renderizan texto casi negro `#121111` sobre verde `#005c3f`.
- **Causa raíz:** usan una clase local `primaryButtonClass` con
  `text-[var(--color-primary-contrast)]` — **ese token no existe** en `globals.css`,
  así que el color se hereda del texto normal. 8 archivos afectados:
  [page.tsx](app/(app)/facturacion/page.tsx),
  [duplicate-review.tsx](app/(app)/facturacion/duplicados/duplicate-review.tsx),
  [proposal-actions.tsx](app/(app)/facturacion/propuestas/proposal-actions.tsx),
  [proposal-dialog.tsx](app/(app)/facturacion/propuestas/proposal-dialog.tsx),
  [internal-panel.tsx](app/(app)/facturacion/facturas/[id]/internal-panel.tsx),
  [collection-action-dialog.tsx](app/(app)/facturacion/cobranza/collection-action-dialog.tsx),
  [client-contract-manager.tsx](app/(app)/facturacion/clientes/client-contract-manager.tsx),
  [sync-controls.tsx](app/(app)/facturacion/sincronizacion/sync-controls.tsx).
- **Evidencia:** 2.33:1 medido; con texto blanco (como hace `<Button variant="primary">`,
  ver PDTP y `/admin/dte`) da 8.09:1.
- **Principio:** WCAG 2.2 §1.4.3 (AA). Falla legal, no estética.
- **Fix:** reemplazar la clase local por el componente compartido
  [button.tsx](components/ui/button.tsx) (o, mínimo, definir
  `--color-primary-contrast: #fff` como stopgap). El fix bueno además elimina la
  duplicación en 8 archivos.
- **Estado: ✔ corregido (2026-08-05).** `text-[var(--color-primary-contrast)]` →
  `text-white` en los 8 archivos (8.09:1 verificado en re-captura). Queda como
  seguimiento consolidar las 8 copias de `primaryButtonClass` en `<Button>` (§8).

### C2. Estados CAPA en inglés crudo en /pendientes

- **Problema:** la cola muestra chips "in progress", "reopened", "pending verification"
  junto a "En revisión", "Aprobada", "Listo para comprar".
- **Evidencia:** captura `pendientes.png`, filas CAPA-2026-0058/0054/0004.
- **Principio:** Nielsen #4 (consistencia y estándares); idioma del sistema.
- **Fix:** mapa de etiquetas ES para los estados CAPA en la fuente de la cola de trabajo
  (donde se arma `statuses` para [work-queue-workbench.tsx](app/(app)/pendientes/work-queue-workbench.tsx)),
  con fallback legible para claves desconocidas.
- **Estado: ✔ corregido (2026-08-05).** La causa era un `REPLACE(status,'_',' ')` en
  [operational-work-queue.ts](lib/services/operational-work-queue.ts); ahora un CASE
  espejo de `CAPA_STATUS_LABELS` (lib/prevention/capa.ts). Verificado: "En proceso",
  "Reabierta", "Pendiente de verificación".

### C3. Key de React duplicada (nombre de persona como key)

- **Problema:** durante la captura la consola registró
  `Encountered two children with the same key — "Sergio de la Cruz Roca Roca"`.
  React puede omitir o duplicar filas cuando esto pasa.
- **Evidencia:** `console-errors.txt` de la corrida (alguna de las 15 rutas capturadas;
  el nombre sugiere una lista de responsables/trabajadores).
- **Fix:** localizar con React DevTools y keyear por `id`, nunca por nombre visible.
  Dos personas pueden llamarse igual; un apellido compuesto ("Roca Roca") ya colisionó.
- **Estado: ✔ corregido (2026-08-05).** Localizado con captura instrumentada por ruta:
  el error era del **/dashboard** (flush tardío mal atribuido a facturación) —
  [dashboard-charts.tsx:811](app/(app)/dashboard/dashboard-charts.tsx#L811) keyeaba
  `Cell` de un ranking por `row.name`. Ahora key posicional (las Cell son 1:1 con las
  filas). Re-captura sin errores de key.

## 3. Hallazgos altos — este sprint

### A1. Texto pequeño con tokens base en vez de `-ink` (2.3–2.7:1)

`text-[var(--color-warning)]` sobre blanco = **2.53:1** y sobre warning-tint = **2.31:1**;
`text-[var(--color-signal)]` = **2.73:1**. Usos:
[metadata-tab.tsx:175,304](app/(app)/prevencion/pdtp/[programId]/editar/tabs/metadata-tab.tsx#L175),
[capa-list.tsx:238](app/(app)/prevencion/capa/capa-list.tsx#L238) ("Por conciliar"),
[revision-tab.tsx:59](app/(app)/prevencion/pdtp/[programId]/editar/tabs/revision-tab.tsx#L59),
[programas/page.tsx:106](app/(app)/prevencion/pdtp/programas/page.tsx#L106) (badge warning).
**Fix:** usar `--color-warning-ink` / `--color-signal-ink` (8.75:1 y 9.43:1 medidos).
Regla para AGENTS.md: *los tokens base (signal/warning/accent) jamás como color de texto;
para texto siempre `-ink`*.

**Estado: ✔ corregido (2026-08-05) — y era mucho más extendido que lo auditado:**
el reemplazo global de warning/signal como color de texto → `-ink` tocó **28 archivos**
en toda la plataforma (combustibles, admin, trazabilidad, reportes, bodega, TAE
público…), no solo los 5 usos de PDTP/CAPA detectados. La regla para AGENTS.md sigue
pendiente de escribirse (§8).

### A2. Volcado completo de errores en la tabla de corridas de sincronización

En `/facturacion/sincronizacion`, la columna RESULTADO renderiza el `errorSummary`
entero: 45 líneas repetidas de "Documento 33/134xx sin RUT de contraparte…" en una
celda (~1.500px de alto) y recién al final "(+45 errores en total)". El resumen de
`/facturacion` muestra el mismo texto en 3 líneas rojas. **Fix:** truncar a 1–2 líneas
con "Ver detalle" (collapse o panel); deduplicar mensajes idénticos en el origen
(`errorSummary` ya llega concatenado — comprimir a "45 documentos sin RUT de
contraparte" + muestra).

**Estado: ✔ corregido en la UI (2026-08-05).** La celda muestra el primer mensaje
(clamp 2 líneas) + `<details>` "Ver los N mensajes". La compresión/dedupe en el
**origen** (`sync.ts`) sigue pendiente (§8).

### A3. Título truncado en la TopBar a 1920px

"Pendientes de f…" — el título compite sin protección con la descripción larga en
[top-bar.tsx:123-133](components/layout/top-bar.tsx#L123-L133) (`truncate` en ambos,
sin `shrink-0`/`min-w` en el título). **Fix:** priorizar el título (p. ej.
`shrink-0 max-w-[50%]`) y dejar que la descripción absorba el truncado; las
descripciones de facturación son las más largas de la app y siempre pierden el título.

**Estado: ✔ corregido (2026-08-05).** Título con `shrink-0 max-w-[36rem]` en
[top-bar.tsx](components/layout/top-bar.tsx); verificado: "Pendientes de facturar"
completo y la descripción es la que trunca.

### A4. /compras/dte: período fijo, sin estado ni fecha

- Muestra solo el mes actual (`new Date().toISOString().slice(0,7)` — además UTC, en
  Chile el cambio de mes ocurre 4h antes) y **no hay selector de período**: los DTE de
  julio quedan inaccesibles desde la UI.
- No se muestra el estado SII (aceptado/rechazado/anulado se consulta pero no se ve)
  ni la fecha de emisión. Un rechazado luce igual que un aceptado.
- **Fix:** selector de período (como en facturación), columnas Fecha y Estado SII con
  los mismos badges del resto, y fecha con hora de Chile.
- **Estado: ✔ corregido (2026-08-05).** `?periodo=YYYY-MM` con `PeriodPicker` reutilizado
  (movido a [components/ui/period-picker.tsx](components/ui/period-picker.tsx)), default
  del mes en America/Santiago, y columnas Emisión + Estado SII con `Badge`. Verificado
  en re-captura (aceptado verde, pendiente de envío ámbar, NC "-$238.000").

### A5. Duplicados: no se ve POR QUÉ son duplicados

Las dos tarjetas comparadas muestran folio/fecha/total/fuente — campos donde son
**idénticas** — pero no el RUT receptor ni la evidencia guardada
(`coinciden`/`difieren` de `billing_duplicate_candidates`), que es justo lo que difiere.
Decidir una fusión (acción que declara irreversible la propia página) sin ver la
diferencia es adivinar. **Fix:** en
[duplicate-review.tsx](app/(app)/facturacion/duplicados/duplicate-review.tsx) mostrar
todos los campos de identidad y resaltar los que difieren.

**Estado: ✔ corregido (2026-08-05).** Las tarjetas ahora muestran Receptor (RUT+razón
social) y Estado documental, y todo campo que difiere entre los dos lados se resalta
con `<mark>` en warning-tint (folio, receptor, fechas, montos, estado). Verificado:
el conflicto por DV del RUT y el par de folios 1013/1014 se ven de inmediato.

## 4. Hallazgos medios — próximo sprint

- **M1 · Dos lenguajes de chips en la misma dimensión.** La convención de
  [badge.tsx](components/ui/badge.tsx) (severity = mono uppercase, neutro = prose) es
  razonable, pero aplicada mezcla estilos en la MISMA columna: "PENDIENTE DE PAGO" +
  "En gestión" en una fila; "VIGENTE" (mono) vs "Cerrado" (prose) en la misma columna de
  contratos; y los filtros de PDTP actividades combinan 4 estilos ("Todas 87",
  "EJECUTADAS 0", "● Pendientes 1", "ATRASADAS 38"). Regla: *misma dimensión semántica →
  mismo tratamiento*; auditar usos por columna.
  **Estado: ✔ corregido (2ª pasada).** En `labels.ts` toda dimensión de estado usa solo
  tonos con tipografía severity (documentado en el propio archivo): "En gestión",
  "En revisión", "En curso", "Emitida", "Sugerido" y los cierres pasaron de
  info/outline a primary/neutral. Contratos "Cerrado" → `neutral` (misma caja que
  VIGENTE) y los 5 filtros de PDTP actividades quedaron en un solo estilo
  (Pendientes usa `signal`, el tono reservado para pendiente).
- **M2 · Formato de negativos inconsistente.** Facturación (Intl es-CL): `$-1.190.000`;
  DTE (`formatCLP`): `-$238.000`. Unificar en una sola función.
  **Estado: ✔ corregido (2026-08-05)** — al revés de lo que decía este plan: `formatCLP`
  produce `-$` **a propósito** (decisión documentada del 2026-08-04 en `lib/utils.ts`),
  así que fue `formatMoney` de billing el que se alineó a `-$` (con test nuevo en
  `money.test.ts`). Verificado: la NC muestra `-$1.190.000`.
- **M3 · Dos vocabularios para el estado de corridas de sync.** Facturación:
  `EXITOSA / CON ERROR / PARCIAL` (mono); `/admin/dte`: `✓ Exitosa / ⏱ En curso / Parcial`
  (prose + ícono). Es el mismo concepto; un solo componente.
  **Estado: ✔ corregido (2026-08-05).**
  [dte-sync-list.tsx](app/(app)/admin/dte/dte-sync-list.tsx) ahora usa el mismo
  `Badge` + `syncStatusLabel` que facturación (de paso "Fallida" → "Con error",
  un solo vocabulario).
- **M4 · /facturacion/pendientes: bloque repetido 8 veces.** "SIN PROPUESTA + Contrato
  mensual vigente sin factura para AAAA-MM + Falta preparar la propuesta…" idéntico en
  8 de 9 filas (~95px por fila). Comprimir a chip + una línea; el detalle al hover o al
  expandir.
  **Estado: ✔ corregido (2ª pasada).** Sin propuesta → solo el badge con el detalle en
  tooltip (el período ya tiene columna propia); las líneas explicativas quedan solo
  cuando hay propuesta, donde sí varían.
- **M5 · Cobranza: 22 links de acción repetidos y acciones destructivas sin jerarquía.**
  "Registrar gestión / Registrar pago" en cada fila como texto plano; en propuestas,
  "Anular" y "Rechazar" lucen igual que "Aprobar". Diferenciar (ghost vs danger) y
  considerar menú por fila.
  **Estado: ✔ parcial (2ª pasada).** "Rechazar" y "Anular" ahora en danger-ink,
  verificado. La repetición de los 22 links en cobranza (menú por fila) queda
  pendiente (§8).
- **M6 · Detalle de factura: el formulario de vincular lee como estado vacío.** Los
  selects "Sin cliente / Sin contrato / Sin faena" aparecen ARRIBA del vínculo ya
  confirmado — parece que la factura no tiene vínculo. Orden correcto: vínculo actual
  primero, "Agregar otro vínculo" colapsado.
  **Estado: ✔ corregido (2ª pasada).** Vínculo actual (o "Sin vínculo todavía")
  primero; el formulario vive en un `<details>` "Agregar vínculo" que solo viene
  abierto cuando no hay ninguno. Verificado en re-captura.
- **M7 · Historial muestra claves crudas.** Evento sin traducción renderiza
  `link.confirmed`. Fallback humano para tipos desconocidos.
  **Estado: ✔ corregido (2ª pasada).** Se agregaron al mapa los 4 tipos reales que
  faltaban (`linked_to_proposal`, `merged_from`, `merged_into`, `payment.reverted`)
  y un fallback que humaniza claves desconocidas.
- **M8 · Inputs nativos de fecha/mes dependen del locale del navegador.** Placeholder
  "-------- ----", mes "August 2026", fecha "08/14/2026" en una app es-CL. Mínimo:
  `lang` correcto; ideal: el picker propio en los 3 puntos (filtros facturas, período de
  sync, vencimiento en detalle).
  **Estado: ✔ parcial (2ª pasada).** Los tres `<input type="month">` (filtro de
  facturas, período de sync, período de servicio del vínculo) son ahora selects es-CL
  con los helpers exportados de `period-picker.tsx`. El `<input type="date">` del
  vencimiento se queda nativo a propósito: es accesible y estándar; solo su formato de
  display depende del navegador.
- **M9 · Copy.** "Falta: Falta HES firmada…" (doble "Falta" en propuestas observadas);
  "Solo pagos confirmados por una persona" (ambiguo: es "confirmados por una persona
  responsable", no "por una sola persona").
  **Estado: ✔ corregido (2ª pasada).** "Antecedentes pendientes: …" y "Solo pagos con
  confirmación manual" (también en la descripción de cobranza).
- **M10 · Privacidad hub.** Breadcrumb parte en "Prevención /" (sin "Inicio /", único
  caso); página 90% vacía con 2 tarjetas cuyos CTA son texto plano sin affordance.
  **Estado: ✔ corregido (2ª pasada).** Breadcrumb con "Inicio /" y CTAs con flecha;
  las tarjetas ya eran links completos con hover, así que el hallazgo de affordance
  era menor de lo estimado.

## 5. Hallazgos bajos — al tocar el componente

- **B1** PDTP actividades: chips de faena "Administración: 0/1013" crípticos (¿1013 qué?);
  doble expander "Ver programa…" + "Desglose por faena" en cada fila; fila 5 con fondo
  gris parcial (artefacto a verificar, aparece en ambas capturas).
  **Estado: ✔ parcial (2ª pasada).** Chips ahora dicen "0/1013 ejec." con tooltip
  completo. El doble expander y el artefacto de la fila 5 (que **persiste** en la
  tercera captura — no es hover) quedan en §8.
- **B2** Sidebar: "Programa prev…" truncado en el nav (etiqueta más corta o tooltip ya existe).
  **Estado: ✔ corregido (2ª pasada).** Etiqueta → "Programa PDTP" (manifest + test de
  navegación actualizado). Verificado sin truncar.
- **B3** Columna FUENTE repite "Chipax · 05-08-2026" en todas las filas — mostrar solo
  cuando difiere, o mover a tooltip.
  **Estado: ✔ corregido (2ª pasada).** La fecha de última lectura va en tooltip; la
  celda muestra solo el proveedor.
- **B4** Ids de correlación crudos en RESULTADO ("id corr-audit-03") — estilo `code` o tooltip.
  **Estado: ✔ corregido (2ª pasada).** `font-mono` 10px en text-faint (5.17:1, pasa AA)
  con tooltip que explica para qué sirve.
- **B5** Borde de inputs `border-control` = 3.37:1 — pasa el 3:1 de WCAG para bordes,
  sin margen; no bajar más. *(Nota, no acción.)*

## 6. Lo que está bien (no tocar)

- Tokens: todos los pares ink/tint miden 6.9–13.7:1 (AA/AAA).
- Chips de procedencia "Dato del documento / Dato interno / Mixto" en el detalle: idea
  excelente, única en la plataforma.
- Estados vacíos declarados ("la tarjeta lo dice en vez de mostrar un cero que parece
  un hecho") y resúmenes con período/fuente explícitos.
- Tabla de antigüedad de deuda y barra de totales de facturas.

## 7. Plan de ejecución

| Fase | Contenido | Estado |
|------|-----------|--------|
| **0 · Hotfix** | C1, A1 (28 archivos), C2, C3 | **✔ hecho 2026-08-05** |
| **1 · Sprint actual** | A2 (UI), A3, A4, A5, M2, M3 | **✔ hecho 2026-08-05** |
| **2 · Próximo sprint** | M1, M4–M10 + seguimientos C1-bis/A2-bis/A1-bis | **✔ hecho 2026-08-05 (2ª pasada)** |
| **3 · Pulido** | B1a, B2, B3, B4 | **✔ hecho 2026-08-05 (2ª pasada)** |
| **4 · Residuales §8** | M5-resto, B1b, B1c, M8-resto + triage móvil | **✔ hecho 2026-08-05 (3ª pasada)** |
| **5 · Backlog móvil §9** | MV-1, MV-2, MV-3 | **✔ hecho 2026-08-05 (4ª pasada)** |

Verificación de cierre de cada pasada: re-captura de las 15 rutas contra
`bodega_capture`, consola sin errores, `tsc --noEmit` limpio y tests en verde
(fase 0–1: 27 billing; fase 2–3: 73 unit afectados + 27 de integración).

**Seguimientos ya ejecutados en la 2ª pasada:** C1-bis (las 8 copias de
`primaryButtonClass` y los 3 estilos inline ahora usan `buttonVariants()` del
[button.tsx](components/ui/button.tsx) compartido — una sola fuente de verdad),
A2-bis (`truncateSummary` en `sync.ts` agrupa mensajes que solo difieren en números:
"Documento N sin RUT… (y 44 similares)"), A1-bis (regla escrita en AGENTS.md §9 de
Page layout).

## 8. Pendiente tras las dos pasadas del 2026-08-05 — cerrado en la 3ª pasada

Los cuatro residuales se resolvieron el mismo día (evidencia en
`audit/screenshots/2026-08-05-modulos-nuevos-post-fase3/`):

1. **M5-resto — ✔.** Cobranza usa ahora un menú ⋮ por fila (`DropdownMenu` compartido)
   con "Registrar gestión / Registrar pago" dentro; desaparecieron los ~22 links
   apilados. Verificado.
2. **B1b — ✔.** Un solo expander por fila: "Ver programa, responsables y faenas"
   (el desglose por faena entra `bare` al mismo details). Las filas bajaron de ~87px
   a ~62px. Verificado.
3. **B1c — ✔ y diagnosticado.** No era un bug de datos ni de zebra: era el **hover
   asimétrico**. Las celdas sticky (N°, Actividad) tienen fondo sólido que tapaba el
   hover de la fila, y el gris se veía solo de ESTADO a la derecha. Aparecía siempre
   en la fila 5 porque el mouse virtual de Playwright queda donde clickeó "Ingresar"
   en el login — posición determinista, no persistencia real. Fix: `group` en la fila
   + `group-hover` en las sticky; verificado con captura de hover explícito (la fila
   completa se pinta pareja).
4. **M8-resto — ✔ (y la decisión anterior era incorrecta).** El repo YA tenía
   [date-picker.tsx](components/ui/date-picker.tsx) (react-day-picker, es-CL, soporta
   FormData) usado en flota/prevención. Los **9** `<input type="date">` de facturación
   (gestión, compromiso, próxima gestión, pago, servicio desde/hasta, vencimiento,
   inicio/término de contrato) ahora usan `DatePicker`.

## 9. Pasada móvil (390×844) — triage 2026-08-05

Primera evaluación móvil de las 15 rutas (era deuda de alcance declarada). Capturas
`m-*.png` en `…-post-fase3/`. **Lo estructural está sano:** ninguna ruta tiene scroll
horizontal del body, los KPI y formularios apilan bien, la TopBar móvil es correcta.
Backlog nuevo, en orden:

- **MV-1 (medio) · Tablas anchas muestran 2–3 columnas.** Facturas, cobranza y DTE
  cortan la tabla en "EM…"/"VE…": montos y estado quedan tras scroll horizontal
  interno. Opciones: priorizar columnas por viewport (ocultar Fuente/Contrato en
  móvil) o vista de tarjetas bajo `sm:`.
  **Estado: ✔ corregido (4ª pasada).** Priorización de columnas con
  `hidden lg:table-cell`: facturas oculta Emisión/Neto/IVA/Contrato·Faena/Fuente
  bajo `lg` (quedan Documento, Cliente, Vencimiento, Total, Saldo, Estado); cobranza
  oculta Última gestión/Responsable; DTE oculta Emisión (bajo `md`) y
  Vínculo/Discrepancia. El scroll horizontal interno sigue como respaldo.
- **MV-2 (medio) · PDTP actividades: ~2 pantallas de filtros antes del contenido.**
  Los 6 selects + 9 chips de faena + 5 filtros de estado consumen ~1.600px verticales.
  Colapsar tras "Más filtros (N)" como ya hace `/pendientes` (regla A2 de AGENTS.md).
  **Estado: ✔ corregido (4ª pasada).** Los 9 chips de faena van tras un expander
  "Ejecución por faena (9)" en móvil (en escritorio siguen en línea); el contenido
  sube ~700px. Los selects quedan visibles: son el mecanismo de navegación de la
  página, no filtros secundarios.
- **MV-3 (bajo) · Toggle "Vista" desalineado** en PDTP actividades móvil (queda
  huérfano a la derecha bajo los selects).
  **Estado: ✔ corregido (4ª pasada).** Fila propia a ancho completo en móvil
  (`w-full lg:ml-auto lg:w-auto`).

**Verificación 4ª pasada:** typecheck limpio y re-captura móvil de las 4 rutas
(`m-*.png` actualizados en `…-post-fase3/`).

**Fuera de alcance permanente de esta auditoría:** modo oscuro (no existe; los tokens
`-ink` ya lo dejan mejor parado si algún día se agrega).

**Nota técnica para el futuro:** Tailwind v4 escanea también los `.md` del repo en
busca de clases. Escribir en un documento una pseudo-clase de color con un pipe
adentro de los corchetes (por ejemplo "text-", corchete, "var(--color-a", pipe,
"b)", corchete) **rompe el build de CSS** con `Unexpected token Delim`. Pasó dos
veces el 2026-08-05 (AGENTS.md y este mismo documento); la regla es no escribir
clases inventadas entre corchetes en ningún markdown del repo.
