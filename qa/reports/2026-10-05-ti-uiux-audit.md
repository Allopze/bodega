# Auditoría UI/UX del módulo TI — 5 de octubre de 2026

**Alcance:** `/ti`, `/ti/activos` (lista y 4 fichas), `/ti/asignaciones`, `/ti/mantenciones`, `/ti/garantias`, `/ti/bajas`, `/ti/tickets` (lista y 3 fichas), `/ti/accesos`, `/ti/licencias`, `/ti/reportes` y el catálogo adyacente `/admin/tipos-activo`. Incluye las hojas y diálogos de cada pantalla y el acta imprimible (solo texto).

**Método:** Impeccable `critique` + `audit`, con cuatro evaluaciones aisladas que no vieron el trabajo de las otras:

- A1, diseño de inventario y ciclo de vida, más la arquitectura de información del módulo;
- A2, diseño de mesa de ayuda, accesos, licencias y reportes;
- B, detector determinista (CLI y overlay inyectado en el navegador);
- C, auditoría técnica: axe, teclado, responsive, rendimiento, tokens y reglas de AGENTS.md.

La síntesis y la verificación final son de la sesión principal.

**Entorno:**

- `next dev` en :3001 contra `bodega_dev`, con Chromium headless de `@playwright/test` y la sesión QA (rol administrador).
- Vistas a 1440×900, 768×1024, 390×844 y 720×450 (equivalente a zoom 200 %); reflow a 320 px y texto al 200 % en 5 rutas.
- Los tiempos son de modo dev, **no de producción**.

**Datos:** el módulo TI estaba vacío en `bodega_dev` (0 activos, 0 tipos, 0 tickets). Antes de auditar se sembró un set `QA_` mediante los servicios reales de `lib/services/ti`, que registran historial y auditoría:

- 3 tipos de activo y 6 activos en 5 estados;
- 2 asignaciones (1 con acuse) y 2 mantenciones;
- 4 tickets (nuevo ×2, en progreso, resuelto);
- 2 licencias, 2 sistemas de acceso con 3 accesos (1 suspendido) y 2 checklists;
- 1 baja y 2 proveedores vinculados.

Leyenda de evidencia: **[V]** verificado en navegador o en ejecución · **[C]** deducido del código · **[D]** detector determinista.

## Resultado

| Medición | Puntaje | Banda |
|---|---|---|
| Diseño, 10 heurísticas de Nielsen | **17/40** | Pobre (12–19) |
| Calidad técnica, 5 dimensiones | **11/20** | Aceptable (10–13) |
| Hallazgos | **63** | P0: 1 · P1: 29 · P2: 24 · P3: 9 |

**Veredicto:** el módulo no está listo para liberarse sin corregir el P0. El P0 completa una corrección de la auditoría del 2026-09-03 (TI-05) que quedó a medias: esa corrección cerró las transiciones manuales *hacia* estados terminales, pero no las de *salida* desde "Dado de baja".

### Heurísticas de Nielsen (consolidado)

| # | Heurística | Pts | Hallazgo clave |
|---|---|---|---|
| 1 | Visibilidad del estado | 2 | Hay toasts y badges, pero la ficha del ticket no dice cuándo vence, un activo dado de baja se ve vivo y "Asignar licencia" falla sin mensaje. |
| 2 | Lenguaje del mundo real | 2 | El vocabulario de custodia es bueno, pero el Historial muestra JSON con IDs internos y enums crudos. |
| 3 | Control y libertad | 2 | Hay reversión y anulación con motivo, pero los formularios se vacían al fallar, "Revocar" se ejecuta sin confirmar y en móvil no existen "Anular" ni "Revertir". |
| 4 | Consistencia | 2 | Tres patrones de filtro, badges con dos tipografías en una misma columna, naranja de pendiente en series que no son pendientes y "Baja" con tres significados. |
| 5 | Prevención de errores | 1 | Se puede revivir un activo dado de baja, el filtro de la matriz invita a sobrescribir accesos reales, "Cerrado" siempre falla y hay valores por defecto riesgosos. |
| 6 | Reconocer antes que recordar | 2 | La devolución no muestra la entrega que dice comparar, el motivo de cada cambio se guarda pero no se muestra y los selectores de activo muestran solo el código. |
| 7 | Flexibilidad y eficiencia | 1 | El orden está roto en 15 de 19 columnas, no se puede ordenar por prioridad ni vencimiento y no hay acciones masivas ni "Asignarme". |
| 8 | Estética y minimalismo | 2 | El lenguaje visual es sereno, pero el tablero tiene 16 bloques, la matriz 114 filas de guiones y Reportes 9 tarjetas iguales. |
| 9 | Recuperación de errores | 1 | Lo escrito se pierde, el error queda detrás del diálogo de confirmación o bajo el campo equivocado, y otros errores no se muestran. |
| 10 | Ayuda y documentación | 2 | Hay buenos textos de ayuda (número de serie, acuse, fotos), pero nada explica prioridades, plazos ni qué transición corresponde. |

Por separado: A1 dio 21/40 en inventario y A2 18/40 en mesa de ayuda. El consolidado baja por los defectos que verificó la auditoría técnica, como el ordenamiento falso y los errores no asociados.

### Calidad técnica

| # | Dimensión | Pts | Hallazgo clave |
|---|---|---|---|
| 1 | Accesibilidad | 2 | axe casi limpio en las páginas. En las pruebas manuales: el foco no vuelve en 10 diálogos, 13 errores de Select no quedan asociados, los gráficos no tienen texto y las leyendas tienen contraste 2,7:1. |
| 2 | Rendimiento | 2 | Recharts se descarga de entrada, ninguna ruta tiene `loading.tsx` (sin prefetch ni skeleton), hay 10 listados sin límite y un N+1 en licencias. |
| 3 | Responsive | 2 | No hay overflow de documento, pero faltan acciones en móvil, la matriz es inutilizable a 390 px y hay 285 objetivos táctiles de menos de 44 px. |
| 4 | Theming | 3 | Cero literales de color y `-ink` bien usado. Fallan la semántica de color en gráficos, las dos tipografías de badge y algunos tamaños fuera de escala. |
| 5 | Integridad de implementación | 2 | El detector da solo 2 verdaderos positivos en TI, pero hay deriva verificada: `Callout` reinventado, `Select` crudo en vez de `OptionSelect`, radios a mano en vez de `SegmentedControl`, un visor de fotos casero y texto que afirma lo que no hay. |

