# Auditoría de trazabilidad — 4 de septiembre de 2026

**Resultado:** se confirmaron defectos de autorización, cálculo e integridad. La implementación todavía no ofrece resultados suficientemente consistentes para tratar su consolidado o su detector de excepciones como evidencia definitiva.

**Base revisada:** commit `da582cfc`, árbol inicialmente limpio. Auditoría del estado actual, sin modificar la lógica de la aplicación. Se añadieron únicamente este informe y sus evidencias.

**Balance:** 11 bugs confirmados, 1 hallazgo funcional sobre la política de regularización y 3 oportunidades de mejora. Prioridades: **6 P1, 9 P2, 0 P0**. Los IDs de las reproducciones se mantienen aunque el informe los ordena por impacto.

## Alcance y método

- Consolidado por faena, filtros, indicadores, acordeón, detalle de ítem, historial EPP por trabajador, búsqueda documental, Excel y regularización de integridad.
- Inspección de `app/(app)/bodega/trazabilidad`, servicios `trazabilidad-*`, `traceability-integrity*` y `document-chain`, esquema, transacciones de compra parcial, permisos, manifiesto de Bodega, redirecciones y componentes compartidos.
- Normas contrastadas: `AGENTS.md`, `PRODUCT.md`, `DESIGN.md` y documentación local de Next.js. El paquete instalado informa Next.js **16.3.3**.
- **48/48** pruebas rápidas existentes y **46/46** pruebas PGlite existentes: **94/94** en total.
- **10 reproducciones adicionales** sobre PGlite desechable con las migraciones reales: 9 defectos funcionales y el hallazgo de regularización. Incluyen llamadas a los servicios actuales, a la transacción real de compra parcial y al componente servidor del historial del trabajador.
- Chromium autenticado contra `http://localhost:3001`, usando exclusivamente la base local `bodega_dev` en `127.0.0.1:5433`. Navegación de lectura; no se pulsaron «Revisar historial» ni «Regularizar caso» sobre esa base.
- Escritorio **1440 × 1000**, móvil **390 × 844**, 9 capturas y comprobaciones Axe limitadas al contenido de las páginas observadas.
- Typecheck global y ESLint dirigido al submódulo, sus servicios y las evidencias: **sin errores**; ESLint final sin advertencias.

Las pruebas existentes en verde no contradicen los hallazgos: faltaban los escenarios que se reproducen aquí. Las aserciones de `reproduce.audit.ts` describen el comportamiento defectuoso actual; que pasen significa **bug reproducido**, no corrección. Este archivo se ejecuta con configuración explícita y queda fuera del descubrimiento habitual de `*.test.ts`.

## Hallazgos P1

### TR-09 — El historial del trabajador expone entregas de otra faena

**Tipo:** PRODUCT BUG — autorización/privacidad.

La página limita la consulta inicial del trabajador a las faenas de la sesión, pero después busca sus entregas únicamente por `workerId` y `destinationType`. Si el trabajador cambia de faena, un usuario acotado a su faena actual ve códigos, productos, fechas, cantidades y estado de firma de entregas hechas en una faena ajena. El comprobante individual sí vuelve a exigir acceso a la faena del documento, por lo que la página también puede ofrecer un enlace que termina denegado.

- **Ubicación:** `app/(app)/bodega/trazabilidad/trabajador/[workerId]/page.tsx:69`; contraste en `app/(print)/entregas/[id]/print/page.tsx:36`.
- **Reproducción:** trabajador en QA Norte, entrega histórica en QA Sur, sesión `isGlobal=false` con alcance sólo Norte y permiso de trazabilidad. La llamada real al componente servidor incluye `ENT-QA-OUTSIDE-SCOPE` en el contenido devuelto.
- **Límite:** la prueba utiliza un rol acotado con ese permiso. No demuestra que los roles globales predeterminados estén accediendo indebidamente ni cuantifica exposición en producción.
- **Corrección propuesta:** aplicar el alcance también sobre `deliveries.worksiteId`. Si se requiere compartir la hoja de vida entre faenas, modelar esa facultad como autorización explícita y hacerla coherente con los comprobantes.

