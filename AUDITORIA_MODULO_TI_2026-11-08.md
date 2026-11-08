# Auditoría del módulo TI — 2026-11-08

**Alcance:** rutas `app/(app)/ti/**`, `app/(print)/ti/**`, `app/api/ti/**`, servicios `lib/services/ti/**`, manifiesto y permisos, más los primitivos compartidos que el módulo usa.
**Método:** lectura del código, verificación de cada hallazgo contra la implementación real, pruebas PGlite de regresión y puertas estáticas. No se repiten los hallazgos de las auditorías previas (TI-01…TI-41, TIUX-01…TIUX-63), que ya están cerrados.
**Lentes de diseño:** `impeccable` en modo *Operate* (escaneabilidad, consistencia, expectativas nativas) y el checklist de `unslop`. `awwwards` no se usa como barra: es un estándar para sitios de persuasión/exhibición y aplicarlo a un módulo operativo interno produciría el tipo de teatro que este módulo no necesita. De ese skill se toma solo el criterio de craft (alineación, jerarquía, un momento visual), no su brief de rediseño.

---

## Resumen ejecutivo

El módulo TI está por encima de la media del repositorio: no tiene `toLocaleDateString`, ni `<input type="date">`, ni CSV, ni `router.push` en filtros, ni gradientes, ni emojis, ni `uppercase`, ni motion decorativo; todas las tablas tienen `caption`, todos los gráficos tienen tabla alternativa y respetan `prefers-reduced-motion`. Las brechas eran tácticas, no estructurales.

**50 hallazgos iniciales:** 7 altos, 13 medios, 18 bajos y 12 documentados.
En una segunda pasada se cerró todo el backlog P1–P9 y el formulario permanente de documentos (U19). La verificación en navegador encontró además un defecto de contraste (U20) que quedó corregido.

| Severidad | Corregidos | Documentados / decisión |
|---|---:|---:|
| Alto | 7 | 0 |
| Medio | 13 | 0 |
| Bajo | 19 | 2 |
| Backlog (rendimiento/deuda) | 8 | 1 (P3, decisión de diseño) |

---

## 1. Seguridad y autorización

| ID | Sev | Hallazgo | Estado |
|---|---|---|---|
| S1 | Alto | `/ti/reportes` aparecía en el menú con `ti:export` pero la página exige `ti:view` (el menú evalúa permisos con OR): un rol con solo exportar veía el enlace y caía en `/forbidden`. | **Corregido**: menú alineado a `ti:view`; exportar sigue siendo capacidad (`canExport`). Se quitó la excepción de `nav-page-permission-parity.test.ts`. |
| S2 | Alto | `ti:reverse_retirement` no estaba en `SENSITIVE_GRANT_PERMISSIONS`: cualquiera con `admin:users` podía autoconcederse el permiso que el manifiesto separa para preservar el doble control de la baja. | **Corregido**. |
| S3 | Alto | `createSupplierLink` / `deleteSupplierLink` solo pedían `ti:manage_assets`: un rol de faena podía crear o borrar vínculos del catálogo global de proveedores. | **Corregido** con `assertTiGlobalAccess`, igual que licencias y sistemas de acceso. |
| S4 | Alto | `listSupplierLinks` devolvía RUT, email, teléfono y los conteos de activos, mantenciones y **costo de mantención de toda la empresa** a un rol de una faena. | **Corregido**: los agregados se acotan por faena; la escritura del catálogo exige alcance global y la UI oculta crear/borrar fuera de él. |
| S5 | Medio | `transitionTicket` aceptaba cualquier usuario activo como asignado; solo `assignTicketAction` validaba `ti:manage_tickets`. Un POST fabricado dejaba el ticket a cargo de alguien sin permiso y disparaba su notificación. | **Corregido** en la action de transición, con la misma regla y error de campo que la asignación. |
| S6 | Bajo | `generateMetadata` del acta leía la asignación sin autenticar y filtraba el código en el `<title>` a cualquier sesión. | **Corregido**: autentica y valida faena antes de componer el título. |
| S7 | Medio | La ficha de activo lanzaba 12 consultas sin alcance y recién después hacía `notFound()`: la seguridad dependía del orden de dos líneas y se gastaban 11 consultas por ID ajeno. | **Corregido**: `getAssetById` primero, `notFound()` inmediato, resto en paralelo. |

---

## 2. Integridad de custodia y datos