## Veredicto de especificidad de diseño

El módulo está partido en dos. El **fondo** de los flujos de custodia es propio de este dominio, algo que un ITAM genérico no trae:

- acuse registrado por alguien distinto de quien entrega;
- comparación fotográfica entre entrega y devolución;
- accesorios con devolución trazada;
- baja con doble control;
- reversión con motivo y consecuencia explícita;
- "Nunca se almacenan contraseñas";
- plantillas de alta y baja en vocabulario del negocio.

La **composición** que lo envuelve es plantilla de admin intercambiable:

- un tablero de donas y barras por tipo, estado, faena y antigüedad;
- listas de 8 a 10 columnas;
- una ficha cuya primera acción es un formulario genérico de "Cambiar estado";
- una matriz de accesos que repite la antirreferencia nº 1 de PRODUCT.md, "una planilla reproducida celda por celda";
- una grilla de 9 tarjetas de reporte idénticas.

Ninguna pantalla se organiza en torno a lo que el producto promete: **faena, responsable y vencimiento siempre visibles**. El encargado TI no tiene dónde ver "3 actas sin acuse, 1 préstamo vencido, 1 garantía a 15 días en Masisa". El técnico de mesa de ayuda no puede ordenar por urgencia.

**Detector:** el CLI marca solo 2 hallazgos en `app/(app)/ti` (`side-tab`, ambos verdaderos) y ninguno en `/admin/tipos-activo`. El overlay en el navegador dio 184 avisos en 18 cargas. Tras verificación por ablación, casi todos son falsos positivos:

- `nested-cards`: el pozo del shell cuenta como tarjeta;
- `layout-transition`: proviene de sonner;
- `clipped-overflow`: tooltips de Recharts y nodos ocultos;
- `em-dash` y `edge-flush`: son la matriz.

Los verdaderos positivos son un salto de encabezados en `/ti` y tres defectos del shell compartido. Detector y revisión de diseño coinciden en que el problema **no es de tokens ni de estilo superficial**, sino de jerarquía, flujo e integridad de las acciones. Ese es el tipo de defecto que un detector no ve.

## Lo que funciona

1. **El modelo de custodia es auténtico.** El acuse va separado de la entrega, el acta imprimible marca "Pendiente de acuse", hay fotos de entrega y devolución y los accesorios tienen trazabilidad.
2. **Los actos de corrección son trazables.** Anular mantención, revertir baja y desactivar sistema exigen motivo y explican su efecto: "El activo vuelve a Disponible"; "1 trabajador(es) mantienen su acceso activo… NO revoca esos accesos". "Revertir" aparece deshabilitado con su razón accesible por teclado.
3. **La base técnica está sana:**
   - cero literales de color en TI y uso correcto de `-ink`;
   - `PageHeader` + `PageContainer` en las 14 páginas;
   - `DatePicker` y `DateTimePicker` (sin `type="date"`), `formatDate` y `todayInChile()`;
   - `router.replace(…, { scroll:false })` en los filtros y exportación `.xlsx` vía `ExportButton`;
   - `useActionState` y `useOperation` bien elegidos;
   - las 19 hojas atrapan el foco y cierran con Esc;
   - sin overflow de documento;
   - 0 errores de consola y 0 requests fallidos en unas 100 cargas.
4. **Garantías comunica el estado con texto, no solo con color** ("VENCE EN 15 D", "VENCIDA"), y los filtros de tickets tienen chips removibles y una nota de alcance para quien solo ve sus propios tickets.

---

## Hallazgos

### P0 — Bloqueante (integridad y autorización)

**TIUX-01 · Un activo dado de baja vuelve a "Disponible" por el cambio manual de estado, sin pasar por la reversión ni por su permiso** [V]

- **Dónde:** `app/(app)/ti/activos/[id]/asset-status-control.tsx:32` y `lib/services/ti/assets.ts:272-305`.
- **Causa:** el control ofrece `MANUAL_ASSET_STATUSES` (incluye "Disponible") también a un activo dado de baja. El servicio solo bloquea si hay una asignación abierta y no mira si el estado actual es terminal. La acción exige `requireTiManage()`, no `ti:reverse_retirement`, el permiso que `modules/ti/manifest.ts:28-31` separa a propósito porque revertir deshace un acto de doble control.
- **Reproducción (sesión principal, con el activo desechable `QA-NB-099`):** `retireAsset` deja el activo en `dado_de_baja`. Después, `changeAssetStatus({ status: "disponible" })` es **aceptado**: el activo queda en `disponible` y el registro de baja sigue vigente (`reversedAt: null`). A1 confirmó que la UI ofrece la opción en la ficha de QA-NB-003.
- **Impacto:** quien puede gestionar activos deshace bajas autorizadas por un tercero. Inventario y registro de bajas quedan contradictorios.
- **Antecedente:** la auditoría del 2026-09-03 (TI-05) cerró el camino inverso, pero no este.
- **Corrección:**
  - En el servicio, rechazar transiciones manuales desde `dado_de_baja`.
  - Definir explícitamente si salir de `perdido`/`robado` a mano está permitido, porque `IT_RETIRED_STATUSES` los trata como terminales y `MANUAL_ASSET_STATUSES` los ofrece.
  - En la UI, ocultar el control y mostrar "Esta baja se revierte desde Bajas".
  - Agregar una prueba de regresión.
- **Comando:** `harden`.

### P1 — Mayor

