# QA — La plataforma ya no se vuelve a montar al revalidar · 2026-09-24

## Alcance

Corrige el defecto que quedó abierto en `2026-09-24-documentos-generados-cloudreve.md`. Cada `router.refresh()` y cada Server Action que llama a `revalidatePath` o `revalidateTag` volvía a montar todo lo que está bajo `<body>`: shell, navegación y página.

Además del arreglo de causa, el cambio corrige las pantallas que funcionaban solo porque el remontaje les cerraba un diálogo, les limpiaba un formulario o les refrescaba una copia de datos del servidor.

No es una auditoría de toda la plataforma: el alcance son las pantallas que dependían del remontaje.

**Entornos usados**

- **E2E determinista:** build de producción en :3100 contra la base desechable `bodega_e2e` (contenedor :55432).
- **Recorrido asistido:** el mismo servidor, usuario administrador E2E, Chromium headless en escritorio 1440×900 y móvil 390×844.
- No se usó la base de desarrollo ni producción.

## Causa y arreglo de la capa compartida

- **Causa.** `AppShell` (`components/layout/app-shell.tsx`) y `Breadcrumbs` (`components/ui/page-header.tsx`) se exportaban como el objeto `React.memo` tal cual. El layout de `(app)` y las páginas, que son Server Components, los usan como referencia de cliente, y con esa forma React volvía a montar el árbol en cada revalidación.
- **Arreglo.** Ambos se exportan ahora como funciones que renderizan el `memo`.
- **Consecuencias que desaparecen:**
  - se perdía el estado de cliente;
  - el scroll del pozo volvía arriba;
  - los avisos que dependían del resultado de la acción no salían;
  - una respuesta tipeada mientras volvía el autoguardado de una inspección se perdía.
- **Regla fijada.** `lib/__tests__/client-memo-boundary.test.ts` falla si un Server Component renderiza un `memo` exportado por un módulo de cliente. Se comprobó en rojo sin el arreglo: lista las páginas que renderizan `Breadcrumbs`.
- **Regresión en navegador.** `e2e/shell-conserva-estado.spec.ts` marca un nodo del shell y uno de la página, guarda en Almacenamiento y exige que ambos sigan ahí. Sin el arreglo falla (`Received: 0`); con el arreglo pasa.
- **`useOperation`.** En modo mensaje, cuando quien llama pasa su propio `onSuccess`, el hook ya no guarda «Guardado correctamente.».
  - De 130 llamadas con callback de éxito, 117 cierran el diálogo que llamó. Nadie veía el aviso, que quedaba en el estado del padre, montado, y reaparecía sobre el formulario vacío al volver a abrirlo.
  - Antes el remontaje lo borraba, así que lo que se veía no cambia.
  - Los errores se siguen mostrando.
  - Prueba: `lib/__tests__/hooks-use-operation.test.tsx`.

## Pantallas que dependían del remontaje (corregidas)

Criterio: con la plataforma montada, después de una acción exitosa la persona veía algo incorrecto, o el envío siguiente mandaba un valor equivocado.

- **Bodega**
  - La hoja «Registrar movimiento» no se cerraba tras ajuste, conteo, baja, devolución ni stock mínimo, y quedaba sobre cantidades viejas. Ahora cada panel avisa y cierra la hoja dentro de su acción. Guardar el borrador del conteo no la cierra, a propósito.
  - La recepción de una guía partía, tras una recepción parcial, de lo pendiente viejo, y el botón quedaba bloqueado.
  - La celda de stock mínimo abría con el valor anterior si la hoja masiva lo había cambiado.
- **Incidentes (funcional).** Los formularios de evidencia, CAPA y clasificación DS 44 usan `Select` no controladas. El reinicio automático del formulario no las alcanza, así que el envío siguiente mandaba el valor del montaje mientras la pantalla mostraba otro. Por ejemplo, volver a guardar una persona «Incluida» la dejaba en «pendiente». Ahora cada formulario se vuelve a montar por versión después de un guardado exitoso.
- **CPHS.**
  - Tras incorporar a una persona, seguía elegida y el siguiente envío la volvía a agregar.
  - La sesión de una actividad no se releía al abrir.
