# Mantención: auditoría de lógica y UI/UX (2026-11-22)

Auditoría de **sólo lectura** del submódulo de Mantención de Control operacional sobre `main` `01aa7e71a`:

- la jefatura en `/mantencion/*`;
- la pestaña Mantención de la ficha `/flota/[id]/mantencion`;
- los impresos `/mantencion/informe` y los PDF de OT y registro;
- la app del mecánico `/m/mantencion` y su sincronización.

**No se cambió código.** Este informe parte de la auditoría del 2026-11-16 (`mantencion-auditoria-2026-11-16.md`, sobre `8725e74a9`), revisa qué se corrigió desde entonces y audita lo nuevo:

- Trinorma: Panel con el historial, importador del consolidado y tipo de acción, especialidades y horas hombre en la OT;
- preventiva declarada (migración 0399);
- OT sin costo;
- contratos por faena y faena sólo por traslado.

## Método

- **Código:** cinco líneas de lectura en paralelo, con trazado de llamadas:
  - OT;
  - registros e historial;
  - equipos, pautas y preventiva declarada;
  - app del mecánico;
  - Panel, permisos y navegación.
- **Verificación propia:** releí en el código los hallazgos de mayor peso: OTN-1, OTN-7, EQ-1, EQN-1, EQN-2, APPN-1 y REGN-1.
- **Navegador:** `next dev` en :3002 contra `bodega_dev`.
  - La base estaba en 397 migraciones. La llevé a 400/400 con `npm run db:migrate` y corrí `db:sync-rbac`, con respaldo previo en `~/backups-dev/bodega_dev-pre-0397-0399-20261122-1946.dump`.
  - Datos mock: 123 equipos, 843 registros, 78 OT en los 7 estados, 154 filas de historial y 3 pautas.
- **Rutas y perfiles:**
  - 30 rutas en escritorio (1440×900) y en móvil (390×844).
  - En cada una se midió: estado, `h1`, overflow, consola, red y axe WCAG 2.1 A/AA (en escritorio), con capturas.
  - Como **administrador global**, y además como **supervisor de mantención** y **administrador de contrato**, ambos acotados a Pacífico (15 rutas cada uno).
  - A los dos usuarios QA `qa_*_4a@example.invalid` de `bodega_dev` les copié el hash de la clave del usuario QA para poder entrar.
- **Sondas dirigidas:** enlaces de las cifras del Panel, opciones del selector de faena, búsqueda en Registros y conteos por SQL de solo lectura.
- **Verificación de cada hallazgo:**
  - **Navegador:** reproducido en :3002.
  - **Lectura ✓:** trazado y releído por mí.
  - **Lectura:** trazado por la línea de código.
  - **Sospecha:** falta reproducirlo; se dice cómo.

## Resumen

| Severidad | Nuevos | Previos que siguen abiertos |
|---|---|---|
| P0 | 0 | 0 |
| P1 | 4 | 5 (APP-1, APP-2, APP-3, OT-1, EQ-1) |
| P2 | ~30 | ~35 |
| P3 | ~45 | ~55 |

**Casi nada de la auditoría del 2026-11-16 se corrigió.** Corregidos:

- OT-4, PAN-3 y PER-4: la OT ya no lleva costo (`c3ac26aa3`, columna borrada en 0394);
- REG-17: horas en pasos de 0,5;
- REG-21b: el correo del historial está oculto (`d630ec7de`);
- PAN-7: «OT abiertas» ya no se repite;
- UI-12, sólo en el Panel;
- UI-13, a medias: ver PANN-18.

Todo lo demás sigue, incluidos los **cinco P1**.

Lo más importante:

1. **El Panel que verá la auditoría Trinorma cuenta como «trabajos» OT que nunca entraron a taller.** En noviembre son 9 de 26, y son exactamente los «9 sin fechas» de «Días en taller». Además su cifra enlaza a una lista que no la reproduce (OTN-4/PANN-3, PANN-4).
2. **La clasificación de una OT no se puede corregir.** Tipo de acción, especialidades y faena de ejecución alimentan el Panel Trinorma, y «Editar solicitud» existe en el servidor pero no tiene pantalla (OTN-1). Además, sin tipo elegido, la casilla «Reparación» que viene marcada hace que la OT cuente como correctiva (OTN-7).
3. **App del mecánico:**
   - Un registro anulado por jefatura sigue contando en el teléfono durante 48 h. Eso bloquea, justo en el flujo de «Crear registro corregido», la lectura corregida (APPN-1).
   - Siguen abiertos APP-1, APP-2 y APP-3.