#### Integridad de las acciones y prevención de errores

**TIUX-02 · El filtro "Sistema" de la matriz de accesos pinta accesos existentes como "—" e invita a sobrescribirlos** [V + C]
- **Dónde:** `lib/services/ti/access.ts:224-238` filtra los accesos por sistema, pero `access-matrix.tsx` sigue pintando todas las columnas.
- **Evidencia:** con el filtro de un sistema, el acceso real de un trabajador en otro sistema aparece como "—" ("Registrar acceso de … a …"). Al abrirlo, la hoja viene con "Activo" preseleccionado (`a2-mesa-ayuda/int-access-filter-sap-sheet.png`).
- **Impacto:** guardar reactiva un acceso suspendido sin que el usuario lo sepa, y el filtro no responde "¿quién tiene acceso a X?".
- **Corrección:** con un sistema filtrado, mostrar solo esa columna y solo trabajadores con registro, y precargar siempre el estado real.
- **Comando:** `harden`.

**TIUX-03 · El ordenamiento está roto en 15 de 19 columnas ordenables y anuncia un orden falso** [V + C]
- **Dónde:** `components/ui/data-table.tsx:210-223` ordena por `row[col.key]`, pero las claves no existen en la fila:
  - `asset-table.tsx:15-19` usa `name`, `worker`, `worksite` y `type`, mientras la fila trae `typeName`, `workerName` y `worksiteName`;
  - lo mismo pasa en `tickets-table.tsx:52-56`, `assignments-table.tsx:44-46`, `warranty-table.tsx:33-36`, `maintenance-table.tsx:39` y `retirement-table.tsx:44`.
- **Impacto:** el clic solo reordena arbitrariamente y deja `aria-sort="ascending"` (WCAG 4.1.2).
- **Corrección:** usar las claves reales o un `sortValue` por columna, más una prueba de que cada columna `sortable` existe en la fila.
- **Comando:** `harden`.

**TIUX-04 · "Cerrado" se ofrece en el ticket pero no se puede completar** [V + C]
- **Causa:** el campo Resolución solo aparece para "Resuelto" (`ticket-detail.tsx:227`), pero el servidor exige resolución para cerrar (`lib/services/ti/tickets.ts:209-214`).
- **Inconsistencia de mínimos:** el cliente pide 3 caracteres (`lib/validation/ti.ts:245`) y el servidor 10 (`reason-thresholds`), así que "Reinicio" pasa en el cliente y falla en el servidor.
- **Error mal ubicado:** se muestra bajo "Motivo".
- **Impacto:** cerrar un duplicado obliga a inventar una resolución.
- **Corrección:** mostrar Resolución para "Cerrado" si el ticket no la tiene, unificar el mínimo en 10 y anunciarlo en la ayuda.
- **Comando:** `harden`.

**TIUX-05 · Los formularios de ticket borran lo escrito cuando falla la validación o el servidor** [V]
- **Dónde:** `ticket-sheet.tsx:82-87` (Nuevo ticket) y `ticket-detail.tsx:224-230` (Gestionar ticket). Son inputs no controlados en `<form action>`.
- **Evidencia:** `a2-mesa-ayuda/int-newticket-invalid-submit.png` e `int-inc2-resuelto-short.png`.
- **Impacto:** es el peor momento del viaje para quien escribe desde terreno.
- **Corrección:** devolver los valores en `ActionState` y usarlos como `defaultValue`, y revisar las demás hojas.
- **Comando:** `harden`.

**TIUX-06 · "Asignar licencia" sin destino falla en silencio** [V]
- **Dónde:** `license-panel.tsx:171` (el `Field` "Trabajador" no recibe `error`) y `:68-75` (el toast se omite cuando hay `fieldErrors`).
- **Impacto:** sin mensaje, toast ni anuncio; viola WCAG 3.3.1 y la regla "nunca descartar resultados" de AGENTS.md.
- **Comando:** `harden`.

**TIUX-07 · "Cambiar estado" abre la confirmación antes de validar y el error queda escondido detrás** [V]
- **Dónde:** `asset-status-control.tsx:63-82`.
- **Evidencia:** `a1-inventario/desktop-dlg-nb001-status-after-empty.png`.
- **Corrección:** validar antes de abrir, o mover los campos al diálogo, y que el diálogo diga "Asignado → En reparación".
- **Comando:** `harden`.

**TIUX-08 · "Revocar" licencia se ejecuta sin confirmación, con un objetivo de 41×16 px** [C]
- **Dónde:** `license-panel.tsx:135-140`.
- **Corrección:** `ConfirmDialog` con la consecuencia ("Andrés perderá M365; quedarán 10 disponibles").
- **Comando:** `harden`.

**TIUX-09 · Valores por defecto riesgosos en actos de responsabilidad** [V]
- **Dónde:**
  - el acuse preselecciona "El trabajador acusó recibo", con constancia opcional (`acceptance-sheet.tsx:35`);
  - la baja preselecciona el motivo "Venta" (`retirement-sheet.tsx:46`);
  - entrega, devolución y transferencia preseleccionan el estado físico "Bueno".
- **Corrección:** sin valor por defecto, y constancia obligatoria al aceptar.
- **Comando:** `harden`.

**TIUX-10 · En móvil no existen "Editar" ni "Anular" mantención ni "Revertir" baja** [V]
- **Dónde:** las tarjetas de `maintenance-table.tsx:102-117` y `retirement-table.tsx:117-133`.
- **Contexto:** es el mismo patrón que TI-15 corrigió en Asignaciones.
- **Comando:** `adapt`.

#### Flujo, jerarquía y comprensión

**TIUX-11 · La ficha del activo lidera con un formulario permanente de "Cambiar estado" en lugar de la siguiente acción de custodia** [V]
- **Evidencia:**
  - el Select aparece en blanco;
  - para un activo asignado, todas las opciones fallan ("Cierra la asignación abierta…");
  - no hay "Entregar" en un activo disponible;
  - tras una devolución no hay forma de re-entregar desde la ficha (`AssignmentSheet` solo vive en el estado vacío, `asset-assignments.tsx:162-174`);
  - en móvil el formulario aparece antes que "Custodia vigente".
