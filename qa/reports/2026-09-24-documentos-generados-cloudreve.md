# QA — Documentos generados de Prevención → Cloudreve · 2026-09-24

## Alcance

Esta verificación cubre el archivado automático en Cloudreve de los documentos formales de Prevención, en el momento del hecho que los produce. No es una auditoría de toda la plataforma.

Los documentos archivados son:

- comprobante de entrega de EPP (registrada y anulada);
- informe de inspección (completada y revisada);
- acta SST, salvo el RE-28;
- cierre de período del PDTP, con una copia por versión;
- planilla RE-36 del programa que entra en vigencia, por faena;
- MIPER publicada;
- expediente de incidente cerrado, sin la hoja «Datos reservados».

Quedan fuera por decisión de Prevención la OC, la guía de despacho, el acta TI, las respuestas de privacidad y las exportaciones de listados.

**Entornos usados**

- **E2E determinista:** servidor de producción (`next build`) en :3100 contra la base desechable `bodega_e2e` (contenedor :55432). Sus credenciales de Cloudreve apuntan a un WebDAV en memoria (`e2e/fixtures/fake-webdav.ts`, 127.0.0.1:3198).
- **Recorrido asistido de navegador:** el mismo servidor y el mismo WebDAV falso, usuario administrador E2E, Chromium headless en escritorio 1440×900 y móvil 390×844.
- **No se usó la base de desarrollo ni el drive real.** La base de dev copia los ajustes de producción, incluida la cuenta real de Cloudreve, y sin la llave de entorno el archivado nunca se enciende ahí.

## Resultado

| Área | Resultado | Evidencia |
|---|---|---|
| Administración enciende el archivado, guarda carpeta y orden, y «Probar carpeta» informa | PASS | e2e `documentos-generados-cloudreve.spec.ts` + navegador |
| Una entrega de EPP deja `Documentos generados/Faena E2E/Comprobante de entrega ENT-… - registrada.pdf` (bytes `%PDF`) | PASS | e2e + navegador |
| Anular la entrega deja una copia aparte, `… - anulada.pdf`; la anterior no se pisa | PASS | Navegador (dos archivos en el WebDAV) + PGlite |
| El comprobante anulado muestra «Entrega anulada.» con motivo y fecha (antes no decía nada) | PASS | Navegador, captura `gd-02` |
| Con Cloudreve caído el documento queda «Por subir» con el motivo en palabras; «Reintentar» lo sube | PASS | e2e |
| Tarjeta en móvil sin desborde horizontal | PASS | Navegador, captura `gd-04` |
| Descargas PDF de entrega, SST e inspección siguen iguales (renderizador compartido) | PASS | e2e `pdf-exports`, `sst-pdf`, `prevencion-inspecciones-reportes-print`, `delivery-print`, `worker-delivery-flow` (25/25 en la corrida final) |
| Cola: encolado idempotente, no revierte el hecho, año en hora de Chile, concesión sin doble proceso, nunca pisa (sufijo « (2)»), PUT dudoso reconocido, reemplazada, PDF sin sesión fuera del cron, reintento con permisos | PASS | `generated-documents-archive.test.ts` (18, PGlite) |
| Cerrar el mismo mes dos veces: v1 reemplazada, v2 subida como `.xlsx` real armado desde la foto | PASS | `pdtp-period-closures.test.ts` (PGlite, armador real) |
| Solo las entregas con EPP se encolan; con el archivado apagado no se encola nada | PASS | `pdtp-epp-delivery-accreditation.test.ts` (PGlite) |
| Publicar una MIPER la encola por versión, y el libro archivado se arma con la matriz real, sin hoja de metadatos | PASS | `prevention-risk-legal-postgres.test.ts` (Postgres real, 19/19) |
| Completar y revisar una inspección dejan dos copias, cada una con la versión del run | PASS | `prevention-inspections-postgres.test.ts` (Postgres real, 90/90) |
| Cerrar un incidente lo encola una vez, y el expediente se arma con «Personas minimizadas» y sin «Datos reservados» | PASS | `prevention-incidents-postgres.test.ts` (Postgres real, 4/4) |
| Consola | PASS | Sin errores de consola |
| Red | PASS con advertencia | Solo prefetch RSC cancelados al navegar y el avatar externo `api.dicebear.com` (ERR_BLOCKED_BY_ORB), ya conocido y ajeno al cambio |