### TR-10 — Una compra parcial duplica parte de la cantidad aprobada

**Tipo:** PRODUCT BUG — integridad de cantidades.

El consolidado prefiere `modifiedQty` de la última aprobación a la cantidad actual del ítem. La compra parcial divide el ítem en dos: reduce el original y crea un remanente, conservando la decisión de aprobación en el original. El consolidado aplica a ese original la cantidad anterior a la división y suma nuevamente el remanente.

- **Ubicación:** `lib/services/trazabilidad-consolidated-builder.ts:81`; división en `lib/services/purchasing-module/purchase-orders-create.ts:215` y `:258`.
- **Reproducción:** aprobación ajustada a **10**, compra parcial de **6** mediante `createOrder`, remanente **4**. Se obtienen dos filas con solicitado total **10**, aprobado total **14** y pendiente total **14**.
- **Impacto:** pendientes ficticios, indicadores y Excel inflados; entregar las 6 unidades de la primera línea puede dejarla eternamente parcial.
- **Corrección propuesta:** distinguir la aprobación histórica del compromiso vigente de cada línea tras dividirla, conservando la evidencia de origen. Probar conservación del total antes/después de dividir y después de entregar ambas partes.

### TR-02 — El detector de integridad cuenta entregas anuladas

**Tipo:** PRODUCT BUG — falsos positivos persistidos.

El consolidado excluye `voidedAt`, pero `scanTraceabilityIntegrity` no consulta ni filtra esa marca. La misma entrega aporta cero al consolidado y su cantidad completa al detector. Las falsas excepciones se guardan como casos históricos.

- **Ubicación:** `lib/services/traceability-integrity-cases.ts:97`; contraste en `lib/services/trazabilidad-consolidated-builder.ts:97` y contrato de anulación en `db/schema/receiving.ts`.
- **Reproducción:** entrega de 10 anulada, sin recepción. Consolidado: entregado **0**. Detector: `DELIVERY_EXCEEDS_FAENA_RECEIPT`, exceso **10**, caso insertado.
- **Corrección propuesta:** excluir anuladas del balance y de la evaluación cronológica, conservándolas visibles como documentos anulados. Identificar los falsos casos existentes mediante una revisión específica y registrar su regularización sin borrar snapshots.

### TR-06 — Una recepción posterior oculta un déficit intermedio

**Tipo:** PRODUCT BUG — falso negativo de integridad.

El detector compara el total histórico y sólo pregunta si hubo entregas anteriores a la **primera** recepción. No verifica cuánto estaba recibido en el momento de cada entrega.

- **Ubicación:** `lib/services/traceability-integrity.ts:74` y `:111`.
- **Reproducción:** recibir **5** el día 1, entregar **10** el día 2 y recibir otras **5** el día 3. Resultado: **ninguna excepción**, aunque faltaban 5 al entregar.
- **Corrección propuesta:** recorrer los eventos por fecha, comprobar el saldo acumulado en cada salida y conservar la excepción aunque posteriormente se equilibre. Definir un desempate estable para eventos simultáneos.

### UI-02 — Texto de las tarjetas móviles no alcanza el contraste exigido

**Tipo:** PRODUCT BUG — accesibilidad.

Axe confirmó tres nodos con contraste insuficiente en la tarjeta expandida: «Solicitud» y las fechas del historial. No es una deducción a partir del nombre de una clase.

- **Ubicación:** `app/(app)/bodega/trazabilidad/_components/consolidated-card.tsx:102` y `:178`.
- **Evidencia:** contraste **2,63:1** sobre blanco y **2,51:1** sobre `#f8fafc`, frente al mínimo de **4,5:1** para ese texto; tamaños de 12 y 10 px.
- **Impacto:** lectura difícil de contexto y fechas en terreno. Incumple el contrato de accesibilidad y WCAG 1.4.3.
- **Corrección propuesta:** usar tokens de texto con contraste validado y revisar los demás usos de `text-slate-400` cuando representan información.