- **Regla:** viola A3.
- **Corrección:** un panel "Siguiente acción" según el estado:
  - disponible → Entregar;
  - asignado → Registrar acuse / Devolver / Transferir;
  - en reparación → Registrar mantención;
  - terminal → banner.

  La corrección manual de estado pasa a un menú.
- **Comando:** `shape`, `distill`.

**TIUX-12 · Un activo dado de baja se ve vivo** [V]
- **Evidencia:** solo muestra un badge gris; "Editar" y "Cambiar estado" siguen activos; motivo y destino solo aparecen en Historial (`a1-inventario/desktop-nb003.png`).
- **Corrección:** banner con fecha, motivo, destino, responsable y autorizante, enlace a la baja y edición deshabilitada.
- **Comando:** `clarify`.

**TIUX-13 · El Historial muestra el modelo de datos** [V]
- **Evidencia:** un `<pre>` con JSON (`"ticketId": "KYNI…"`, `"retirementId": …`), enums crudos (`disponible → en_reparacion`, "Mantención reparacion", "— reciclaje") y fechas ISO. Además usa la fecha de registro en vez de la del evento.
- **Dónde:** `asset-history.tsx:82-88` y `:111`; plantillas en `assets.ts:317`, `maintenance.ts:63,114,169`, `retirements.ts:114`, `tickets.ts:233` y `assignments.ts:320`.
- **Reglas:** antirreferencia de PRODUCT.md y A6. En móvil el `<pre>` además genera `scrollable-region-focusable`.
- **Corrección:** un formateador por acción con labels de `constants.ts`, enlaces a acta, ticket o mantención, y fecha del evento.
- **Comando:** `clarify`.

**TIUX-14 · El encargado TI no puede ver lo pendiente de custodia** [V]
- **Evidencia:**
  - el tablero no muestra actas sin acuse;
  - Asignaciones solo filtra "Todas/Vigentes", sin acuse ni faena;
  - un préstamo no tiene "devolver antes de", así que "vencido" no existe.
- **Corrección:** tile "Actas sin acuse" que lleve a `?acuse=pendiente`, fecha comprometida en préstamos y filtros de faena y acuse.
- **Comando:** `shape`.

**TIUX-15 · El tablero `/ti` es un muro genérico con gráficos defectuosos** [V]
- **Composición:** 4 tiles, 5 cifras, 5 gráficos y 2 tarjetas de navegación. El estado aparece en tile, tira y dona a la vez (A5).
- **Gráficos** (`ti-charts.tsx`):
  - ejes con fracciones ("0,5 equipos"; falta `allowDecimals={false}`);
  - "$100.000" recortado (`:107`);
  - meses como "08/09";
  - el naranja de pendiente pinta "Disponible", "Cantidad" y las barras de antigüedad (`:41,112,146`);
  - los colores de la dona no coinciden con los badges.
- **Corrección:** una lista "Atención hoy" por faena, como máximo 2 gráficos y signal solo para pendientes.
- **Comando:** `distill`, `colorize`.

**TIUX-16 · El vencimiento de los tickets no aparece donde se decide** [V]
- **En la ficha:** no hay vencimiento ni plazo (`TicketDetail` ni recibe `dueAt`, `ticket-detail.tsx:21-44`).
- **En la lista:**
  - se ve el vencimiento de un ticket ya resuelto;
  - "SLA" no tiene tooltip (A6);
  - Prioridad y SLA no son ordenables;
  - el orden por defecto es por creación.
- **Corrección:** "Vence el 07-10 16:43 · en 2 días" en la ficha; columna "Vence" ordenable; orden por urgencia para quien gestiona.
- **Comando:** `clarify`, `layout`.

**TIUX-17 · Reasignar un ticket exige cambiar su estado, y el estado viene preseleccionado de forma arbitraria** [V]
- **Evidencia:** desde "En progreso" el valor por defecto es "Esperando usuario"; desde "Resuelto", "Cerrado" (`ticket-detail.tsx:60`). El motivo es obligatorio para todo.
- **Corrección:** separar "Responsable" (con "Asignarme") de "Cambiar estado", y usar acciones contextuales en vez de un select sin valor neutro.
- **Comando:** `distill`, `shape`.

**TIUX-18 · `/ti/accesos` entierra el trabajo** [V]
- **Evidencia:**
  - los checklists empiezan a unos 6.350 px del tope;
  - la matriz lista 114 trabajadores (todos los activos, tengan o no accesos);
  - la cabecera no es fija;
  - hacen falta 234 tabulaciones para cruzarla;
  - "Nuevo sistema" y "Nuevo checklist" viven dentro de paneles y el `PageHeader` no tiene acciones (regla 5 y A3);
  - los filtros de arriba solo afectan a la matriz.
- **Corrección:** pestañas "Accesos | Altas y bajas | Catálogo", acciones en el `PageHeader` y matriz por defecto solo con trabajadores que tienen registro.
- **Comando:** `layout`, `distill`.

**TIUX-19 · Los checklists de baja no se conectan con lo que dicen revocar** [C + visual]
- **Evidencia:**
  - "Revocar accesos", "Cerrar licencias" y "Recuperar notebook" son casillas sueltas que no listan nada ni cambian nada;
  - responsable y fecha se cargan pero no se pintan (`checklists-panel.tsx:89-125`);
  - la matriz excluye a los inactivos (`access.ts:216`), así que un ex-trabajador con accesos activos es invisible.
- **Corrección:** el checklist lista los accesos, licencias y equipos vigentes de la persona, con acción en línea, más una vista "Accesos activos de trabajadores inactivos".
- **Comando:** `shape`.

