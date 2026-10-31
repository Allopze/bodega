# Rediseño de Combustible «El mes como hilo» — verificación de la rama (2026-10-31)

Rama `feat/combustibles-rediseno` (worktree `bodega-wt/combustibles-rediseno`), sobre `main` 946a80249. **Sin merge a `main`, sin push y sin deploy.**

Entorno del recorrido:

- **Servidor:** build de producción del worktree (`node .next/standalone/server.js`, :3105).
- **Base:** la base E2E (`bodega_e2e`, :55432), con los datos que dejan las especificaciones E2E. `bodega_dev` casi no tiene datos de combustible.
- **Herramienta:** Chromium de `@playwright/test` desde un script del scratchpad.

## Puertas

Corrida final, sobre el último commit de la rama, después de todas las correcciones:

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | OK, sin errores |
| `npm run lint` | OK |
| `npm run test:fast` | 1.100 archivos y 16.642 pruebas OK; 278 pruebas omitidas en 32 archivos |
| `npm run test:pglite` | 299/299 suites, 3.723 pruebas (1 omitida) |
| `npm run db:verify-migrations` | OK, 366 entradas hasta `0365_slow_sebastian_shaw` |
| Migración 0365 sobre una copia de `bodega_dev` | OK (detalle abajo). La copia se borró |
| `db:generate` | «No schema changes»; `db/schema` no cambió después de la Fase 0 |
| `npm run build` | OK |
| `npm run check:bundle-budget` | OK desde la segunda pasada: 292 rutas, peor caso `/combustibles/fuentes/agregar/planilla` = 2,60 MB (tope 3 MB) |
| `npm run check:secrets` | OK |
| `npm run check:security-audit` | OK desde la segunda pasada: undici 7.30.1 y zod 4.6.7; el allowlist queda vacío (la excepción de `braces` ya no correspondía a ningún hallazgo) |
| `npm run doctor` | 3 errores, los mismos de `main` (`components/mantencion/app/{install-prompt,pin-pad}.tsx`). Puntaje 66 (`main` 67), por 49 avisos más de código nuevo |
| E2E (12 especificaciones de combustible y vecinas, `chromium`) | 115 OK, 1 omitida (`tae-public-flow` sin conexión, que se omite cuando el navegador no puede releer un `Blob`). Las 12: `combustibles-rediseno`, `combustibles`, `combustibles-control`, `control-operacional-navegacion`, `tae-history-import`, `tae-reconciliation`, `tae-public-flow`, `densidad-kpi`, `keyboard-navigation`, `ui-ux-audit-evidence`, `shell-scroll`, `ci-smoke` |

**Migración 0365 sobre una copia de `bodega_dev`:** antes de migrar se sembraron interruptores viejos y dos pedidos de revisión.

- `/combustibles` en `false` pasó a `/consumo` en `false`.
- `/bitacora` en `false` pasó a `/fuentes` en `false`. La clave nueva `/cargas`, que ya existía en `true`, se respetó.
- `/tae` pasó a `/cuadratura`.
- `/revision` pasó a `/revisar`.
- `/facturas` pasó a `/pagos`.
- Las claves viejas quedaron borradas.
- Los pedidos quedaron con `status = 'open'`. Su `worksite_id` quedó vacío, como corresponde a pedidos sin entidad.

## Recorrido por rol (1440 px, y 390 px donde se indica)

Se abrieron 35 pantallas por rol: las 8 secciones con todas sus vistas, las fichas de carga por origen y su historial, la ficha de equipo, el estado de cuenta, los archivos importados y sus fichas, y los asistentes. En cada una se registró:

- la URL final;
- el `h1`;
- los errores de consola;
- las respuestas 5xx y las peticiones fallidas;
- el desborde horizontal del pozo del shell.