### UI-03 — El detalle corta el flujo de cantidades y una tabla no es operable por teclado

**Tipo:** PRODUCT BUG — responsive/accesibilidad.

El flujo «Solicitado → En OC → Recibido → Entregado» usa una fila sin adaptación. En el móvil observado, su sección mide **356 px** y su contenido **485 px**; el área principal termina con **502 px** de contenido para **390 px** disponibles. El último paso queda fuera del ancho visible. Además, Axe identifica la tabla de aprobaciones como región desplazable sin contenido enfocable ni foco propio.

- **Ubicación:** `app/(app)/bodega/trazabilidad/[itemId]/page.tsx:99`; `app/(app)/bodega/trazabilidad/[itemId]/trazabilidad-item-tables.tsx:28`; `components/ui/table.tsx:18`.
- **Evidencia:** `mobile-item.png`, `browser.json` y medición por sección en `browser-supplement.json`.
- **Corrección propuesta:** adaptar el flujo a una grilla o disposición vertical en móvil. Resolver el acceso por teclado al desplazamiento en el componente compartido `TableRoot`, verificando tablas sin enlaces ni botones. No ocultar simplemente el contenido sobrante.

## Hallazgos P2

### TR-01 — Una entrega válida sin solicitud desaparece de «Buscar por código»

**Tipo:** PRODUCT BUG — búsqueda documental.

`findDocumentByCode` encuentra la entrega, pero el recorrido sólo conserva sus `requestItemId`. Si todos son nulos, la cadena queda vacía y se devuelve «no encontrado», incluso para un usuario con todos los permisos.

- **Ubicación:** `lib/services/document-chain.ts:171`, `:273` y `:433`.
- **Evidencia:** reproducción PGlite y búsqueda real de **ENT-2026-0002** en la copia local; `document-unlinked.png`.
- **Corrección propuesta:** conservar la entrega ancla como documento, con su control de permisos y faena, aunque no tenga eslabones anteriores. Mantener válido el flujo de salida libre de stock.

### TR-03 — Solicitudes rechazadas/canceladas siguen pendientes de compra

**Tipo:** PRODUCT BUG — indicadores y filtros.

El estado reconoce el cierre, pero el desglose de cantidades no lo recibe. Los KPIs y «Solo con pendientes» utilizan directamente ese desglose.

- **Ubicación:** `lib/services/trazabilidad-consolidated-calc.ts:109`; `lib/services/trazabilidad-consolidated-builder.ts:238` y `:294`.
- **Reproducción:** una solicitud rechazada y otra cancelada, 10 unidades cada una y sin compra: ambas conservan pendiente **10**, aportan **2** al KPI de compra y pasan el filtro de pendientes.
- **Corrección propuesta:** separar cantidades históricas de obligaciones pendientes. Excluir estados terminales del compromiso y de los KPIs accionables, sin borrar su historia.

### TR-04 — Una OC en borrador aparece como «Pedido a proveedor»

**Tipo:** PRODUCT BUG — estado operacional.

La consulta admite toda OC no cancelada y suma su cantidad a `inOc`; cualquier cantidad positiva produce «Pedido a proveedor». No distingue el borrador de la orden emitida/enviada.

- **Ubicación:** `lib/services/trazabilidad-consolidated-queries.ts:184`; `lib/services/trazabilidad-consolidated-calc.ts:78`.
- **Reproducción:** OC `draft`, sin emisión ni envío: estado `pedido_proveedor` e indicador «Esperando proveedor» **1**.
- **Corrección propuesta:** mantener visible la preparación en OC, diferenciándola del compromiso con el proveedor. Contrastar con la transición efectiva de `app/(app)/compras/actions/order-status.ts`.

### TR-05 — Los filtros de fecha consultan días UTC mientras la interfaz muestra días chilenos