**TIUX-20 · La garantía por vencer no se ve en inventario ni en la ficha, y la vencida se indica solo por color** [V]
- **Evidencia:**
  - QA-NB-001 vence en 15 días y se ve igual que una vigente (escudo verde en la ficha);
  - la vencida es solo texto rojo (`asset-table.tsx:60-71`) o un ícono sin texto (`asset-summary.tsx:87-99`).
- **Criterio:** WCAG 1.4.1.
- **Corrección:** reutilizar `warrantyStatus()` de `warranty-table.tsx:22-29`.
- **Comando:** `colorize`.

**TIUX-21 · La faena no aparece en Mantenciones, Garantías y Bajas, ni en las tarjetas móviles de inventario y garantías** [V]
- **Regla:** viola el principio 4 de PRODUCT.md.
- **Comando:** `clarify`.

**TIUX-22 · Tablas que desbordan a 1440 px y dejan acciones fuera de vista** [V]
- **Evidencia:** Asignaciones mide 1190/1126 px ("Ver activo" invisible) y Mantenciones 1154/1126 px ("Anular" recortado).
- **Corrección:** acción principal más un menú "Más".
- **Comando:** `layout`.

**TIUX-23 · La fecha de entrega no se ve en "Nueva entrega" en escritorio** [V]
- **Evidencia:** el `DateTimePicker` en un tercio de columna queda como una caja de unos 30 px con solo el ícono (`assignment-sheet.tsx:244-259`, `a1-inventario/desktop-dlg-assign-new.png`).
- **Comando:** `layout`.

#### Accesibilidad (WCAG 2.2 AA y PRODUCT.md)

**TIUX-24 · El foco no vuelve al disparador al cerrar 10 diálogos u hojas** [V]
- **Criterio:** WCAG 2.4.3.
- **Dónde:** hojas con estado `open` controlado y sin Trigger en licencias, matriz, sistemas, checklists y proveedores; además el `ConfirmDialog` de estado, anular mantención, revertir baja, tipos de activo y el `FilterToolbar` **compartido** ("Más filtros").
- **Corrección:** en la capa compartida, recordar `document.activeElement` y restaurarlo en `onCloseAutoFocus`.
- **Comando:** `harden`.

**TIUX-25 · Los errores de campos `Select` no se asocian al control** [V]
- **Criterio:** WCAG 1.3.1, 3.3.1 y 4.1.2.
- **Alcance:** 17 casos en código, 13 verificados en 7 formularios.
- **Causa:** `<Select>` de Radix crudo dentro de `Field error=` no recibe `aria-invalid` ni `aria-describedby`.
- **Corrección:** usar `OptionSelect` (`components/ui/option-select.tsx:74-103`), que sí los reenvía, o hacer que `Select` los propague.
- **Comando:** `harden`.

**TIUX-26 · Los gráficos no tienen alternativa textual y sus leyendas no cumplen contraste** [V]
- **Criterio:** WCAG 1.1.1, 4.1.2 y 1.4.3.
- **Evidencia:**
  - 3 SVG con `role=application tabindex=0` sin nombre, más el grupo del Pie: 6 paradas de tabulación mudas;
  - leyendas en `--color-signal`, con 2,7:1, y en teal, con 3,7:1, a 11 px (`ti-charts.tsx:45,110`).
- **Comando:** `harden`, `colorize`.

**TIUX-27 · La matriz de accesos no se puede usar con lector de pantalla ni teclado** [V]
- **Criterio:** WCAG 4.1.2, 2.4.7 y 1.4.11.
- **Evidencia:**
  - las celdas se anuncian como "activo" (enum crudo en `title`), sin trabajador ni sistema (`access-matrix.tsx:88-98`);
  - los radios de estado no tienen foco visible ni `fieldset`, y el borde mide 1,3:1 (`:171-179`).
- **Corrección:** `aria-label` completo, roving tabindex, y `SegmentedControl` o `ChoiceCardGroup`.
- **Comando:** `harden`.

**TIUX-28 · axe marca violaciones critical y serious en la ficha y las hojas** [V]
- **Evidencia:**
  - `dlitem`: `dt`/`dd` sin `dl` (`asset-summary.tsx:77,84` y `asset-assignments.tsx:214`), con 22 nodos por vista;
  - `button-name`: el selector móvil de pestañas no tiene nombre (`asset-detail-tabs.tsx:51-62`);
  - en "Nueva entrega" y "Devolución", el botón "+" de accesorio no tiene nombre y el input de archivo `sr-only` es enfocable, duplica la parada y desplaza el diálogo 52 px (`assignment-sheet.tsx:298,326-330` y `return-sheet.tsx:234-237`).
- **Comando:** `harden`.

**TIUX-29 · El reflow falla en la ficha de ticket a 320 px y con texto al 200 %** [V]
- **Criterio:** WCAG 1.4.10 y 1.4.4.
- **Evidencia:** las tarjetas se recortan, los badges no envuelven y el código se parte en "INC-/2026-/0001". El `aside` fijo de 360 px se recorta 31 px (`ticket-detail.tsx:95,99`).
- **Comando:** `adapt`.

**TIUX-30 · 285 objetivos táctiles de menos de 44 px a 390 px (261 de menos de 24 px)** [V]
- **Criterio:** PRODUCT.md exige 44 px; WCAG 2.5.8.
- **Principales casos:**
  - 225 "—" de la matriz (13×19);
  - toggles de checklist de 16×16;
  - pastillas de estado de 24 px de alto;
  - "Revocar" de 41×16;
  - "Ver activo" y "Ver acta" de 16–19 px de alto;
  - "Nota interna" de 14×14;
  - cerrar `ConfirmDialog` de 28×28.
- **Comando:** `adapt`.

### P2 — Menor

**TIUX-31 · El solicitante no recibe avisos de su ticket** [C]
- **Dónde:** `tickets/actions.ts:65-188`.
- **Evidencia:** comentar y pasar a "Esperando usuario" no notifican. El toast de creación no trae código ni plazo y no lleva a la ficha, aunque la acción devuelve `ticketId` (`ticket-sheet.tsx:53-54`).
- **Comando:** `clarify`.