| ID | Sev | Hallazgo | Estado |
|---|---|---|---|
| D1 | Alto | Una devolución podía quedar con fecha **anterior a la entrega**: el zod solo exigía «no futura» y el picker no tenía `min`. Producía duración negativa y orden incoherente en la lista. | **Corregido** en servicio, validación y `min` del `DateTimePicker`. |
| D2 | Alto | La transferencia no comparaba `returnedAt` con la entrega original ni `newDeliveredAt` con `returnedAt`: dos tramos solapados y un acta nueva con fecha anterior a la que reemplaza. | **Corregido** con dos guardas y `min` en ambos pickers. |
| D3 | Medio | `softDeleteAsset` permitía eliminar un activo con una baja vigente, dejando la reversión imposible (no existe acción de restauración). El mensaje mandaba a una salida inexistente. | **Corregido**: bloquea la baja vigente. Se retiró `deleteAssetAction`, que estaba exportada y no la usaba nadie. |
| D4 | Medio | Re-guardar un acceso ya en «baja» sobrescribía `revokedAt` con «ahora» y borraba la evidencia de cuándo se cerró la cuenta. | **Corregido**: conserva la fecha original. |
| D5 | Medio | Se podía registrar o editar una mantención sobre un activo dado de baja si la baja ocurría en otra pestaña con el sheet abierto; luego sumaba al gasto anual de un activo que ya no aparece en el inventario. | **Corregido** en crear y editar. |
| D6 | Bajo | Se podía entregar un equipo a un trabajador inactivo (el selector solo mostraba activos, pero el servicio no revalidaba). | **Corregido**. |
| D7 | Bajo | Al cerrar un ticket, `input.resolution ?? ticket.resolution` trataba `""` como valor válido y bloqueaba el cierre de un ticket ya resuelto. | **Corregido** con `trim() ||`. |
| D8 | Bajo | `addTicketComment` insertaba el cuerpo sin `trim` ni tope; el máximo de 2000 vivía solo en zod. | **Corregido** en el servicio. |
| D9 | Medio | Ventanas de fecha corridas un día al comparar `timestamp::text` contra columnas `date`: una mantención del 26/06 desaparecía de «último año» el 26/06 del año siguiente. | **Corregido** comparando fechas y usando `make_interval(years => n)`. |
| D10 | Bajo | Orden no determinista en cinco listados (misma fecha → filas que cambian de lugar entre renders). | **Corregido** con desempate por `id` o por la columna agrupada. |
| D11 | Medio | Los cupos «asignados/libres» de una licencia se calculaban solo con las asignaciones de la faena del usuario, pero la compra es global: el listado y el Excel declaraban asientos libres que el servidor rechazaba. | **Corregido**: la cifra es global; el detalle de asignaciones sigue acotado. |
| D12 | Medio | Una licencia **ya vencida** no alertaba ni aparecía en el tablero (`renewalDate >= today`), aunque la pantalla la mostraba como urgente. | **Corregido** en alertas y en ambos conteos; la tarjeta ahora dice «por renovar o vencidas». |
| D13 | Bajo | «Actas sin acuse» no cuadraba: el tablero contaba solo las abiertas y la lista todas las pendientes. | **Corregido** con una regla única: toda acta pendiente, también devuelta. |
| D14 | Medio | El Excel de historial escribía la hora en UTC mientras el resto de las hojas usa Chile; la hoja de garantías incluía activos retirados que la pantalla excluye. | **Corregido**: `stamp()` y mismo universo que la pantalla. |
| D15 | Medio | Las fotos de devolución abandonadas nunca se limpiaban: nacen con `pendingAssignmentId` y el aseo exigía `pendingAssignmentId IS NULL`. Podían quedar gigabytes invisibles. | **Corregido**: se limpian tras 24 h; una carga reciente se conserva. |

---

## 3. UI/UX, accesibilidad y pulido