4. **Equipos:**
   - Los errores de «Editar mantención» siguen invisibles (EQ-1). Ahora eso incluye el aviso de edición concurrente nuevo («La ficha cambió mientras la editabas»).
   - La preventiva declarada no se puede cargar en un equipo con registros y sin lectura inicial (EQN-1; en `bodega_dev` son 103 equipos).
5. **El importador del historial desde la pantalla queda inutilizable** apenas se cargó el consolidado: cualquier exportación de Forms que repita esas respuestas aborta entera (REGN-1).
6. **Confirmados en navegador:**
   - PAN-1, PAN-6 y PAN-8 en el Panel;
   - REG-7 y REG-15 en Registros;
   - PER-1 y EQ-18 en Incorporar;
   - UI-1, UI-2, UI-3 y UI-8 en OT;
   - PER-7 y REG-23 en la ficha, como supervisor;
   - PAN-5 como administrador de contrato.

---

## P1

### OTN-1 · Hallazgo funcional: «Editar solicitud» no tiene pantalla, así que la clasificación de la OT no se corrige
- **Dónde:**
  - `app/(app)/mantencion/ot/[id]/actions.ts:67`: `editWorkOrderAction` no tiene ningún llamador. Lo verifiqué con grep en `app/` y `components/`.
  - `transitions.ts:537-578`: `editWorkOrderRequest`.
  - `query.ts:448`: `canEditRequest` se calcula, pero la ficha no lo usa.
- **Escenario:** una OT nace con el tipo de acción, las especialidades o la faena de ejecución equivocados. La OT derivada de un hallazgo nace «correctiva» fija (`create.ts:214`, cuyo comentario dice «editable después»). No hay forma de corregirla. Antes del taller sólo queda anularla y crearla de nuevo; desde «En taller», nada. Esa clasificación alimenta el Panel, el PDF y el Excel que verá la auditoría del 01-12.
- **Arreglo:** «Editar solicitud» en «Más acciones» cuando `canEditRequest`, reusando el formulario de «Nueva orden».
- **Verificación:** lectura ✓.

### APPN-1 · Bug de producto: un registro enviado y luego anulado sigue contando en el teléfono 48 h
- **Dónde:**
  - `lib/mantencion/client/fleet-view.ts:59-61`: `localRecords` sólo excluye `rejected`.
  - `fleet-view.ts:89-96`: `buildRow` suma la lectura y la preventiva de cada ítem local, incluidos los ya enviados.
  - `queue.ts:16`: `SENT_RETENTION_MS` de 48 h.
  - `ot-model.ts:126-135`.
- **Escenario:**
  1. El mecánico firma 250.000 km en vez de 25.000.
  2. Jefatura lo anula y usa «Crear registro corregido», que abre la app en el mismo teléfono.
  3. La lectura correcta choca con `checkReading` contra el folio anulado, aunque el servidor la aceptaría.
  4. Mientras tanto, el equipo se ve «al día» cuando el servidor dice «vencida», y `canFinish` de una OT cuenta el registro anulado.
- **Arreglo:** ignorar los ítems enviados que el catálogo ya refleja (`sentAt <= catalog.generatedAt`, la regla de `ot-model.appliesOver`) o que `myRecords` marca como anulados.
- **Verificación:** lectura ✓.

### REGN-1 · Bug de producto: el importador del historial desde la pantalla aborta con cualquier exportación de Forms posterior al consolidado
- **Dónde:**
  - `lib/services/mantencion/historical-import.ts:58-59`: aborta si la misma `sourceKey` llega con otro `fingerprint`.
  - Los dos importadores calculan el fingerprint como `hash(JSON.stringify(fields))`, pero con estructuras de campos distintas: `historical-workbook.ts:109` frente a `consolidated-workbook.ts:387`.
- **Escenario:** el consolidado insertó 2.202 filas con la misma `sourceKey` que tendría el formulario (`google-forms + hora + correo`), pero con el fingerprint de sus propios campos. Una exportación de Forms trae siempre todo el histórico. Al subirla, la carga completa se rechaza con «la respuesta ya fue importada con contenido diferente», aunque el archivo esté bien. La prueba `trinorma-consolidado-pglite.test.ts:372` sólo compara claves.
- **Arreglo:** misma `sourceKey` con otro fingerprint = «ya cargada»: completar vínculos e informar la diferencia, como hace el consolidado.
- **Verificación:** lectura ✓ (la lógica de aborto). Que los fingerprints difieran se deduce de las estructuras; confirmarlo con una prueba PGlite: cargar el consolidado de fixture y luego el workbook de Forms.