**TIUX-32 · Reportes solo cubre inventario** [V]
- **Evidencia:** las 9 tarjetas son de activos (`reportes/page.tsx:14-24`). No hay reportes de tickets con vencimiento, uso de licencias, matriz de accesos ni checklists, y ninguno filtra por faena o período.
- **Comando:** `shape`.

**TIUX-33 · Las filas anuladas o revertidas con `opacity-70` caen a 3,1–3,95:1** [simulado; sin datos anulados]
- **Dónde:** `maintenance-table.tsx:63`, `retirement-table.tsx:64` y `asset-maintenance.tsx:81`.
- **Corrección:** atenuar con token, `line-through` y badge, sin opacidad.
- **Comando:** `colorize`.

**TIUX-34 · "Quitar fotografía" es invisible incluso con foco** [C]
- **Dónde:** `assignment-sheet.tsx:351-358` y `return-sheet.tsx:253-259`: usa `opacity-0 group-hover:opacity-100` sin `focus-visible`, con un objetivo de unos 19 px.
- **Comando:** `harden`.

**TIUX-35 · El buscador del TopBar se ve pero no filtra nada** [V]
- **Dónde:** `/ti`, `/ti/licencias`, `/ti/reportes` y las dos fichas.
- **Además:** está oculto en móvil (<640 px), así que el inventario no tiene búsqueda de texto en el teléfono.
- **Comando:** `distill`.

**TIUX-36 · Doble estado vacío contradictorio en `/ti/activos`** [V]
- **Evidencia:**
  - con filtros sin resultados aparecen a la vez "Sin activos registrados · Crea el primer activo" y "No hay activos con estos filtros" (`page.tsx:92-100` y `asset-table.tsx:100-101`);
  - "Limpiar filtros" solo lo ve quien gestiona;
  - las bajas se ocultan sin aviso y no hay total de resultados.
- **Comando:** `clarify`.

**TIUX-37 · Las columnas principales quedan estranguladas** [V]
- **Evidencia:**
  - "Activo" parte marca, modelo y serie en 3 o 4 líneas;
  - "Asunto" de tickets mide unos 80 px y se corta en 4 líneas;
  - los códigos se parten ("INC-2026-/0004", "QA-/CEL-/001" a 768 px);
  - solo el código es enlace.
- **Comando:** `layout`.

**TIUX-38 · La semántica de color y estado es inconsistente** [V]
- **Evidencia:**
  - "Asignado", "Normal" y "Baja" van en sans y "DISPONIBLE" o "CRÍTICA" en mono mayúscula dentro de la misma columna;
  - success y primary son el mismo verde, así que "Disponible" y "En préstamo" se ven iguales;
  - los pendientes reales ("Sin acuse aún", "Vence en 15 d") no usan signal, pero las notas internas sí (`ticket-detail.tsx:128`);
  - el tipo de mantención se pinta como warning.
- **Dónde:** `constants.ts:13-20,69-80`.
- **Comando:** `colorize`, `typeset`.

**TIUX-39 · Los filtros son inconsistentes entre pantallas hermanas** [V]
- **Evidencia:**
  - hay tres patrones: `FilterToolbar`, pastillas y nada;
  - Garantías tiene 6 pastillas con ventanas solapadas (30 ⊂ 60 ⊂ 90), sin contadores;
  - Mantenciones y Bajas no tienen filtros;
  - "Todas/Vigentes" es `<Link>` sin `scroll={false}` y no expone cuál está activa;
  - tickets y garantías usan `aria-current="page"` en un filtro;
  - tickets muestra 9 pastillas, 5 de ellas en cero.
- **Comando:** `distill`, `layout`.

**TIUX-40 · La ficha de ticket repite datos y oculta la historia** [V + C]
- **Evidencia:** el código aparece 3 veces y el asunto 2. El motivo de cada cambio de estado se guarda pero no hay línea de tiempo.
- **Comando:** `distill`.

**TIUX-41 · Las licencias no comunican urgencia ni responsable** [V]
- **Evidencia:**
  - "renueva 20-10-2026" en texto plano, a 15 días;
  - el responsable se carga pero no se pinta;
  - el costo no dice si es por período;
  - las asignaciones revocadas se acumulan y no muestran faena;
  - 25 cupos ociosos de ESET no generan ninguna señal.
- **Comando:** `clarify`.

**TIUX-42 · Fricción en "Nuevo ticket"** [V]
- **Evidencia:**
  - la faena no viene precargada aunque el TopBar ya la indica;
  - "Trabajador afectado" son 115 opciones sin búsqueda;
  - la prioridad se elige sin explicar qué plazo implica;
  - el texto habla a un intermediario.
- **Comando:** `onboard`, `clarify`.

**TIUX-43 · Mensajes de error duplicados, mal ubicados o con enums** [V]
- **Evidencia:**
  - el mismo error sale como toast y como alerta inline;
  - "…para dejar el ticket en 'asignado'" aparece bajo "Motivo" y no bajo "Técnico";
  - "Tipo de checklist no reconocido" o "Categoría no reconocida" aparecen cuando el Select simplemente quedó vacío;
  - tras un envío fallido el foco cae en el contenedor y no en el campo inválido.
- **Comando:** `clarify`.

**TIUX-44 · En móvil se pierde información crítica** [V]
- **Evidencia:** la tarjeta de ticket no muestra prioridad, vencimiento ni técnico. La columna fija de la matriz ocupa cerca del 80 % del ancho y no hay vista por trabajador.
- **Comando:** `adapt`.