| Rol (usuario) | Menú de combustible | Acceso | Observación |
|---|---|---|---|
| Administrador (`admin@`) | Los 8 ítems | Abre las 35 pantallas | Panel de jefatura: «4 de 5 pasos listos», «Lo que vence primero», tres cifras. 11 pantallas también a 390 px |
| Terreno (`jefe.mant@`, `jefe_mantencion`) | Panel, Cargas, Por revisar, Cuadratura, Consumo | Lo de terreno (`tae_view`), Pagos, Fuentes, Ajustes y el historial van a `/forbidden` | Panel de terreno, semana por defecto |
| Contrato (`QA_ qa.contrato@`, rol sembrado: `view`, `register_load`, `import`, `tae_view`, `tae_import`, `register_past_load`) | Agrega Fuentes de datos | Abre Fuentes y el archivo de tarjeta. La planilla (sólo roles globales), Pagos y Ajustes van a `/forbidden` | Panel de contrato, semana por defecto |
| Sin costos (`combustible.sincostos@`: `view` + `create`) | Panel, Cargas, Por revisar, Cuadratura, Consumo | Cuadratura entra a Estanques. Registrar y las vistas con `tae_view` van a `/forbidden` | Panel de consulta: tres frases. La ficha de factura **no muestra montos** |
| Faena acotada (`scoped@`) | Ninguno | Las 35 pantallas van a `/forbidden` | — |
| Prevención lectura (`prevencion.lectura@`) | Ninguno | Las 35 pantallas van a `/forbidden` | — |

**Errores de consola:** ninguno en todo el recorrido. **Respuestas 5xx o peticiones fallidas:** ninguna (se excluye el avatar externo, que en este entorno no tiene salida a internet).

## Defectos de producto encontrados y corregidos en la integración

1. **Las URL viejas a veces no redirigían** (E2E, `/combustibles/cuenta-corriente`).
   - **Causa:** `/combustibles/loading.tsx` envolvía en Suspense a todo el módulo. Cada página puente redirigía dentro del streaming, con meta refresh y navegación del router en carrera, y a veces el navegador se quedaba en la URL vieja.
   - **Corrección:** el esqueleto del Panel pasó a un `<Suspense>` dentro de su propia página, después del permiso y de la redirección de sus vistas viejas. Los puentes ahora responden un 308 real. `48d5a453e`.
2. **El calendario abría en el mes del mínimo permitido.** En la carga de otro día (62 días de margen) se veía un mes casi entero deshabilitado. Corregido en el primitivo compartido `DatePicker`, que sin valor ahora abre en el mes de hoy, acotado al rango.
3. **Las páginas puente copiaban `desde`/`hasta` sin validarlos.** Ahora descartan la fecha inválida y conservan la válida, como la redirección anterior. `a43a51f22`.
4. **La exportación de facturas con montos sólo exigía `export_sensitive`.** Ahora aplica también `assertFuelCostAccess`, igual que la pantalla. `1cf46abc3` + `85b105cd9`.
5. **Las cifras de las tablas se partían en dos líneas** («1.000» / «L» en Cuadratura). `TableCellNum` (primitivo compartido) lleva `whitespace-nowrap`.
6. **En la tarjeta del celular de Cargas, un motivo de pendiente largo se cortaba** fuera de su columna (el pozo lo ocultaba). Ahora se parte en dos líneas. Se verificó en el build final: el pozo mide 390 de 390 px. Las cifras de Cuadratura (punto 5) también se verificaron en pantalla.
7. **Fuga de datos en la ficha de terreno** (la encontró L2 con una prueba PGlite): se enviaba la fila completa al cliente, con nombres y la clave de la página pública.
8. **Nueve errores de tipos** que las líneas no podían ver sin `tsc`.
9. **`backup-env-whitelist` fallaba en `main`.** El `.env` del respaldo no incluía las variables de VisionLink.
10. **Error de React Doctor en código nuevo:** `use-inbox-seen.ts` escribía `localStorage` dentro del actualizador de estado.

## Hallazgos de UX corregidos