**Tipo:** PRODUCT BUG — selección temporal y exportación.

Se comparan timestamps con literales sin zona horaria; la base local usa UTC. El formato visual usa `America/Santiago`.

- **Ubicación:** `lib/services/trazabilidad-consolidated-queries.ts:93`.
- **Reproducción para el 04-09-2026:** entra una solicitud de **03-09 a las 22:00 Chile** (`04-09 02:00Z`) y queda fuera otra de **04-09 a las 22:00 Chile** (`05-09 02:00Z`). El export utiliza el mismo pipeline.
- **Corrección propuesta:** convertir los límites del día civil chileno a instantes explícitos y usar un intervalo `[inicio, inicio del día siguiente)`, que además evita perder fracciones del último segundo.

### TR-08 — La búsqueda documental no informa que una entrega está anulada

**Tipo:** PRODUCT BUG — inconsistencia de evidencia.

La cadena no selecciona `voidedAt` ni el motivo; representa el estado de la entrega con su destino (`faena`/`worker`). El usuario no puede distinguir una entrega vigente de una anulada hasta abrir otra pantalla.

- **Ubicación:** `lib/services/document-chain.ts:275` y `:415`.
- **Reproducción:** `ENT-QA-VOID` aparece con `status: "faena"`, sin información de anulación, pese a estar formalmente anulada.
- **Corrección propuesta:** mantener el documento y exponer su anulación en el contrato de la cadena y en sus dos presentaciones.

### TR-07 — Se puede regularizar un caso de cascos con un ajuste de botas

**Tipo:** FUNCTIONAL FINDING — política de evidencia por definir; no se afirma creación indebida de stock.

La resolución comprueba que el movimiento sea un ajuste de la misma faena. No verifica producto, cantidad, sentido ni relación con la excepción. La prueba vincula un ajuste de **+1 bota** a un exceso de **10 cascos**, y el caso queda regularizado.

- **Ubicación:** `lib/services/traceability-integrity-cases.ts:206`.
- **Impacto:** el rótulo «ajuste compensatorio» puede sugerir una corrección material que la evidencia adjunta no respalda. La operación sólo agrega una resolución; no altera stock automáticamente.
- **Recomendación:** precisar si el ajuste debe compensar materialmente el caso o sólo aportar contexto. En el primer caso validar su relación; en el segundo mostrar esa naturaleza y reservar «compensatorio» para evidencia que la acredite. Conservar la opción explícita de reconocimiento sin movimiento.

### UI-01 — Siete KPIs sin acción desplazan el trabajo fuera de la primera pantalla

**Tipo:** UX FINDING / IMPROVEMENT OPPORTUNITY.

Hay siete tarjetas no accionables, incluyendo ceros, antes del selector de faena y de la lista. En el móvil de **390 × 844**, el primer registro comienza a **1026,6 px** del borde superior; el usuario todavía no ve trabajo al abrir la página.

- **Ubicación:** `app/(app)/bodega/trazabilidad/_components/consolidated-kpis.tsx:24` y `:87`.
- **Reglas:** `AGENTS.md` A1, A5 y prueba de comprensión en cinco segundos. Trazabilidad no es la excepción del dashboard.
- **Recomendación:** poner primero el contexto de faena, reducir a un máximo de cuatro indicadores accionables y llevar los secundarios a una fila compacta. Explicitar cuándo se cuentan solicitudes y cuándo ítems. Integrar los estados con el filtro para evitar controles redundantes.

### UI-04 — La exportación necesita feedback y una advertencia dentro del archivo truncado

**Tipo:** IMPROVEMENT OPPORTUNITY — exportación.

El botón es un enlace `download` dentro de los filtros, fuera de `PageHeader.actions`; no utiliza los componentes de exportación compartidos. El servicio limita a **2000 ítems por faena** y a **10000 filas globales**. El truncamiento se comunica por `X-Row-Limit-Applied`, pero el enlace no lee esa cabecera y el libro no incorpora una advertencia. La pantalla sí avisa cuando alcanza su límite.