### EQ-1 (previo, agravado) · Los errores de «Editar mantención» y «Nuevo equipo» que sólo traen mensaje no se ven
- **Dónde:**
  - `app/(app)/mantencion/equipos/actions.ts:74-78`: `toState` siempre devuelve `fieldErrors` (también `{}`).
  - `equipment-plan-form.tsx:70` y `equipment-form.tsx:67`: el `Callout` exige `!state.fieldErrors`.
- **Ahora también se esconden:**
  - el control de concurrencia nuevo, «La ficha cambió mientras la editabas» (`equipment.ts:384-386`);
  - «faena que no administras»;
  - «Ese equipo no existe».
- **Efecto:** se pulsa «Guardar» y no pasa nada.
- **Arreglo:** `fieldErrors: undefined` si está vacío.
- **Verificación:** lectura ✓.

### P1 previos que siguen igual
- **APP-1:** «Fresco» se mide con el reloj del teléfono (`mant-app.tsx:31,64`). Un 5xx también cae en «Necesitas señal» (`bootstrap.ts:94`).
- **APP-2:** al cambiar de equipo se conservan las fotos con el sello del anterior (`flow.ts:135-139`).
- **APP-3:** un registro queda sin salida si se desactiva un conductor, aceite o ejecutor ya elegido (`trabajo-parts.tsx:14`, `flow-validate.ts:141-143`).
- **OT-1:** anular una OT nacida de un hallazgo deja la CAPA trabada (`transitions.ts:479-496`, `runs.ts:879`).

---

## P2

### Panel (lo que verá la auditoría Trinorma)

| ID | Hallazgo | Dónde | Arreglo | Verif. |
|---|---|---|---|---|
| OTN-4 = PANN-3 | **«Trabajos del período» cuenta OT que no se han trabajado.** Entra todo menos `anulada`, fechado por ingreso o, si falta, por solicitud. En noviembre: 26 «de OT», de las cuales 4 están por asignar y 5 asignadas, sin ingreso. Son los «9 sin ellas» de «Días en taller». Infla el total, el % de correctivas y los promedios. | `maintenance-work.ts:195-209` | Contar sólo OT con `workshop_entry_at`, o mostrarlas aparte como pendientes | **Navegador + SQL** |
| PANN-4 = REGN-3 | «Trabajos del período 29 · 3 del historial · 26 de OT» enlaza a `/mantencion/registros/historicos` sin período ni faena. Esa lista muestra 154 filas, sólo historial, con las de prueba incluidas. No cuadra (A1). | `trinorma-sections.tsx:103`, `historicos/page.tsx:39-51` | Dar al historial filtros de período, faena y prueba, o quitar el enlace | **Navegador** |
| PAN-1 (sigue) | «OT cerradas en el período 7» y «Tiempo medio de reparación» enlazan a `/mantencion/ot?estado=cerrada` sin fechas: la lista muestra las 57 de la historia. Además, `desde`/`hasta` de la lista filtran por fecha de pedido. | `indicators-sections.tsx:154,187,198`, `work-orders/query.ts:76` | Filtro por fecha de cierre, o no enlazar | **Navegador** |
| PAN-6 (sigue) | «Equipos con la pauta al día 58 %» enlaza a `equipos?estado=vencida`, el complemento. | `indicators-sections.tsx:369` | `estado=al_dia` | **Navegador** |
| PAN-8 (sigue) | El selector de faena ofrece 19 faenas, 10 de ellas **desactivadas** y sin marca de inactiva. Aparecen casi duplicadas: «Cholguan» y «Cholguan - Arauco», «Fab. Puertas» y «Fábrica de Puertas», «Teno» y «Teno - Arauco». Omite Oficina Central. Registros repite el patrón. | `panel.ts:93-101`, `records-query.ts:328` | Faenas activas del alcance; las inactivas con historial, rotuladas «(inactiva)» | **Navegador + BD** |
| PAN-5 (sigue) | La franja «Hoy» pinta «Registros por revisar 9» con tono de alerta al **administrador de contrato**, que no puede revisar. Desde d4156824c también alcanza a ese rol. | `panel-today.tsx:49,69` | Condicionar el tono al permiso | **Navegador** (admin. de contrato, Pacífico) |
| PANN-1 | «Todavía no hay equipos en mantención» reemplaza el Panel entero cuando el alcance no tiene fichas, aunque haya historial, hallazgos o reportes. Pega a un administrador de contrato cuyas filas del consolidado no quedaron ligadas. | `panel/page.tsx:154-160` | Sumar `work.summary.total`, `compliance` y `findings` a la condición | Lectura |
| PANN-5 | Con `?equipo=X`, los enlaces de la sección OT pierden el equipo y llevan a toda la faena. | `indicators-sections.tsx:152-161` | Pasar `equipo` en `otHref` | Lectura |
| PANN-2 / REGN-19 / PANN-8 | «Trabajos» suma historial + OT y **no** los registros firmados sin OT. Además, no hay llave para detectar que el mismo trabajo se cargó en Forms y en la plataforma durante la transición. Hoy es latente: prod no tiene registros nativos. | `maintenance-work.ts:21-30` | Decidir la regla de coexistencia; cruzar por equipo + ingreso + `orderText` | Lectura / sospecha |
| PAN-2, PAN-4, PAN-9 (siguen) | Balde recortado sin marca de parcial; «Días fuera de servicio» sin `join` a fichas y con enlace a la lista de hoy; reabrir limpia `closed_at`. | Ver el informe del 2026-11-16 | — | Lectura |