- **Solicitudes.** Después de guardar un borrador, cambiar el tipo repetía «Borrador guardado» y borraba las cotizaciones adjuntadas desde entonces.
- **Entregas.** El efecto de éxito dependía de un `onSuccess` creado en cada render. Ahora que el efecto sí corre, habría repetido el aviso y el `router.refresh()` mientras la hoja anima su cierre. El éxito se atiende dentro de la acción.
- **Aprobaciones.** La barra en lote comparaba el texto del mensaje, así que una segunda aprobación con el mismo texto («2 solicitudes aprobadas») no avisaba ni limpiaba la selección. Ahora compara el resultado. Prueba: `bulk-approve-bar.test.tsx`, rojo sin el arreglo.
- **Facturación.** La sincronización quedaba apuntando a un proveedor que Chipax acababa de apagar o encender en la misma pantalla.
- **Compras.** Las recepciones que se sumaron para una factura quedaban marcadas para la siguiente. Ahora se vuelve a la recepción con que se abrió la pantalla.
- **Formularios que abrían con los valores del alta anterior**, y podían aplicarlos a otro registro:
  - Administración:
    - plantillas de atributo;
    - responsables y hojas del PDTP;
    - tipos documentales SST, que heredaban las actividades del PDTP que acreditan;
    - invitación y alta de usuarios;
    - importación de inventario de faena;
    - credenciales de Almacenamiento y DTE: el confirmador de borrar quedaba abierto y las casillas «Borrar…» deshabilitadas.
  - Prevención:
    - CAPA manual y controles de CAPA (por versión);
    - coordinación;
    - emergencias, EPP, gestión del cambio e higiene;
    - catálogo y detalle de inspecciones;
    - MIPER;
    - cobertura del PDTP, que volvía a ofrecer la fuente recién vinculada;
    - desvíos, edición en lote, ajustes por faena, planificación e importación del PDTP;
    - permisos.
  - Mantenciones: el alta conservaba el SLA oculto del registro anterior.
  - TI: asignaciones, devoluciones y mantenciones.
- **Combustibles.**
  - El diálogo del ciclo físico mostraba el éxito anterior al volver a abrirse.
  - Vehículos y proveedores despachaban su acción fuera de una transición; ahora usan `startTransition`, como `compras/[id]/invoices-section.tsx`.
- **Invitación sin SMTP.** El panel «Invitación pendiente», con el enlace para copiar, queda abierto hasta que el admin lo cierra. Antes el remontaje lo destruía apenas aparecía.

## Resultado

| Área | Resultado | Evidencia |
|---|---|---|
| El shell y la página se conservan tras una Server Action que revalida | PASS | `shell-conserva-estado.spec.ts` (rojo sin el arreglo, verde con él) + recorrido |
| Ningún Server Component renderiza un `memo` de cliente | PASS | `client-memo-boundary.test.ts` (rojo sin el arreglo) |
| La hoja de Bodega cierra y avisa en los 5 movimientos | PASS | `bodega-conteo-fisico.spec.ts` (4 casos) + recorrido en escritorio y móvil |
| Invitación sin SMTP: el enlace queda a la vista hasta cerrarlo; el formulario reabre vacío | PASS | `admin-flow.spec.ts` + recorrido |
| Vehículos: desactivar y reactivar se reflejan en su pestaña | PASS | `catalogs-migrated.spec.ts` |
| PDTP: objetivo nuevo visible; el preset se refleja en la matriz | PASS | `pdtp-objetivos.spec.ts`, `pdtp-planificacion-presets.spec.ts` |
| Acta de inspección tras el autoguardado | PASS | `prevencion-inspecciones-ejecucion-avanzada.spec.ts` en dos corridas completas |
| Aviso de éxito de `useOperation` | PASS | `hooks-use-operation.test.tsx` |
| Aprobación en lote repetida | PASS | `bulk-approve-bar.test.tsx` |