- **Ubicación:** `app/(app)/bodega/trazabilidad/_components/consolidated-filters.tsx:137`; `lib/services/trazabilidad-export.ts:107`; `app/api/bodega/trazabilidad/export/route.ts`.
- **Recomendación:** reutilizar `ExportButton`/`ExportDialog`, ubicar la acción en el encabezado y añadir al libro el alcance, filtros, fecha de corte y advertencia de truncamiento. Verificar feedback de error/sesión vencida. La descarga normal filtrada sí se verificó y produjo un `.xlsx` válido.
- **Brecha:** no se generó un volumen de más de 2000 registros para comprobar el truncamiento en navegador.

### UI-05 — El bloque de integridad necesita separar faena, pendientes e historia

**Tipo:** IMPROVEMENT OPPORTUNITY — densidad y rendimiento.

La página carga todos los casos del alcance de la sesión antes de resolver la faena seleccionada. No hay paginación ni separación de resueltos, y cada caso abierto puede agregar un formulario completo encima de la lista. Los ajustes se consultan globalmente con un límite de 250 y después se filtran por faena en el cliente; una faena con ajustes antiguos puede quedarse sin opciones aunque sus ajustes existan.

- **Ubicación:** `app/(app)/bodega/trazabilidad/page.tsx:48`; `lib/services/traceability-integrity-cases.ts:239` y `:272`; componente `traceability-integrity-cases.tsx`.
- **Recomendación:** resumen de pendientes, faena y alcance explícitos; detalle/formulario bajo demanda; resueltos en historial paginado. Consultar ajustes por la faena/caso relevante antes de aplicar el límite. Reemplazar en la UI «snapshot» y «append-only» por lenguaje comprensible.
- **Brecha:** el escenario de muchos casos no se midió con carga; se trata de límites observados en las consultas y el render, no de una latencia demostrada.

## Evaluación de interfaz

Puntuación heurística sobre las superficies observadas; no certifica WCAG ni la confiabilidad del cálculo.

| Dimensión | Nota / 4 | Evidencia principal |
|---|---:|---|
| Accesibilidad | 2 | Contraste móvil y región desplazable sin acceso por teclado |
| Rendimiento | 3 | Consultas agrupadas y límites explícitos; casos/ajustes requieren acotación |
| Responsive | 2 | Lista y trabajador tienen tarjetas; el flujo del ítem desborda |
| Consistencia visual | 2 | Tokens compartidos junto a paletas locales; tema claro intencional |
| Integridad de implementación UI | 2 | Densidad de KPIs y exportación apartada del patrón común |
| **Total** | **11 / 20** | **Requiere mejoras importantes** |

El detector estático Impeccable devolvió **0 hallazgos**. No se interpreta como ausencia de problemas: el contraste y el desborde se confirmaron en el navegador. No se reporta la ausencia de modo oscuro como defecto; `DESIGN.md` define deliberadamente un tema claro.

## Qué sí se verificó

- Los permisos `warehouse:view_traceability` y `warehouse:reconcile_integrity` están declarados en el manifiesto, con navegación y acciones separadas. La visibilidad por faena del consolidado/export y del detalle de ítem tiene pruebas negativas existentes que pasaron.
- Consolidado con datos, expansión de fila en escritorio y tarjeta en móvil, apertura de filtros, búsqueda textual sin resultados y búsqueda documental de una solicitud existente.
- Excel filtrado descargado y abierto con ExcelJS: una hoja válida, dos filas en el caso observado — encabezado y registro.
- Detalle del ítem y hoja de vida del trabajador cargaron en ambos tamaños. Esta navegación con la sesión QA no sustituye la prueba de alcance restringido, realizada por separado sobre PGlite.
- Redirecciones legadas de lista, documento, ítem y trabajador; redirección de `/bodega/trazabilidad/documento`; cambio de pestaña conserva la faena explícita.
- Sin sesión, el proxy devuelve **307 a `/login`** para la descarga; no entrega el Excel. El primer 200 observado correspondía a seguir automáticamente esa redirección y no era acceso indebido.
- Un solo buscador textual visible en la lista: `/bodega` ya está en las exclusiones del TopBar. No hay evidencia de buscador duplicado.
- **0 errores de consola y 0 excepciones JavaScript** durante la navegación registrada. Hubo **9 fallos** `ERR_BLOCKED_BY_ORB` del avatar externo de DiceBear; se separan de los bugs de trazabilidad.