### Órdenes de trabajo

| ID | Hallazgo | Dónde | Arreglo | Verif. |
|---|---|---|---|---|
| OTN-7 | Con el tipo de acción opcional (`ot_action_type_required = 0`) y la casilla «Reparación» marcada por defecto, toda OT sin clasificar cuenta como **correctiva**. Infla el % de correctivas del Panel. | `system-settings.ts:69`, `new-ot-sheet.tsx:80`, `action-type.ts:55-58` | Encender el interruptor antes del 01-12, o no precargar la casilla | Lectura ✓ |
| OTN-2 | Las horas hombre sólo se capturan desde el PC: el `finish` del teléfono no las trae. El Panel ignora las horas de las correctivas enlazadas y cuenta esa OT «sin horas». | `contracts.ts:244`, `maintenance-work.ts:188-226` | Precargar la salida con la suma de las correctivas, o usarla de respaldo | Lectura |
| OTN-3 | «Registrar salida» no muestra las HH ni el trabajo realizado ya guardados y los reemplaza: tras un rechazo, «2» pisa «8». Después de la salida no se pueden corregir. El tope de 10.000 h deja pasar «800» por «8,0». | `ot-action-dialogs.tsx:389-395`, `transitions.ts:353-357` | Precargar, permitir editar con evento, advertir valores altos | Lectura |
| OTN-6 | Ingreso a taller en el PC: `Number(raw.replace(",", "."))`. «123.456» km se guarda como 123,5. «1.234.567» deja el botón desactivado sin mensaje. No valida contra la lectura anterior (la app sí). | `ot-action-dialogs.tsx:149,152` | `parseReadingInput` + `checkReading` como la app | Lectura |
| OTN-5 | La OT de un equipo **trasladado** queda en la faena de origen: el destino no la ve, no recibe el aviso de conformidad y no puede darla. | `fleet-transfers.ts:216-220`, `access.ts:119`, `notifications.ts:112-142` | Decidir quién da la conformidad; al menos advertir el traslado con una OT en taller | Sospecha |
| OT-2, OT-3, OT-5, OT-6, OT-7, PER-2 (siguen) | Tramos de taller; motivo tras reapertura; ítems de un tipo desmarcado; «Corregir ingreso» con taller inactivo; teléfono adelantado; alcance latente de `manage`. | Ver el informe del 2026-11-16 (líneas actualizadas por la línea OT) | — | Lectura |

### Registros e historial