**TIUX-45 · La arquitectura de información del módulo es plana y con nombres que no coinciden** [V + C]
- **Evidencia:**
  - el sidebar tiene 10 ítems planos;
  - los nombres de navegación no coinciden con los títulos: "Dashboard TI" vs "TI", "Tickets" vs "Mesa de ayuda", "Mantenciones" vs "Mantenciones y reparaciones";
  - "Reportes" aparece como área global y como ítem de TI;
  - "Tipos de activo TI" vive solo en Administración, sin enlace desde TI;
  - "Soporte" compite con la mesa de ayuda TI, que tiene la categoría "Plataforma CHOME";
  - la tabla de áreas de DESIGN.md no incluye TI.
- **Comando:** `distill`, `clarify`.

**TIUX-46 · Choques de vocabulario** [V]
- **Evidencia:** "Baja" es tipo de checklist, estado de acceso y "Dado de baja". "Asignación", "entrega", "custodia" y "acta" nombran lo mismo según la pantalla.
- **Comando:** `clarify`.

**TIUX-47 · "Dar de baja" no muestra contexto y manda señales cruzadas** [V]
- **Evidencia:**
  - solo existe en `/ti/bajas`, no en la ficha;
  - el activo se elige por código, sin marca ni custodio;
  - no avisa que cierra la custodia;
  - el CTA es rojo y el botón final verde (`retirement-sheet.tsx:37,146`);
  - la lista no muestra "Autorizado por", así que el doble control no se ve.
- **Comando:** `shape`.

**TIUX-48 · Transferencia y devolución sin contexto de referencia** [V + C]
- **Transferencia:**
  - "Nuevo custodio" sale sin ordenar (`[id]/page.tsx:72-73`) y sin filtrar por faena;
  - el label "Fecha y hora de entrega anterior" no describe el término de la custodia;
  - no permite fotos (`transfer-sheet.tsx:61`).
- **Devolución:**
  - no muestra el estado ni las fotos de la entrega que dice comparar;
  - no ofrece "En reparación" como destino.
- **Comando:** `shape`.

**TIUX-49 · "Custodia vigente" afirma "con evidencia fotográfica" como texto fijo** [V]
- **Dónde:** `asset-summary.tsx:136`.
- **Evidencia:** lo dice aunque no haya fotos, y no muestra acuse ni fecha de entrega.
- **Comando:** `clarify`.

**TIUX-50 · Sin tipos de activo, el select del alta queda vacío sin explicación ni enlace al catálogo** [C]
- **Dónde:** `asset-form-sheet.tsx:87-91`.
- **Contexto:** con datos sembrados no se reproduce, pero es el primer uso real del módulo.
- **Comando:** `onboard`.

**TIUX-51 · El visor de fotos es un `div role=dialog` casero** [C]
- **Dónde:** `asset-assignments.tsx:71-87`.
- **Evidencia:** no tiene foco inicial, trampa, Esc ni retorno de foco.
- **Corrección:** usar `Dialog`.
- **Comando:** `harden`.

**TIUX-52 · Rendimiento** [V + C]
- **Evidencia:**
  - Recharts se descarga de entrada: el `dynamic()` de `ti-charts.tsx:167` envuelve un componente ya importado (unos 900 KB en dev y una tarea larga de 307 ms);
  - ninguna ruta `/ti/**` tiene `loading.tsx`, así que sin `cacheComponents` las rutas dinámicas no se prefetchan ni muestran skeleton;
  - 10 listados no tienen límite y paginan en el cliente, con subconsultas correlacionadas por fila;
  - hay un N+1 en `licencias/page.tsx:43-48`;
  - la matriz crece O(trabajadores × sistemas), con 1.410 nodos con datos mínimos.
- **Comando:** `optimize`.

**TIUX-53 · `Callout` reinventado con acento lateral** [D]
- **Dónde:** `asset-history.tsx:101` y `ticket-detail.tsx:112`: `rounded-xl border-l-2` sin `role`. Corresponde `<Callout tone="danger|success">`.
- **Comando:** `polish`.

**TIUX-54 · Defectos del shell compartido visibles en todo TI** [D, verificado]
- **Evidencia:**
  - contadores de 9–10 px (`nav-rows.tsx:13` y `notification-bell.tsx:39,75`);
  - `animate-ping` infinito en la campana (`notification-bell.tsx:42`) que ignora `prefers-reduced-motion` y tapa el contador.
- **Comando:** `harden`.

### P3 — Pulido

- **TIUX-55** "Asignado a" aparece vacío en vez de "—": `trim(concat(null,' ',null))` devuelve `''` (`assets.ts:407,452`). `polish`.
- **TIUX-56** Duplicaciones en la ficha del activo:
  - título y modelo repetidos;
  - "Ciclo de vida" repite las pestañas;
  - las métricas de mantención aparecen dos veces;
  - el ícono es siempre Laptop.

  `distill`.
- **TIUX-57** Copy y abreviaturas:
  - concordancia: "1 asignados", "1 activos";
  - abreviaturas sin tooltip: "VENCE EN 15 D", "Mant.", "SO", "SLA";
  - botón "Acuse" como sustantivo;
  - errata "Vínculalos";
  - nombre accesible "Más filtros1".

  `clarify`.
- **TIUX-58** El chip "Tu faena: Oficina Central" aparece sobre listas que mezclan faenas, y el acta impresa siempre ofrece "Volver a asignaciones". `polish`.
- **TIUX-59** Saltos de encabezado h1→h3 en `/ti` (`ti-charts.tsx:25`) y en Historial (`asset-history.tsx:61`). `typeset`.
- **TIUX-60** Tipografía:
  - `text-[10px]` y `text-[11px]` fuera de escala;
  - Costo, "Mant." y Tickets sin `font-mono tabular-nums` (`asset-table.tsx:72-80`);
  - fechas con y sin hora mezcladas en la ficha de ticket.

  `typeset`.
- **TIUX-61** Desvíos menores:
  - overlays `bg-black/80` (`asset-assignments.tsx:71-82`);
  - SVG inline en vez de Phosphor (`asset-summary.tsx:174-189`);
  - costo sin `formatCLP` (`void-maintenance-dialog.tsx:81`);
  - barra de progreso del checklist sin `role`;
  - "Nota interna" como checkbox nativo de 14 px;
  - "Tipo" de licencia como texto libre;
  - filtros avanzados del inventario sin chips removibles (A2).

  `polish`.