## Límites y próximos pasos

No se ejecutó MonkeyTest: `package.json` no expone `audit`, `audit:full` ni `audit:report`. Este es un informe manual con evidencia determinística y Playwright, no una salida atribuida a esa herramienta. No se ejecutó build de producción, prueba de carga, Safari ni UAT humana. Tampoco se cuantificaron registros afectados en producción ni se probaron mutaciones de integridad contra la copia local.

Priorizar autorización y cantidades (**TR-09/TR-10**), después el detector y las anulaciones (**TR-02/TR-06/TR-08**), y luego búsqueda, estados y fechas. Convertir las reproducciones en regresiones con resultados correctos al implementar cada arreglo. Mantener las salidas libres válidas y la historia de las resoluciones.

Para la interfaz: `$impeccable adapt` en el flujo del ítem, `$impeccable harden` para accesibilidad y exportaciones, `$impeccable distill` para KPIs/casos y `$impeccable polish` al finalizar. La priorización permite abordar estos cambios por separado o juntos; repetir la auditoría dirigida después de corregirlos.

## Evidencias y reproducción

- [Reproducciones determinísticas](../evidence/trazabilidad-2026-09-04/reproduce.audit.ts) y [resultado](../evidence/trazabilidad-2026-09-04/reproduce.log).
- [Script de navegador](../evidence/trazabilidad-2026-09-04/browser.mjs), [resultados y Axe](../evidence/trazabilidad-2026-09-04/browser.json) y [redirecciones/medición adicional](../evidence/trazabilidad-2026-09-04/browser-supplement.json).
- [Lista móvil](../evidence/trazabilidad-2026-09-04/mobile-list.png), [tarjeta expandida](../evidence/trazabilidad-2026-09-04/mobile-expanded.png), [detalle móvil](../evidence/trazabilidad-2026-09-04/mobile-item.png) y [entrega no encontrada](../evidence/trazabilidad-2026-09-04/document-unlinked.png).
- [Typecheck](../evidence/trazabilidad-2026-09-04/typecheck.log), [ESLint](../evidence/trazabilidad-2026-09-04/lint.log), [detector estático](../evidence/trazabilidad-2026-09-04/impeccable.json).

Desde la raíz del repositorio, con Node 22 disponible:

```bash
npm run test:fast -- lib/services/trazabilidad-consolidated.test.ts lib/services/traceability-integrity.test.ts lib/__tests__/trazabilidad-export.test.ts lib/__tests__/traceability-integrity-rbac.test.ts app/api/bodega/trazabilidad/export/route.test.ts app/api/trazabilidad/export/route.test.ts
npm run test:pglite -- lib/__tests__/trazabilidad-export-scope.test.ts lib/__tests__/trazabilidad-item.test.ts lib/__tests__/traceability-integrity-cases.test.ts lib/__tests__/document-chain.test.ts
bash scripts/run-resource-guard.sh node_modules/.bin/vitest run --config qa/evidence/trazabilidad-2026-09-04/vitest.config.ts --reporter=verbose
```

Para repetir la navegación se requiere la aplicación local en el puerto 3001 y una sesión QA vigente; el script valida la base de destino y no imprime credenciales:

```bash
bash scripts/run-resource-guard.sh node --env-file=.env.local qa/evidence/trazabilidad-2026-09-04/browser.mjs
```

Informe anterior conservado: [Auditoría TI del 03-09-2026](auditoria-ti-2026-09-03.md).