| ID | Hallazgo | Dónde | Arreglo | Verif. |
|---|---|---|---|---|
| REGN-2 | Dos envíos idénticos del mismo correo en cargas distintas abortan toda la importación del formulario («no se puede verificar su origen»), sin forma de forzarla. | `historical-import.ts:61-72` | Advertir y dejar entrar | Lectura ✓ |
| REGN-4 | «Observados» no distingue «espera al mecánico» de «ya respondió». «Marcar revisado» cierra una observación sin respuesta sin avisar. | `record-lifecycle.ts:283-324`, `records-table.tsx:74` | Indicador «con respuesta / sin respuesta» | Lectura |
| REGN-5 | El buscador del historial sólo ve el texto original del equipo: una fila ligada a KA-1 por patente no aparece al buscar «KA-1». | `historical-import.ts:154` | Unir código y patente de la flota; comparar compactado | Sospecha |
| REG-7 (sigue) | El buscador de Registros no encuentra un folio (`MP-FDL-0002` → 0) ni «ka91» (0). «KA-91» → 8. | `records-query.ts:28-33` | Folio + comparación sin guiones ni mayúsculas | **Navegador** |
| REG-15 (sigue) | La franja «Indicadores · 97 registros vigentes del 04-11-2025 al 19-11-2026» cambia con la pestaña, y su rango es el mínimo y el máximo del conjunto. | `registros/page.tsx:115` | Fijar la semántica o quitar el rango | **Navegador** |
| REG-1..REG-6 (siguen) | Observaciones cerradas que piden respuesta; «lectura anterior» posterior; el Excel lleva la pestaña; «Anulados» vacío en «Por revisar»; lote sin distinguir alertas; sin enlace a la OT. | Ver el informe del 2026-11-16 | — | Lectura |

### Equipos y preventiva declarada

| ID | Hallazgo | Dónde | Arreglo | Verif. |
|---|---|---|---|---|
| EQN-1 | **La preventiva declarada no se puede cargar en un equipo con algún registro (aunque esté anulado) y sin lectura inicial.** La lectura inicial queda «Fija» aunque sea nula, y la declarada exige lectura inicial («Primero indica la lectura inicial»). En `bodega_dev` son 103 equipos. En prod hoy no pega (no hay registros nativos), pero pegará apenas se use la app, y el cargador `apply-trinorma-lecturas-preventivas.ts` los dejaría «rechazados». | `equipment-resolve.ts:391, 454-457` | Permitir fijar la lectura inicial mientras sea nula, o validar la declarada contra la lectura vigente | Lectura ✓ + SQL |
| EQN-2 | «Nuevo equipo» con el código de un vehículo de otra faena **lo traslada** (`transferVehiclesTx`) con sólo `mant:equipment:manage`, sin `flota:transfer`. El mensaje dice «se incorporó», sin mencionar el traslado. Hoy está latente: los dos roles con `equipment:manage` (administrador, jefe de mantención) también tienen `flota:transfer`, y en prod Traslados está apagado. | `equipment.ts:142-163`, `equipos/actions.ts:82` | Exigir `flota:transfer`, o tratarlo como «Incorporar» (identidad de sólo lectura) | Lectura ✓ (latente) |
| EQN-3 | La identidad del equipo en Mantención no usa la regla del índice único: «KA128» frente a «KA-128» y «KA-071» frente a «KA-71». La vista previa de la importación dice «válida» y el commit se cae entero sin decir la fila. | `equipment-resolve.ts:~535-570`, `equipment-import.ts`, `fleet-incorporation.ts:46-52` | `equipmentCodeKey` y `canonicalEquipmentCode` | Lectura |
| EQN-4 | Los textos prometen lo contrario de `sin_preventiva`: «Sirve para calcular la próxima mantención antes del primer registro». El campo se llama «Lectura actual» en el alta y «Lectura inicial» en la ficha. | `equipment-plan-fields.tsx:56`, `equipment-import.ts:626` | Reescribir | Lectura ✓ |
| EQ-18, PER-1 (siguen) | «Incorporar desde la flota» no tiene buscador (la TopBar lo oculta) y precarga como marca nueva «MAHINDRA», «SSANGYONG», «Maxus»… | `top-bar.tsx:80`, `fleet-incorporation-panel.tsx:53` | Ver el informe del 2026-11-16 | **Navegador** |
| EQ-2 (agravado), EQ-3 (parcial), EQ-4, EQ-6 (siguen) | Cambio de unidad con lectura inicial; ahora también con declarada. «Nuevo equipo» reescribe tipo, marca, modelo y año. «Baja» apaga el vehículo en toda la plataforma sin confirmar. Importación con marca desactivada. | Ver la línea Equipos | — | Lectura |

### App del mecánico