- Panel de terreno y contrato: «Registrar carga» aparecía tres veces. La cabecera ya no lo repite.
- Fuentes › Aramco decía dos veces que faltan las credenciales. Los errores de sincronización mandaban a «Combustibles → Importar», que ya no existe.
- Fuentes › Copec mostraba «Todavía no hay datos de esta fuente» junto a un último lote de julio. Ahora dice «de este período».
- La edición de una factura mostraba «TCT»/«TAE» y repetía el título «Datos de la carga».
- La evidencia de rendimiento atípico tenía un paréntesis de más.

## Hallazgos abiertos (no corregidos)

- **Accesibilidad, en un primitivo compartido.** Las flechas del calendario (`react-day-picker`) se anuncian en inglés («Go to the Previous Month»). Afecta a toda la plataforma.
- **UX, decisión del usuario: paso «Fuentes de datos» del Panel.** Dice «Al día» aunque la frase diga «4 fuentes sin datos todavía». L8 decidió que una fuente sólo cuenta como pendiente cuando hay algo concreto por resolver, para que el paso no quede siempre en rojo. Falta tu decisión.
- **Inconsistencia: «De dónde salió: TAE».** El nombre del medio de suministro viene del catálogo con la sigla. Es dato, no código; se corrige renombrando el medio en Ajustes.
- **Mejora: Registrar, paso «Dónde».** No preselecciona la faena aunque la persona tenga una sola.
- **Mejora: `lib/reports/export-metadata.ts`.** Muestra los identificadores de faena, en vez de sus nombres, a quien tiene alcance acotado. Afecta las exportaciones de todos los módulos.
- **Vigente desde antes:** el reporte de tarjeta que se sube a mano siempre se guarda como Copec, aunque la pantalla diga «Copec o Aramco».

## Decisiones de las líneas que conviene confirmar

- **Panel:** el criterio de variante por rol está documentado en `lib/combustibles/panel/role-variant.ts`. Los pasos sin permiso se ocultan, y el Panel no filtra por faena.
- **Sellos:** la vista por supervisor, el detalle y los litros por persona siguen exigiendo `tae_view`. Con `view` sólo se ve el historial, como antes.
- **Carga pasada:** el aviso de duplicada y «la lectura no supera la de la carga siguiente» sólo se aplican a la carga pasada. La reevaluación de la cadena de sellos y la reapertura de decisiones posteriores corren en toda carga nueva.
- **Bandeja:**
  - las patentes sin vincular sólo salen de archivos importados (no de la sincronización de Copec sin archivo);
  - el contador del menú no depende del período;
  - no hay buscador de texto.
- **Pagos:** las cifras de Facturas ahora excluyen borradores y anuladas, así que los números cambian respecto de antes.
- **Fuentes:** los montos de las fichas de archivo ahora exigen `view_costs`.

## Huecos de cobertura

- **`check:bundle-budget`:** resuelto en la segunda pasada (ahora mide los manifiestos de webpack).
- **Lo que no se recorrió en el navegador**:
  - el contenido de Ajustes más allá de su carga (sólo E2E de Integraciones);
  - Cuadratura › Sellos y Estanques a fondo;
  - Tarjetas;
  - el flujo de telemetría y surtidor;
  - las acciones destructivas (anular, revertir, revocar), que sólo están cubiertas por pruebas unitarias o PGlite.
- **Funciones del prototipo:** las 101 funciones del `MAP` se dan por cubiertas según los informes de cada línea; no se verificaron una por una en el navegador. El recorrido usó los datos de la base E2E, no datos de producción.
- **Auditoría axe:** no se corrió sobre las pantallas nuevas. Las fichas dinámicas (`/cargas/[origen]/[id]`, `/consumo/equipos/[id]`, `/pagos/estados/[id]`, `/fuentes/archivos/[tipo]/[id]`) no están en `e2e/accessibility-targets.ts` porque les falta fixture.
- **WebKit / móvil de Playwright:** sólo corrió el proyecto `chromium`.
- **Producción:** antes del deploy hay que leer, con autorización explícita y en modo sólo lectura, las filas `submodule.enabled:combustibles:%`.