**Recorrido asistido**

- **Stock mínimo en línea con el pozo desplazado.** Ventana 1280×520; el pozo mide 625 px de alto y se ven 520. Guardar el mínimo conserva el scroll (105 → 105) y avisa «Stock mínimo actualizado a 9». Antes cada revalidación volvía a montar el pozo, y el pozo nuevo partía de arriba.
- **Hoja de Bodega, ajuste en escritorio.** La hoja se cierra, avisa «Ajuste AJU-2026-0001 registrado» y, al volver a abrirla, parte de la elección de movimiento.
- **Invitación sin SMTP.** El panel «Invitación pendiente» sigue abierto con el enlace y el botón «Copiar». Al cerrarlo la invitación aparece en la lista, y «Invitar» reabre con el formulario vacío.
- **Móvil 390×844.** El ajuste cierra la hoja, avisa y actualiza el stock y el kardex. No hay desborde horizontal.
- **Consola y red.** Sin errores de consola y sin respuestas 5xx.

**Suites**

- `test:e2e` completo: 722 pasan, 4 omitidas, 0 fallan.
  - Con solo el arreglo de causa, antes de corregir las pantallas, la misma suite daba 8 fallas: las pantallas de arriba.
- `test:fast`: 760 archivos, 9904 pruebas.
- `typecheck` y `lint` sin errores.
- `test:pglite` no se corrió: el cambio es de cliente y no toca servicios ni esquema.
- **Segunda tanda** (investigación de incidentes y formularios rechazados):
  - `typecheck` y `lint` sin errores;
  - `test:fast`: 761 archivos, 9909 pruebas;
  - suite Postgres de incidentes: 4 de 4;
  - e2e de incidentes, indicadores, CAPA, estados y densidad: 37 pasan y 1 omitida;
  - la suite e2e completa no se volvió a correr.

## Hallazgos

- **PRODUCT BUG (preexistente, corregido).** El remontaje de toda la plataforma en cada revalidación, con la causa y el arreglo descritos arriba.
- **PRODUCT BUG (preexistente, corregido).** La prueba inestable del acta de cierre de inspección, informada en el reporte anterior. El autoguardado revalida la ruta, el remontaje vaciaba el acta recién llenada, y el acta no forma parte del autoguardado. Sin remontaje el acta se conserva. No se agregó resincronización del borrador con las props, porque traería de vuelta el borrado.
- **TEST DEFECT (corregido).** Cuatro specs dependían del remontaje:
  - `admin-flow` esperaba la lista con el panel de invitación abierto;
  - `catalogs-migrated` esperaba volver a la pestaña «Activos»;
  - `pdtp-planificacion-presets` volvía a abrir un `<details>` que ahora sigue abierto;
  - `pdtp-objetivos` usaba un localizador por substring que también tomaba «Actividad sin objetivo E2E».
- **INCONSISTENCY (corregida).** Unos 30 comentarios de código y de specs explicaban comportamientos por «revalidar remonta el árbol». Se reescribieron como historia o con su razón actual. Los *workarounds* se dejaron: evitar revalidar la ruta del asistente de importación, o seguir desde la ficha del borrador. Siguen siendo inofensivos.
- **PRODUCT BUG (preexistente, corregido, ajeno al remontaje).** Volver a guardar la investigación de un incidente borraba lo ya registrado.
  - El formulario solo precargaba metodología y conclusiones, y el servicio guarda lo que recibe. Con un segundo guardado, por ejemplo para sumar una conclusión, se perdían:
    - las causas, los controles fallidos y el resumen de evidencia;
    - las marcas de MIPER, procedimiento y capacitación, con sus fechas;
    - el equipo, que quedaba reducido a quien guardaba;
    - la condición de completa, que volvía a «en curso».
  - Aunque las marcas se reenviaran, el servicio reescribía con la hora del guardado la fecha de cada una y la del cierre, y ponía como autor del cierre a quien guardaba.
  - **Ahora:**
    - el formulario precarga todo lo guardado y reenvía el equipo registrado;
    - el servicio conserva la fecha y el autor originales mientras la marca siga puesta;
    - la página pasa al panel una proyección explícita, así que las entrevistas cifradas (payload, IV y tag) ya no viajan al navegador.
  - **Evidencia:**
    - `prevention-incidents-postgres.test.ts` guarda de nuevo una investigación completa y exige las mismas fechas y el mismo autor; contra Postgres real falló en rojo antes del arreglo;
    - `incident-workflow-panel.test.tsx`;
    - recorrido: reportar, triage, investigar, recargar y volver a guardar.