| ID | Hallazgo | Dónde | Arreglo | Verif. |
|---|---|---|---|---|
| APPN-2 | Un equipo «fantasma» queda en taller 48 h tras la salida registrada en la web. «Ya salió» da 409, y el rechazo de taller no se ve nunca y no se poda. | `fleet-view.ts:181-192`, `queue.ts:223` | Regla de APPN-1 + sección «No se pudo enviar» | Lectura |
| APPN-3 | Las hojas (marcar ítems, taller, observación, ingreso a OT) se cierran al tocar el fondo y pierden lo escrito, sin preguntar. | `components/mantencion/app/dialog.tsx:167` | No cerrar por el fondo con cambios | Lectura |
| APPN-4 | Teléfono compartido: A vuelve a entrar con su contraseña y la app abre como B, la última cuenta activa por PIN. | `bootstrap.ts:60,90` | Marcar el login explícito | Sospecha |
| APPN-5 | Cualquier 4xx sin el JSON del servidor (404 de un proxy, 413) se trata como rechazo definitivo. | `api.ts:40-45,68-85` | Sin `{ok:false, code}`, reintentar | Lectura |
| APP-4..APP-11 (siguen) | `needs_login` eterno tras un 403, rechazos invisibles, 2xx sin mirar el cuerpo, service worker sin timeout, toast sobre el pie, «Quitar» foto sin deshacer, Atrás de Android, Zod en inglés. | Ver la línea App | — | Lectura |

### UI y navegación (verificado en navegador)

| ID | Hallazgo | Dónde | Arreglo | Verif. |
|---|---|---|---|---|
| UIN-1 | **La cabecera de la ficha `/flota/[id]/mantencion` se ahoga a 1440 px.** Cinco botones («Crear orden de trabajo», «Exportar historial», «Editar mantención», «Propietario y ubicación», «Editar vehículo», este último en una segunda fila) más el chip de faena empujan el subtítulo a 5 líneas, y el breadcrumb queda «Control operacional / M». En móvil son 3 filas de botones antes de las pestañas. | Cabecera de la ficha (`ficha-chrome.tsx` y la página) | Una acción primaria + «Más acciones» | **Navegador** (capturas `desktop-ficha_mantencion`, `mobile-ficha_mantencion`) |
| PER-7 (sigue) | Como `supervisor_mantencion` (sin `flota:view`), la ficha deja el menú de Control operacional **plegado y sin ítem activo**. Como administrador marca «Vehículos». | `ficha-chrome.tsx:38-43` | Activar «Equipos» de Mantención | **Navegador** |
| REG-23 (sigue, ahora visible) | En KA-108, trasladado de Masisa a Pacífico el 04-11, el supervisor de Pacífico ve «Última preventiva MP-MAS-0053» en la tarjeta. La hoja de vida dice «Este equipo aún no tiene mantenciones… puede que pertenezcan a una faena que tu perfil no alcanza». La ficha se contradice. | `equipment-life-section.tsx`, visibilidad por faena del registro | Decidir: la hoja de vida sigue al equipo, no a la faena del registro | **Navegador** |

---

## P3 (por área, compacto)

**OT**
- **OTN-8:** la lista no muestra ni filtra el tipo de acción.
- **OTN-9:** el historial no nombra al mecánico ni la etapa del rechazo.
- **OTN-10:** fechas sin `min` ni `max` en los diálogos.
- **OTN-11:** nota de ítem distinta entre el PC y la app.
- **OTN-12:** elegir el tipo de acción pisa las casillas.
- **OTN-13:** «Nueva OT» no avisa de una OT abierta del mismo equipo.
- **OTN-14:** anular no avisa a jefatura.
- **OTN-15:** la ficha muestra «Días detenido –» con la OT 9 días en taller, mientras la lista dice «Días en taller» (navegador).
- **OTN-16:** la lista fecha por la orden y el Panel por el ingreso.
- **OTN-17:** la faena de ejecución no da visibilidad.
- **Siguen:** OT-8 a OT-20, PER-3, PAN-9, UI-1 (columnas vacías en «Por asignar», navegador) y UI-2 («Taller interno (interno)», navegador).
- **UI-3** parcial: «Mantenciones solicitadas» sigue vacía con Mantención desmarcada (navegador).
- **UI-8 se extendió a los campos nuevos:** en la misma tarjeta hay «Especialidades —», «Horas hombre –» y «Días detenido –» (navegador).

