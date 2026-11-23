# Mantención: primera tanda de arreglos de la auditoría del 2026-11-22

Rama `fix/mantencion-auditoria-lote1`, sobre `main` `01aa7e71a`, con 8 commits (de `cd7e43f5d` a `cdf6ff20c`). Sin migraciones ni permisos nuevos.

La auditoría está en `qa/reports/mantencion-auditoria-2026-11-22.md` del checkout principal (sin versionar).

## Decisiones del usuario que rigen

- La plataforma reemplaza a los formularios de Google desde el **01-12-2026**. La fecha es la constante `FORMS_CUTOVER_DATE` en `lib/mantencion/forms-cutover.ts`.
  - El historial de Forms cuenta en el Panel hasta el 30-11-2026.
  - Desde el corte cuentan los registros firmados en la plataforma (sin OT).
  - Las OT cuentan siempre que hayan entrado a taller.
- Tras un traslado, la conformidad de la OT la da la faena de destino y la hoja de vida sigue al equipo. Esto va en la tercera tanda; esta rama no lo toca.

## Qué cambió

| Hallazgo | Cambio | Commit |
|---|---|---|
| OTN-4 / PANN-3 | «Trabajos del período» cuenta sólo las OT que entraron a taller, fechadas por el ingreso. | `f530efe57` |
| PANN-2 | Nueva fuente «registro»: `mant_records` vigentes sin OT desde el corte. El historial cuenta sólo antes del corte. | `f530efe57` |
| PANN-4 / REGN-3 | La cifra mixta ya no enlaza a una lista que no la reproduce. La sección explica el corte. «Historial de formularios →» lleva período y faena. | `f530efe57`, `4061b7f12` |
| PANN-11 / PANN-18 | Hoja «Trabajos» del Excel con fechas y números reales y columna «En taller». Los titulares de días y horas por faena ya no repiten el total. | `f530efe57` |
| PAN-1 | «OT cerradas en el período» y «Tiempo medio de reparación» llevan a `/mantencion/ot?estado=cerrada&cerradaDesde=…&cerradaHasta=…`. | `cb51eec54`, `11d851208` |
| PAN-6 | «Pauta al día» enlaza a las al día. | `cb51eec54` |
| PANN-5 | Con un equipo elegido, los enlaces a OT conservan el equipo. | `cb51eec54` |
| PAN-8 | Selector de faena del Panel: faenas activas del alcance. En Registros, una desactivada con registros visibles aparece al final como «(inactiva)». | `cb51eec54` |
| PANN-1 | El vacío «Todavía no hay equipos» ya no tapa trabajos, hallazgos ni reportes. | `cb51eec54` |
| REGN-1 / REGN-2 | El importador de Forms por pantalla ya no aborta. Lo ya cargado se conserva, y lo dudoso entra con aviso de posible duplicado. Avisa las respuestas del corte en adelante. | `4061b7f12`, `ff2f79380` |
| REGN-7 / REGN-8 | Los textos del importador y de la lista del historial dicen lo que es cada cosa y qué cuenta en el Panel. La columna Faena muestra la faena resuelta. | `4061b7f12` |
| OTN-1 | «Editar solicitud» (por asignar o asignada) y «Corregir clasificación» (jefatura, cualquier estado salvo anulada). Corregir clasificación cubre tipo de acción, especialidades, faena de ejecución y horas hombre tras la salida, con motivo. Se registra como evento `edited` con `scope: "clasificacion"`. | `11d851208` |
| OTN-3 | «Registrar salida» precarga horas y trabajo realizado. | `11d851208` |
| OT-5 | Los ítems de un tipo desmarcado no se guardan. | `11d851208` |
| OTN-16 | Los filtros por fecha de la orden se rotulan «Pedida desde/hasta». | `11d851208` |
| EQ-1 | Los errores que sólo traen mensaje se ven («La ficha cambió…», «faena que no administras», …). | `7b02df347` |
| EQN-1 | Sin lectura inicial, la preventiva declarada se valida contra el primer registro vigente. Antes, «Primero indica la lectura inicial» era un callejón sin salida. | `7b02df347`, `cdf6ff20c` |
| EQN-4 / EQN-6 / EQ-13 | «Lectura inicial» unificado, ayudas correctas y mensajes con fechas y lecturas formateadas. | `7b02df347` |

## Puertas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | OK, tras corregir 2 tipos en pruebas. |
| `npm run lint` | OK |
| `npm run test:fast` | 21.715 pasan y falla 1: `prevencion/inspecciones/plantillas/.../templates-panel.test.tsx`. Pasa sola en la rama y en `main` (76/76): es inestable bajo carga y ajena a esta tanda. |
| `npm run test:pglite` | 5.590 pasan y falla 1: `module-toggles` (rutas `/apps/recientes` y `/apps/visita` de TI). Falla igual en `main` `01aa7e71a`: es deuda previa. |
| Hook de commit (secretos, alias de Drizzle, lint) | OK en cada commit. |
| Migraciones | No hay. |