- **TIUX-62** Rendimiento menor:
  - cascadas evitables (`activos/[id]/page.tsx`, `accesos/page.tsx`);
  - catálogos cargados para usuarios de solo lectura;
  - miniaturas que descargan la foto original.

  `optimize`.
- **TIUX-63** Mantenciones: el ranking de "candidatos a reemplazo" usa costo absoluto, sin relación con el valor del equipo, y no hay filtros por tipo, fecha ni activo. `shape`.

---

## Patrones sistémicos

| Patrón | Instancias |
|---|---|
| Hoja o diálogo controlado sin Trigger: el foco no regresa | 10 (incluye `FilterToolbar` compartido) |
| `Select` crudo dentro de `Field error=`: error no asociado | 17 en código, 13 verificados |
| Clave de columna distinta del campo de la fila: orden falso | 15 de 19 columnas, en 6 tablas |
| Objetivos táctiles de menos de 44 px en móvil | 285 en 10 rutas |
| Tarjetas móviles que pierden acciones o datos críticos | 4 tablas y la matriz |
| Enums, IDs o fechas ISO visibles | 9 plantillas de historial, el `<pre>` JSON, `title="activo"` y mensajes de error |
| El dato se carga pero no se pinta (responsable, autorizante, motivo, vencimiento) | licencias, checklists, bajas, ficha de ticket |
| Listados sin límite y con paginación en el cliente | 10 funciones de servicio |
| Rutas TI sin `loading.tsx` | 12 de 12 |
| Buscador del TopBar sin efecto | 5 rutas |

## Alertas por persona

- **Encargado/a TI de oficina central:**
  - no ve actas sin acuse ni préstamos vencidos;
  - la garantía a 15 días no se marca;
  - Mantenciones, Garantías y Bajas no muestran faena;
  - puede revivir sin querer un activo dado de baja.
- **Técnico de mesa de ayuda (Alex):**
  - no puede ordenar por prioridad ni vencimiento, y el orden de las demás columnas es falso;
  - reasignar le exige cambiar estado y escribir motivo;
  - no tiene "Asignarme", "Sin asignar" ni acciones masivas;
  - pasa 9 pastillas y 4 botones de orden antes del primer ticket.
- **Lector de pantalla o teclado (Sam):**
  - pierde el foco al cerrar 10 diálogos;
  - no oye los errores de los Select;
  - escucha la matriz como "activo, activo…";
  - los gráficos son 6 paradas mudas;
  - el JSON del historial se lee completo.
- **Usuario de faena en móvil (Casey):**
  - pastillas de 24 px y celdas de 13×19;
  - elige faena y trabajador entre 115 sin búsqueda;
  - la validación le borra lo escrito;
  - no recibe aviso cuando TI le pide información;
  - no tiene búsqueda de texto en el teléfono.
- **Jefatura de faena:**
  - no tiene exportación de tickets, vencimientos ni accesos;
  - no ve a los ex-trabajadores que conservan accesos;
  - los checklists no tienen dueño ni fecha;
  - solo se entera de un atraso por un badge a menos de 24 h.

## Preguntas para decidir

1. Si el encargado TI solo pudiera mirar una cosa al llegar, ¿sería una dona de estados o "3 actas sin acuse, 1 préstamo vencido, 1 garantía a 15 días en Masisa"?
2. ¿Qué caso real justifica un formulario libre de cambio de estado junto a una baja con doble control? Si es solo "Perdido" o "Robado" sin custodia, ¿no debería ser una acción explícita con ese nombre?
3. ¿El acuse es una firma del trabajador o una casilla que llena TI? Si es lo segundo, ¿qué evidencia mínima debe exigirse para que valga?
4. ¿Deben convivir "Soporte" y "Tickets TI", o el usuario debería tener una sola puerta para "algo no funciona"?

## Cobertura y brechas

**Recorrido:**
- las 14 rutas a 1440, 768, 390 y 720 px;
- 19 hojas y diálogos con axe, trampa de foco, Esc y retorno de foco;
- 10 envíos vacíos o inválidos;
- teclado en inventario, tickets y accesos;
- reflow a 320 px y texto al 200 %;
- detector CLI y overlay en 9 rutas × 2 viewports;
- 1 exportación `.xlsx` (Garantías).

**No cubierto:**
- roles con alcance de faena o sin permiso de gestión (solo había sesión de administrador);
- lector de pantalla real (la semántica se dedujo de DOM y axe);
- build de producción y Lighthouse (los tiempos son de dev);
- envíos exitosos de altas, revocaciones, anulaciones y reversiones (no se mutó salvo lo indicado abajo);
- visor de fotos, filas anuladas, estado "Vencido" real y listas largas o con textos extensos (no había datos);
- en el overlay del detector: `/ti/bajas`, `/ti/mantenciones`, `/ti/garantias` y estados de hover y foco.

**Datos que dejó la auditoría en `bodega_dev`:**
- el set `QA_` sembrado;
- un comentario "QA_ comentario de auditoría de diseño" en INC-2026-0001;
- dos entradas de auditoría por marcar y desmarcar una tarea de checklist;
- el activo **`QA-NB-099` en estado inconsistente** (disponible con baja vigente), que es la reproducción del P0.

## Evidencia

Carpeta `qa/reports/evidence/2026-10-05-ti-uiux-audit/` (ignorada por git):

- `a1-inventario/` y `a2-mesa-ayuda/`: capturas de rutas, hojas y diálogos en escritorio, móvil y zoom, más logs;
- `b-detector/`: JSON del CLI, hallazgos por página y viewport, ablaciones y capturas limpias y con overlay;
- `c-tecnica/`: barridos axe por viewport, hojas, teclado, escala de texto, métricas y 145 capturas.