**Registros e historial**
- **REGN-6:** el Excel sin observaciones de jefatura, lectura anterior ni OT.
- **REGN-7:** la pantalla llama «consolidado» a la exportación de Forms.
- **REGN-8:** «cuentan en los indicadores» es falso para las filas de prueba.
- **REGN-9:** el historial no tiene «Exportar Excel».
- **REGN-10:** chip «El de la ficha».
- **REGN-11:** el detalle muestra folios de otra faena que dan 404.
- **REGN-12:** ordenar por lectura mezcla km y h.
- **REGN-13:** vacíos que hablan sólo del teléfono.
- **REGN-14:** «Exportar» con 0 filas da error.
- **REGN-15:** «Firma del mecánico» con el registrador.
- **REGN-16:** el texto de la alerta de salto se recalcula.
- **REGN-17:** código inalcanzable del lote.
- **REGN-18:** sin orden en tarjetas móviles.
- **Historial (navegador):** la columna «Faena» muestra el texto crudo en mayúsculas («BIODIVERSA», «ARAUCO») en vez del nombre de la faena.
- **Siguen:** REG-8 a REG-25, UI-4 («Salfa / Salfa (taller externo)», navegador) y UI-5 (en móvil, 5 filas de filtros antes del primer registro, navegador).

**Equipos y pautas**
- **EQN-5:** `sin_preventiva` sin botón «Declarar preventiva» ni aviso en «Falta completar».
- **EQN-6:** errores con fechas ISO y números sin formato.
- **EQN-7:** la declarada bloquea la baja si el equipo quedó sin pauta.
- **EQN-8:** edición concurrente sin `FOR UPDATE`, y el chequeo se omite si falta el campo.
- **EQN-9:** 2 decimales generan un cambio espurio en la bitácora.
- **EQN-10:** la declarada no es piso en `checkReading`.
- **EQN-11:** se borra sin motivo ni confirmación.
- **EQN-12:** la hoja de vida y el Excel la ignoran.
- **EQN-13:** publicar una pauta no dice cuántos equipos cambian de estado.
- **EQN-15:** lecturas repetidas en la ficha.
- **EQN-16:** textos desactualizados.
- **Siguen:** EQ-5 a EQ-21 (EQ-16 no se confirmó), UI-6, UI-9, UI-10 y UI-11.

**Panel**
- **PANN-6:** el MTTR divide por todas las reparaciones cerradas, no por las medidas (latente: 0 casos en dev).
- **PANN-7:** «Fallas abiertas» enlaza a otra unidad y sin período.
- **PANN-9:** pantalla y PDF difieren con un equipo elegido.
- **PANN-10:** el PDF omite secciones sin decirlo, y su MTTR sale siempre en horas.
- **PANN-11:** el Excel del Panel trae números y fechas como texto.
- **PANN-12:** la exportación no valida el rango.
- **PANN-13:** «Reportes de equipos» no exige el permiso de Inspecciones.
- **PANN-14:** días en taller, fuera de servicio y MTTR sin definición.
- **PANN-15:** el filtro «Equipo» lista vehículos sin ficha.
- **PANN-16:** `panel-coverage.ts` es código muerto con la regla vieja.
- **PANN-17:** equipos sin estadía (0 casos en dev).
- **PANN-18 (navegador):**
  - «Días en taller 47» se repite en la tira y en el titular «47 días en taller entre 7 faenas».
  - Con el período mensual por defecto, «Días fuera de servicio 42,4» también se repite en el titular.
  - En «Estado de las pautas hoy», la fila «Sin preventiva» sale sin barra ni número.

**App del mecánico**
- **APPN-6:** foto «Lista» sin imagen.
- **APPN-7:** un 401 viejo marca la credencial nueva.
- **APPN-8:** se pierden los avisos del servidor.
- **APPN-9 = EQN-14:** la app no marca `sin_preventiva` y no tiene pruebas de ello.
- **APPN-10:** `?corregir=` sin tipo ni equipo.
- **APPN-11:** error de arranque crudo, posiblemente en inglés.
- **APPN-12:** `role="status"` que se anuncia en cada tecla.
- **APPN-13:** «Corregir y reenviar» sin salida si el equipo salió de la lista.
- **APPN-14:** hoja de alto fijo con teclado abierto (sospecha).
- **Siguen:** APP-12 a APP-23.

**Permisos y navegación**
- **PERN-1:** desde d4156824c el administrador de contrato ve el Panel, Registros, Equipos e historial (con responsable y conductor), y exporta. La descripción de `mant:export` no menciona el Panel. Los permisos viajan en el JWT, así que hay que volver a entrar para verlos.
- **PERN-2:** el universo de OT del Panel difiere del de «Trabajos».
- **UIN-2:** tres textos distintos para «fuera de tu alcance» según la ruta y el rol: «No encontramos este registro» (también para una OT), «Recurso no encontrado» y «Esta dirección no existe». Todos responden HTTP 200 por el streaming (navegador).
- **Siguen:** PER-3, PER-5, PER-6, PER-8 y UI-12 (fuera del Panel).