**Suites**

- `test:e2e` completo, con el arreglo del remontaje ya revertido: 719 pasan, 4 omitidas y 2 fallan.
  - La de `pdtp-habilitacion` quedó corregida (ver Hallazgos).
  - La de inspecciones es inestable (ver Hallazgos).
  - Repetidas 3 veces cada una después del arreglo: 30 de 30.
- `test:fast`: 757 archivos, 9896 pruebas.
- `test:pglite`: 192 archivos, 2289 pruebas.
- Postgres real: MIPER (19), inspecciones (90) e incidentes (4), con las aserciones de archivado.
- `typecheck`, `lint`, `db:verify-migrations` y `db:generate` («No schema changes»), además de `check:secrets`.

## Hallazgos

- **PRODUCT BUG (corregido, capa compartida).** Las rutas de PDF mandaban la cookie de sesión en todos los pedidos de la página, también a hosts ajenos. El comprobante de entrega carga el pictograma de cada familia de EPP desde una URL absoluta guardada en la base.
  - Ahora la cookie va solo a la plataforma, y los pedidos a otro origen se rehacen sin ella.
  - Dos alternativas probadas no funcionan:
    - Chromium ignora una cookie inyectada con `route.continue` y la página cae en /login.
    - `addCookies` rechaza la cookie `__Secure-…` sobre `http://127.0.0.1`, que es la de producción.
- **PRODUCT BUG (corregido).** La copia del acta SST en Documentación tenía tres defectos:
  - armaba el origen con el header Host, que controla el cliente;
  - salía sin márgenes ni pie numerado;
  - no revisaba si la página era el login.

  Ahora usa el mismo renderizador que la descarga. Ese renderizador exige la marca `data-print-ready` en la página y rechaza /login, /forbidden y /modulo-inactivo.
- **PRODUCT BUG (corregido).** Un comprobante anulado se imprimía igual que uno vigente. Ahora lleva el aviso «Entrega anulada».
- **PRODUCT BUG (preexistente, causa identificada, NO corregido en este cambio).** Cada `router.refresh()` y cada Server Action que llama a `revalidatePath` vuelve a montar la plataforma entera: todo lo que está bajo `<body>`, con el shell, la navegación y la página.
  - **Síntomas.** Se pierde el estado del cliente y los avisos que dependen del resultado de la acción. Por eso guardar en Administración › Almacenamiento no avisaba nada. Esa pantalla quedó corregida lanzando el aviso dentro de la acción, con el patrón de `admin/desviaciones`.
  - **Causa.** `AppShell` (`components/layout/app-shell.tsx`) se exporta como el objeto `React.memo` tal cual, y el layout de `(app)`, que es un Server Component, lo usa como referencia de cliente. Pasa lo mismo con `Breadcrumbs`.
  - **Cómo se aisló.** Con `next dev` contra la base desechable, reduciendo el layout pieza por pieza:
    - con los providers, `NavigationProgress` y el `Toaster` la página se conserva;
    - con `AppShell` se vuelve a montar;
    - con `AppShell` exportado como función que renderiza el `memo`, se conserva también en el build de producción.
  - **Por qué no se corrigió.** Con el arreglo aplicado, la suite e2e completa mostró 8 fallas: pantallas que funcionan solo porque el remontaje cierra sus diálogos o refresca datos que copiaron a estado.
    - La hoja «Registrar movimiento» de Bodega no se cierra tras ajuste, conteo, baja ni stock mínimo (4 casos de `bodega-conteo-fisico.spec.ts`). Sus paneles no avisan cuando terminan bien.
    - La edición de vehículos de combustible no refleja el nuevo estado (`catalogs-migrated.spec.ts`).
    - En el editor del PDTP, el objetivo recién creado no aparece en la tabla (`pdtp-objetivos.spec.ts`) y el preset aplicado no se refleja en la matriz (`pdtp-planificacion-presets.spec.ts`).
    - El diálogo de invitación con SMTP apagado queda abierto como «Invitación pendiente» y la lista queda fuera del árbol accesible (`admin-flow.spec.ts`).
    - Un barrido estático encuentra al menos 13 diálogos más que llaman acciones sin cerrarse de forma explícita, y no detecta los que lo hacen a través de paneles internos, como la hoja de Bodega.
  - Por eso se revirtió. Corregirlo es un cambio aparte: exportar `AppShell` y `Breadcrumbs` como funciones, cerrar cada diálogo al terminar bien, dejar de copiar props a estado, correr la suite e2e completa y hacer un recorrido asistido de las pantallas con formularios.