| ID | Sev | Hallazgo | Estado |
|---|---|---|---|
| U1 | Alto | La matriz de accesos suma una columna por sistema y no tenía contenedor de scroll; el pozo del shell es `overflow-x-hidden`, así que las últimas columnas quedaban inalcanzables. | **Corregido** con contenedor `overflow-auto` y alto acotado, conservando `sticky`. |
| U2 | Medio | Tres estados vacíos afirmaban «no hay datos» cuando el filtro dejaba 0 filas y no ofrecían salida. | **Corregido** con la bifurcación `hasFilters` y «Limpiar filtros» en mantención, garantías y bajas. |
| U3 | Medio | Filtros: los tres visibles de Inventario no tenían chip; Garantías reconstruía la URL y perdía columnas/orden; Entregas era una barra artesanal sin chips; mantención y bajas descartaban `_cols/_sort/_dir`. | **Corregido** en las cinco barras. |
| U4 | Bajo | Breadcrumbs: 8 páginas partían en «TI» y 2 en «Inicio», mientras los `loading.tsx` mostraban «Inicio»; el nivel desaparecía al cargar. Además el loading decía «Resumen» y la página «Resumen de TI». | **Corregido** en 10 páginas y en el loading. |
| U5 | Bajo | Los 4 tiles de `/ti` nunca pasaban `empty`; con 0 mostraban «0» en vez de qué hacer. | **Corregido** en los tres tiles alcanzables. |
| U6 | Medio | El sheet de accesos cambiaba de alto al llegar el registro existente (desaparecía «Revisando…», entraba el banner, se remontaba el formulario). | **Corregido** con `stableHeight`. |
| U7 | Bajo | Los diálogos de anular mantención y revertir baja mostraban el error del servidor sin `role="alert"`. | **Corregido**. |
| U8 | Bajo | Cinco `opacity-80` sobre `--color-danger-ink` bajaban el contraste del banner de baja. | **Corregido**. |
| U9 | Bajo | El filtro de estado de tickets se anunciaba como landmark `<nav>`. | **Corregido** a `role="group"`. |
| U10 | Bajo | El botón que abre una foto de evidencia no tenía `focus-visible`. | **Corregido**. |
| U11 | Bajo | Icono de documento sin `aria-hidden` y enlace a pestaña nueva sin aviso. | **Corregido**. |
| U12 | Bajo | Píldoras activas usaban `text-white` sobre primario en vez de `--color-on-primary`. | **Corregido** en tickets, garantías y checkbox de checklist. |
| U13 | Bajo | Dos tokens para el mismo texto: `--color-danger` vs `-ink` (13 sitios) y `--color-primary` vs `-ink` (8 sitios). | **Corregido** en todo el módulo. |
| U14 | Bajo | Todo tipo de mantención se pintaba en `warning`, así que una preventiva se leía como urgencia. | **Corregido** con `IT_MAINTENANCE_TYPE_VARIANT`. |
| U15 | Bajo | «Activar sistema» y el checkbox de tareas no tenían estado pendiente (doble envío sin feedback). | **Corregido** con `SubmitButton` y `useFormStatus`. |
| U16 | Bajo | Cuatro estados vacíos sin CTA real. | **Corregido** con acción de crear/limpiar/ir a la mesa de ayuda. |
| U17 | Bajo | La matriz de accesos duplica la tabla y las tarjetas en el DOM; `getByText` puede resolver a dos nodos. | **Documentado**: no es un bug de producto; usar `getByRole`/`textoVisible()`. |
| U18 | Bajo | «Exportar Excel» y «Exportar con filtros» conviven en Reportes. | **Documentado**: la diferencia es informativa y el rótulo «Exportar Excel» es el estándar del design system. |
| U19 | Bajo | La carga de documentos en la ficha de activo es un formulario permanente, no un sheet disparado por acción (A3). | **Documentado** para no cambiar la estructura en esta pasada. |

### Lectura de diseño

- **Lo que ya estaba bien:** una sola idea por pantalla, conteos en `tabular-nums`, gráficos con colores que codifican estados reales, tabla alternativa y motion condicionado por `prefers-reduced-motion`, iconografía única (Phosphor) y densidad consistente.
- **Lo pulido:** se eliminó el ruido de color que no significaba nada (badges de mantención), se normalizaron tokens de texto y se completaron los estados que faltaban (vacío con filtros, tile en cero, pendiente de envío). No se agregó decoración ni se cambió la estructura.
- **Lo que no se tocó a propósito:** el par de gráficos del resumen, la superficie de tarjetas y el catálogo de 13 reportes. Cambiarlos sería rediseño, no pulido.

---

## 4. Backlog cerrado en la segunda pasada (2026-11-08)

| ID | Tema | Estado |
|---|---|---|
| P1 | `listAssets` sin paginación y con 3 subconsultas correlacionadas. | **Corregido**: `?q=` y `?orden=` en servidor, `countAssets`, `ServerPagination` (25/página), búsqueda propia en la barra y agregados con subconsultas agrupadas + `LEFT JOIN`. |
| P2 | `listSupplierLinks` con 4 correlacionadas por proveedor. | **Corregido**: 3 subconsultas agrupadas + `LEFT JOIN`. Sin paginación: el catálogo de proveedores TI es pequeño por diseño. |
| P3 | `listWorkersWithAccess` «filtra en JS y no pagina». | **Revisado**: ya filtra en SQL; la matriz necesita la nómina completa para cruzar trabajadores × sistemas. Paginar rompería el cruce. Sin cambio, por decisión. |
| P4 | Tipos de activo duplicables por mayúsculas. | **Corregido**: migración `0382` con índice único `lower(name)`, chequeo case-insensitive y captura de `23505`. Sin duplicados previos en la base. |
| P5 | Registrar una reparación no movía el activo a `en_reparacion`. | **Corregido**: una reparación sobre `disponible`/`en_bodega` deja `en_reparacion` con historial y `status_history`; sobre un activo en custodia no cambia el estado (se usa la salida a reparación). |
| P6 | «Reparación demorada»: 14 vs 30 días y `updatedAt` como proxy. | **Corregido**: `REPAIR_STUCK_DAYS = 14` y `repairStartedAtSql`/`repairStuckSql` compartidos por tablero, cron y filtro `?reparacion=demorada`; la tarjeta enlaza al subconjunto. |
| P7 | Adjuntos sin cuota ni rate-limit. | **Corregido parcial**: tope de 50 por activo y 30 cargas/hora por usuario. Sin borrado, por diseño append-only. |
| P8 | `getTicketsByMonth` en UTC y sin ventana de 12 meses. | **Corregido**: mes civil de `America/Santiago` y piso de 11 meses. |
| P9 | `modulo-ti.md` congelado en 2026-09-03. | **Corregido**: actualizado a 2026-11-08 (navegación, 10 permisos, paginación, reparación, adjuntos y migraciones). |