---

## PASS (verificado)

- **Rutas:** las 30 responden 200 en escritorio y móvil. Tienen un solo `h1` visible, no hay scroll horizontal a 390 px, no hay error boundary ni errores de consola, y **axe WCAG 2.1 A/AA da 0 violaciones** en escritorio.
- **Redirecciones:**
  - `/mantencion` → Panel;
  - `/mantencion/indicadores` → Panel;
  - `/mantencion/configuracion` → Pautas.
- **Alcance por faena (navegador, supervisor y administrador de contrato de Pacífico):**
  - OT, registro y ficha de Santa Fe: «no encontrado».
  - Pautas: `/forbidden`.
  - El informe del Panel sale acotado a Pacífico.
  - `?faena=` de otra faena se ignora.
- **Código sano según las líneas:**
  - máquina de estados de OT con `expectedVersion` e idempotencia;
  - CAPA acreditada en la misma transacción;
  - regla única `equipmentStatus` con `sin_preventiva` coherente en servidor, Panel, lista, ficha, Excel y PDF (la app no lo marca: APPN-9);
  - la declarada nunca se muestra como firmada;
  - el importador del consolidado es idempotente y con lock;
  - correo del historial oculto en el servidor;
  - cola offline atómica y envío idempotente;
  - credenciales de dispositivo serializadas y revocables;
  - fechas en hora de Chile;
  - paridad ruta → permiso → menú → manifiesto completa para los 18 `mant:*` (tabla en la línea Panel), salvo PER-3 y PER-5.

## Advertencias de automatización

- **`/api/apps/visita` abortada:** en cada navegación (54 veces) aparece `FAILED net::ERR_ABORTED /api/apps/visita`. Es la baliza de TI, cortada al cambiar de página; ya estaba conocida y no es de Mantención.
- **Errores del log del dev:** `CredentialsSignin` (dos logins con clave errada, antes de igualar las claves QA) y «destination stream errored» en `/dashboard` (el navegador cerraba tras el login). No son defectos de Mantención.
- **Datos de `bodega_dev`:**
  - Las 154 filas del historial son del import viejo: «Acción: No informada», códigos KCH-133/135/136 sin corregir.
  - No hay inspecciones históricas, así que las secciones Trinorma del Panel («Pautas y hallazgos de formularios») salen «Sin dato».
  - El Panel con el consolidado completo sólo existe en `bodega_trinorma` y en prod, y no se recorrió.

## Brechas de cobertura

- **App del mecánico:** no se abrió en navegador, porque entrar crea credenciales de dispositivo. Todos los APP y APPN salen de lectura.
- **Sin mutaciones:** no se crearon, anularon, cerraron ni revisaron OT, registros o equipos. OTN-1..7, EQN-1..3, REGN-1..2 y APPN-1 están confirmados por lectura, no reproducidos.
- **Sin descargas:** no se abrieron PDF ni Excel (el impreso `/mantencion/informe` sí se renderizó).
- **Roles:** sólo administrador, supervisor de mantención y administrador de contrato. Faltan jefe de mantención acotado, mecánico y consulta.
- **Sin puertas:** no se corrieron typecheck, lint, tests ni E2E, porque no hubo cambios de código.

## Orden sugerido

1. **Antes del 01-12 (Panel Trinorma):**
   - OTN-4/PANN-3 (contar sólo OT con ingreso);
   - OTN-7 (encender el tipo de acción obligatorio, o no precargar «Reparación»);
   - OTN-1 («Editar solicitud»);
   - PANN-4 y PAN-1/PAN-6 (enlaces que cuadren);
   - PAN-8 (faenas inactivas en el selector).
2. **Errores invisibles y bloqueos de datos:** EQ-1, EQN-1, REGN-1 y REGN-2.
3. **App del mecánico:** APPN-1, APP-3, APP-2, APP-1, APPN-2 y APPN-3.
4. **Decisiones del usuario antes de tocar código:**
   - quién da la conformidad de una OT de un equipo trasladado (OTN-5) y la hoja de vida tras un traslado (REG-23);
   - el alcance de la «baja» (EQ-4);
   - la coexistencia de historial y registros nativos en «Trabajos» (PANN-2/PANN-8);
   - si `jefa_chome` / `admin_contrato` deben ver tonos de alerta (PAN-5).
5. **P3 por tandas de área.**