- **PRODUCT BUG (preexistente, corregido).** Un guardado rechazado vaciaba el formulario en el panel de incidentes y en el diálogo de denominadores.
  - `<form action={fn}>` reinicia el formulario al terminar, también cuando el servidor lo rechaza. Se perdía lo tecleado, y las `Select` no controladas quedaban mostrando una opción mientras enviaban la del montaje.
  - Los 8 formularios del panel y el del denominador envían ahora con `onSubmit`, que no reinicia. Tras un éxito, la clave por versión vuelve a montar el formulario con lo guardado.
  - **Evidencia:**
    - pruebas nuevas en los dos componentes, rojas antes del arreglo;
    - recorrido: cerrar la investigación sin conclusiones es rechazado y conserva causas y motivo;
    - recorrido: dos pestañas crean el mismo mes y la segunda, rechazada, conserva sus cuatro valores.
- **UX FINDING (preexistente, corregido).** Indicadores respondía «No se pudo completar la acción. Intenta nuevamente.» a todo rechazo de negocio: edición concurrente, denominador en revisión, segregación de quien prepara y aprueba, período que no se puede cerrar. La persona no sabía que tenía que recargar ni por qué no podía aprobar.
  - **Causa.**
    - El 2026-07-15 el mensaje crudo del error, que podía filtrar SQL, se cambió por el genérico `unexpectedActionError`, y con eso se ocultaron también los motivos de negocio.
    - No se cambió el helper compartido, porque su contrato es justamente ocultar los `Error` comunes. `prevention-emergency-actions.test.ts` lo fija con el texto de un constraint de Postgres, que `safeActionMessage` dejaría pasar.
  - **Arreglo.**
    - Se siguió el contrato de emergencias y campañas: los 18 rechazos de negocio del servicio lanzan `SafetyIndicatorDomainError`, y las acciones devuelven su mensaje.
    - Los 4 errores que no deberían ocurrir (un `RETURNING` sin fila, una fecha interna inválida) siguen siendo comunes y siguen ocultos.
  - **Evidencia.**
    - `actions.test.ts` cubre las cuatro acciones y el error inesperado, que sigue oculto.
    - `prevention-indicators-postgres.test.ts` exige la clase de dominio en la creación concurrente y en revisión. Contra Postgres real falló sin el cambio del servicio.
- **FUNCTIONAL FINDING (preexistente, no corregido).** MIPER, requisitos legales, documentación y el mapa del CGRD también mandan todo a `unexpectedActionError` sin una clase de dominio. Es probable que sus rechazos de negocio se vean igual de genéricos. No se revisó uno por uno.
- **IMPROVEMENT OPPORTUNITY.**
  - Algunos altos conservan elecciones inofensivas: tipo de activo y periodicidad de licencia en TI, miembros y amenazas del CGRD, rótulo del QR de TAE.
  - Los diálogos de mensaje siguen sin aviso de éxito propio: el cierre es la señal.

## Brechas de cobertura

- El recorrido asistido cubrió Bodega (hoja y stock mínimo con scroll) e invitaciones. Las demás pantallas corregidas quedan cubiertas por la suite e2e donde tiene flujo, y por revisión de código y lint en las que no: la mayoría de los reinicios al abrir de Prevención y TI no tienen spec propia.
- No se ejecutó nada en producción.