## Recomendaciones (por prioridad)

1. Resolver `check:security-audit` y la puerta del bundle antes de liberar: hoy fallan también en `main`, y el CI las corre.
2. Decidir el criterio del paso «Fuentes de datos» del Panel.
3. Agregar fixtures para las fichas dinámicas a `accessibility-targets.ts` y correr axe sobre el módulo.
4. Traducir las etiquetas de navegación del calendario compartido.

## Segunda pasada: cierre de pendientes (2026-10-31, tarde)

Plan aprobado por el usuario para cerrar lo que este informe dejaba abierto. Decisiones del usuario:

- el paso «Fuentes de datos» del Panel queda pendiente si una fuente activa no trajo datos de un período cerrado;
- Sellos mantiene `tae_view`;
- la duplicada y el medidor siguiente siguen sólo en la carga pasada.

### Puertas, sobre el último commit

| Puerta | Resultado |
|---|---|
| `typecheck`, `lint` | OK |
| `test:fast` | 1.103 archivos, 16.653 pruebas OK |
| `test:pglite` | 299/299 suites, 3.725 pruebas OK. `miper-bulk` se ajustó por un cambio de zod 4.6: un objeto estricto informa además su `refine` después de una clave desconocida |
| `db:verify-migrations`, `check:secrets` | OK |
| `check:security-audit` | OK, sin hallazgos altos y con el allowlist vacío |
| `build` + `check:bundle-budget` | OK, 2,60 MB de peor caso |
| E2E de las 12 especificaciones (`chromium`) | Primera corrida: 109 OK y una falla de la propia prueba (esperaba la URL, cuando el punto ya venía elegido). Se ajustó, y la segunda corrida de `combustibles-control` y `combustibles-rediseno` dio 17/17 OK |
| Auditoría axe de `/combustibles/**` (`accessibility.spec.ts -g combustibles`) | 56/56 OK, después de corregir la tabla de Tarjetas |
| axe de las fichas dinámicas (`combustibles-rediseno.spec.ts`) | OK, después de corregir el formulario de edición de factura |
| `tae-public-flow` en `mobile-chrome` | OK |
| `tae-public-flow` en `mobile-safari` | **No ejecutable en este equipo**: WebKit necesita bibliotecas del sistema (`libgtk-4`, `libevent`, `libavif`, `libmanette`, `libenchant`, `libsecret`) |

Una corrida intermedia falló con `42703` (columna `fuel_review_marks.status` inexistente). Fue a mitad de corrida y la base E2E es compartida: otra sesión la reinició desde `main`, que no tiene la 0365. Al repetir la corrida sin nadie más en la base, no apareció ningún `42703`.

### Defectos corregidos

1. **Panel › Fuentes de datos (decisión del usuario).**
   - En un período cerrado, una fuente activa sin datos queda pendiente y se nombra.
   - En el período en curso sólo se avisa.
   - Las fuentes que nunca trajeron nada se cuentan como «todavía no se usan».
   - Los rótulos por período dicen «en …»: antes decían «Sin cargas octubre».
2. **Calendario compartido:** las flechas se anunciaban en inglés. Ahora usa el locale de `react-day-picker`.
3. **Exportaciones de todos los módulos:** la hoja «Metadatos» mostraba identificadores de faena a quien tiene alcance acotado. Ahora muestra los nombres, y si la consulta falla vuelve a los identificadores.
4. **Registrar:** ofrecía faenas sin punto de carga activo, y por eso no preseleccionaba la única faena operable.
5. **Reporte de tarjeta:** la subida manual se guarda siempre como Copec, y el texto ofrecía «Copec o Aramco». Ahora dice lo que acepta.
6. **Cargas › «Pendiente»:** los casos de anomalía abiertos no se veían, aunque el conteo se consultaba. Ahora se ven y entran al filtro «sólo con algo pendiente».
7. **Metadatos de Facturas, Sellos, Tarjeta y terreno y terreno:** escribían los filtros como JSON con ids. Ahora van en palabras y con nombres.
8. **axe:**
   - el formulario de edición de factura tenía selects sin nombre e inputs sin etiqueta;
   - la tabla de Tarjetas tenía un scroll sin foco, y pasó a `TableRoot`.