- **PRODUCT BUG (preexistente, corregido).** Las rutas de cron `ti-alerts` y `maintenance-reminders` no devolvían `ok`.
  - `scripts/cron-runner.mjs` daba cada corrida por fallida (`DTE_CRON_RUNNER_CONTRACT`, salida 1) aunque el trabajo se hubiera hecho, así que en el log del scheduler una falla real no se distinguía de una corrida buena. Se reprodujo con el runner real.
  - Una prueba de contrato en `scripts/__tests__/cron-runner.test.ts` revisa ahora todas las rutas que llama el runner. Se comprobó que falla sin el arreglo.
- **TEST DEFECT (preexistente, corregido).** `prevention-incidents-postgres.test.ts` fallaba en `addCapaEvidence`. Declaraba una evidencia `document` con texto libre (`evidencia-barrera-certificada`), que el contrato único de evidencia (P4, auditoría 2026-09-14) rechaza a propósito. La prueba ahora usa una ruta de evidencia con SHA-256; la validación no se tocó. Con eso el recorrido completo hasta el cierre vuelve a correr, ahora con la aserción de archivado.
- **TEST DEFECT (preexistente, corregido).** «crear trabajador» de `e2e/admin-flow.spec.ts` fallaba. El seed trae 32 trabajadores desde `5bb83f7b` (el CPHS de más de 25 personas) y el listado pagina de a 25, así que el nuevo caía en la página 2. Ahora se busca con el filtro de la barra.
- **TEST DEFECT (preexistente, corregido).** «el destino de una actividad de capacitación es el control anual» de `e2e/pdtp-habilitacion.spec.ts` fallaba en la suite completa por modo estricto: 19 encabezados coincidían con `name: "Capacitación"`.
  - `6d86986a` renombró la pantalla a «Campañas y Capacitación», y el localizador compara por substring. Por eso también tomaba cada actividad del control anual cuyo título dice «Capacitación…», que aparecen cuando otras specs ya dejaron datos.
  - Ahora apunta al `h1` con el nombre exacto.
- **AUTOMATION WARNING (inestable, preexistente).** «el acta de cierre valida firmas obligatorias…» de `prevencion-inspecciones-ejecucion-avanzada.spec.ts` falló una vez en la suite completa y pasó 3 de 3 corrida sola.
  - En la falla, el acta quedó vacía después del autoguardado («Sin declarar», firmas en blanco) y el diálogo de cierre desapareció.
  - Encaja con el remontaje descrito arriba, pero no se probó que sea esa la causa.
  - El cambio no toca ese camino: el archivado solo corre si completar la inspección termina bien, y acá no llegó a terminar.
- **AUTOMATION WARNING (entorno).** Correr varias suites Postgres a la vez sobre bases con historia da «out of shared memory» en `DROP SCHEMA … CASCADE`. Se corrieron de a una y con bases nuevas.

## Brechas de cobertura

- **Inspección, acta SST, RE-36 al activar, MIPER e incidente en navegador.** No se recorrieron de punta a punta; solo la entrega de EPP. El encolado de la inspección, la MIPER y el incidente queda probado contra Postgres real, y el de los cierres del PDTP en PGlite. El acta SST y la RE-36 al activar quedan cubiertas solo por tipado y por las suites de sus servicios, que siguen pasando.
- **Orden año › faena › módulo en navegador.** Solo PGlite.
- **Cron `generated-documents-archive`.** Cubierto por pruebas de la ruta y del contrato del runner. No se ejecutó el scheduler real de docker-compose.
- **Producción.** No se ejecutó nada. Al desplegar, el archivado queda apagado hasta que Administración lo encienda. Antes, la carpeta base en Cloudreve debe ser restringida.