## E2E

Corrida aislada sobre el worktree de la rama:

- base `bodega_e2e_lote1` en el contenedor `bodega-e2e-postgres` y puerto 3150, con una config temporal sin versionar;
- un worker, build de producción;
- 18 specs que tocan `/mantencion`.

**Resultado: 150 pasan y fallan 3.** Los mismos 3 fallan en `main` `01aa7e71a` (línea base en un worktree desechable, mismo método):

- `legacy-mantenciones-retired` y `mantencion-historico`: sólo `POST /api/apps/visita` abortado (la baliza de TI al navegar).
- `reflow-anchos` (Catálogos PDTP a 1024 px): la TopBar mide 105 px contra 89 px. Es de Prevención y no se tocó.

**Una diferencia investigada:** en la rama, `mantencion-historico` también abortaba un `POST /mantencion/registros/historicos/importar` (2 de 3 repeticiones).

- La traza muestra que la acción responde 200: la carga se hizo y en pantalla dice «2 trabajos guardados».
- Lo que se corta es el refresco que la acción trae en el mismo stream, porque la prueba navega enseguida.
- Se agregó `waitForLoadState("networkidle")` antes de navegar (`ff2f79380`), como ya hace el mismo spec en sus otros pasos.
- Después de eso, 4 de 4 repeticiones sin ese aborto. Sólo queda la baliza de TI, igual que en `main`.

## Navegador

`next dev --webpack` de la rama en :3003 contra `bodega_dev` (400 migraciones, mock de Mantención), como administrador global y como `supervisor_mantencion` de Pacífico. 22 comprobaciones:

- **Panel (noviembre):**
  - «Trabajos del período **20** · 3 del historial · 17 de OT», sin enlace. Antes eran 29: contaba 9 OT por asignar o asignadas sin ingreso.
  - La nota del corte menciona 30-11-2026 y 01-12-2026.
  - «Historial de formularios →» lleva `desde=2026-11-01&hasta=2026-11-22`, y esa lista muestra 3 trabajos con chips del período.
- **OT cerradas:** «OT cerradas en el período 7» lleva a la lista filtrada por cierre, con **7** filas. Antes la lista mostraba las 57 de la historia.
- **«Pauta al día»:** enlaza a `estado=al_dia`.
- **Selector de faena del Panel:**
  - Muestra las 10 faenas activas, incluida Oficina Central, y ninguna desactivada.
  - Antes ofrecía 10 desactivadas, entre ellas «Cholguan», «Fab. Puertas» y «Teno».
- **Filtro de faena en Registros:** las activas más «Servimar (inactiva)», que tiene registros.
- **OT por asignar:**
  - «Más acciones» ofrece «Editar solicitud» (sin «Corregir clasificación»), y el formulario sale precargado.
- **OT cerrada:**
  - Ofrece «Corregir clasificación», que pide motivo y horas hombre.
  - Se ejecutó de punta a punta sobre la OT mock `OT-FDL-0006`: tipo vacío → Preventiva → Correctiva → vacío.
  - En el historial quedan 3 «Clasificación corregida», con «antes → después» y el motivo `QA_`. El tipo de acción quedó como estaba (`NULL`).
- **Ficha de KA-135** (con registros, sin lectura inicial):
  - Al declarar una preventiva con fecha posterior al primer registro, el servidor responde «La fecha de la preventiva no puede ser posterior a la del primer registro del equipo (18-12-2025)».
  - No escribió nada: el `updated_at` del perfil no cambió.
  - El rótulo dice «Lectura inicial (km)».
- **Consola y red:** sin errores de consola ni 5xx, salvo la baliza de TI.

## Riesgos y brechas

- **Excel y PDF:** no se descargaron ni inspeccionaron a mano. La hoja «Trabajos» está cubierta por la prueba de la acción (fecha de Excel `dd-mm-yyyy`).
- **App del mecánico:** sin cambios en esta tanda y sin recorrer.
- **Datos en prod:** prod no tiene registros nativos (al 2026-11-19), así que hasta el 01-12 «Trabajos» se ve igual que antes, salvo por las OT sin ingreso.
- **Después del deploy:** encender «Tipo de acción obligatorio» en `/admin/parametros-operativos` (`ops.mantencion.ot_action_type_required`). Ya existe «Editar solicitud» y «Corregir clasificación» para corregir un error.
- **Accesibilidad, previo y fuera de esta tanda:** el `DatePicker` compartido anuncia «Seleccionar fecha» en vez del rótulo de su campo.
- **Pendiente para la segunda tanda (P1 de la app):** APPN-1, APP-1, APP-2, APP-3, APPN-2 y APPN-3.
- **Pendiente para la tercera tanda (traslado):** la OT y la hoja de vida siguen al equipo, y la conformidad la da la faena de destino.