9. **Build:** `lib/combustibles/xlsx-utils.ts`, que también usa el cliente, reexportaba la hoja de metadatos, que ahora lee la base. Se quitó la reexportación, y la prueba de frontera prohíbe el módulo en el cliente.

### Recorrido en el navegador (build de producción en :3105, base E2E, `admin@`, 1440 px)

- **Pantallas:** Ajustes por dentro (mandantes, medios, familias, umbrales, reglas, puntos de carga y QR, integraciones), Sellos con su historial, Estanques, Tarjetas, y los asistentes de telemetría, surtidor y facturas. Todas devuelven 200 con su título, sin errores de consola, sin 5xx y sin desborde.
- **Acciones destructivas,** con registros `QA_`. En las cuatro aparece la confirmación, el resultado queda en la base y se escribe la auditoría:

| Acción | Confirmación | Resultado | Auditoría |
|---|---|---|---|
| Anular una carga de terreno | «Anular la carga», con motivo | `voided`; la ficha queda «Anulada» con la nota | `status_change` con el motivo |
| Revertir un archivo | «¿Revertir este archivo?» | `revertido`; aviso «Archivo revertido…» | `delete` |
| Revocar un enlace QR | «Revocar enlace» | `revoked_at` registrado; aviso «Enlace revocado» | `update` |
| Descartar un caso | «¿Descartar este caso?», con motivo | `dismissed`; la hoja queda «Descartado» con «Reabrir el caso» | `status_change` con el motivo |

### Las 101 funciones del prototipo

La tabla está en `combustibles-rediseno-2026-10-31-funciones.md`: 92 OK, 8 parciales, 1 en duda y ninguna falta. Esta pasada corrigió dos parciales: la 35 (casos en «Pendiente») y la 27 (metadatos en palabras). Quedan documentadas:

- **3 y 74:** las señales de calidad en terreno (por validar, observadas, sello incompleto, sin 4 fotos) existen como filtros de Cargas, pero no tienen un conteo agregado ni cifras de litros en la lista. «Por revisar» no incluye las cargas por validar.
- **9:** la ficha de equipo muestra el rendimiento carga a carga, pero no la evolución de litros, que está en Consumo.
- **29:** el buscador de Cargas dice «Buscar patente o equipo…». También busca proveedor y, con `view_personal`, personas.
- **48:** el interruptor de la sincronización diaria de Aramco está en Ajustes › Integraciones. Fuentes sólo enlaza ahí.
- **64:** en «Por revisar», los casos sólo se filtran por faena y gravedad. El estado y el registro de origen llegan sólo por URL.
- **73 (duda):** el tile «Combustible por revisar» de Control operacional suma cargas marcadas y casos, sin patentes ni pedidos, y no depende del período. Puede no coincidir con el «Todo · N» de la bandeja.

### Siguen abiertos

- «De dónde salió: TAE»: es un dato del catálogo, se renombra en Ajustes › Medios.
- La hoja de un caso descartado muestra el estado dos veces: un badge «Descartado» y otro «DESCARTADO».
- La lista de parciales de arriba.
- Producción: hay que leer los interruptores `submodule.enabled:combustibles:%`, en modo sólo lectura y con autorización, y correr `sync-rbac` para `combustibles:register_past_load` antes del deploy.
- Sin recorrer todavía: Safari (falta WebKit en este equipo), los roles distintos de administrador en las pantallas de esta pasada, y datos de producción.