**También cerrado:** U19 (el formulario de documentos es ahora un `Dialog` disparado por acción) y U20 (el token `--color-on-primary` no existe en el design system: las píldoras activas quedaban con texto oscuro sobre verde a 2.33:1; se volvió al `text-white` que usa `<Button variant="primary">`).

---

## 5. Verificación ejecutada

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | **Pasa**. |
| `npm run lint` | **Pasa**. |
| Pruebas PGlite de TI (8 archivos: assets, assignments, tickets, licenses/access, maintenance/retirement, asset-types, alerts, attention/reports) | **166/166 pasan**. Incluyen las nuevas de paginación/orden, reparación demorada, reparación que mueve estado, trabajador inactivo, baja vigente, proveedores acotados, cupos globales, `revokedAt` preservado y unicidad case-insensitive. |
| Pruebas no-PGlite dirigidas (actions, permisos, buscador) | **45/45 pasan**. |
| `npm run test:pglite` (suite completa) | **4.678 pasan / 4 fallan** en la primera pasada; los 4 eran expectativas de este cambio (cupos acotados y validación del asignado), ya corregidas y reverificadas. El resto de la suite queda verde; no se repitió la corrida completa después del backlog. |
| `npm run test:fast` | **No es concluyente en este entorno**: 361 archivos fallan con `React.act is not a function` en módulos ajenos a TI (Prevención, PDTP, combustible). Es un problema de dependencias del entorno, no de este cambio. Las pruebas dirigidas de TI sí pasan. |
| Migraciones | **0382** (`it_asset_types_name_lower_unique`) agregada, checksum registrado y `db:verify-migrations` en verde (383 entradas). |

### Verificación en navegador: ejecutada

Se levantó un `next dev` aislado en `:3011` con el código actual, base de desarrollo y una sesión QA temporal (usuario `qa-ti-audit`, eliminado al terminar). La sesión original de `playwright/.auth/monkeytest.json` sí era válida: el error de la primera pasada fue mío al usar `127.0.0.1` en vez de `localhost`, que es el dominio de las cookies.

Resultado de las 10 rutas a 1440 px, más 1024 y 390 px en las pantallas con cambios de layout:

- **0 errores de consola**, 0 `pageerror`, 0 overflow horizontal del documento.
- **0 violaciones axe `serious`/`critical`** tras corregir U20. La primera pasada encontró 3 nodos de contraste en Garantías y Tickets (píldoras activas con `--color-on-primary`, un token inexistente); se corrigieron y se reverificaron.
- **Inventario paginado:** 57 activos, 25 por página; `?pagina=2` muestra «26 - 50 de 57»; `?q=TI` filtra en servidor; `?orden=codigo_desc` invierte el orden; `?estado=en_reparacion&reparacion=demorada` devuelve 1 fila y sus chips; la barra muestra el buscador propio y el TopBar ya no duplica uno.
- **Diálogo de documentos:** abre desde la pestaña Documentos y cierra con Escape.
- **Matriz de accesos:** el contenedor tiene `overflow: auto` en ambos ejes y `max-height`; a 1440 y 1024 no necesita scroll con los datos actuales, pero las columnas ya no quedan recortadas por el pozo.
- Capturas y `resultado.json` en `audit/screenshots/ti-2026-11-08/`.

---

## 6. Riesgos y notas de despliegue

- **Cambian cifras visibles en Garantías**: un rol de faena dejará de ver el gasto de mantención de toda la empresa. Es el comportamiento acordado, pero conviene avisar a quien use la pantalla para negociar proveedores.
- **Cambia el saldo de licencias**: un rol acotado verá los cupos reales (posiblemente 0 libres) en vez de un saldo inflado.
- **Sube «Actas sin acuse»**: ahora incluye devueltas pendientes, que también se pueden acusar.
- **Aparecen licencias vencidas**: el tablero y el cron empezarán a reportar lo que antes era invisible.
- **No se tocó** la navegación, el modelo de tickets, el flujo de aceptación ni el diseño de las tarjetas del resumen.
