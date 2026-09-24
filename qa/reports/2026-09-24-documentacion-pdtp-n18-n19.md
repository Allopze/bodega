# QA — Documentación que acredita el PDTP (N°18 y N°19) · 2026-09-24

## Alcance

Verificación de la subida tipada de Documentación y de su efecto sobre el
programa preventivo:

- los registros externos quedan vigentes al cargarlos;
- la carpeta de requisitos legales (N°19) acredita el mes;
- una versión vigente del RIOHS abre la entrega a toda la dotación (N°18).

No es una auditoría de toda la plataforma ni del módulo completo.

- **Recorrido asistido de navegador:** local `http://localhost:3001` contra `bodega_dev`, usuario QA administrador global, Chromium headless con escritorio 1440×900 y móvil 390×844.
- **e2e determinista:** `e2e/prevencion-documentacion.spec.ts` sobre la base e2e desechable.

## Resultado

| Área | Resultado | Evidencia |
|---|---|---|
| "Subir documento" abre en modo clasificado; la carga masiva queda como modo explícito | PASS | Navegador + e2e (4/4) |
| Declarar una carta conductora anuncia vigencia inmediata y su efecto en la carpeta N°19 | PASS | Navegador: aviso "Quedará vigente al cargarlo" y resumen de la carpeta |
| La carta queda vigente al cargarla (`approval_mode = not_required`), sin aprobación | PASS | Navegador + e2e; la base registra la versión como `vigente / not_required` |
| Cargar otra vez el mismo tipo propone "Nueva versión de…" y reemplaza la vigente (v1 → reemplazado, v2 → vigente) | PASS | Navegador (segunda corrida) |
| Panel `?carpeta=requisitos-legales&faena=…` | PASS | Estado por requisito, alcance, documento, vencimiento y estado del mes (0 → 1 de 5 tras la carga) |
| "Cargar" desde un requisito faltante abre el diálogo con tipo y faena declarados | PASS | Después de la corrección UX-1 |
| Clasificar documento desde el detalle | PASS | Después de la corrección UX-1 |
| Vista móvil del panel | PASS | Sin desborde horizontal, después de la corrección UX-3 |
| Consola | PASS | Sin errores de consola |
| Red | PASS con advertencia | Sólo falla el avatar externo `api.dicebear.com` (ERR_BLOCKED_BY_ORB), preexistente y ajeno al cambio |
| Carpeta N°19, entrega N°18, huella firmada v19, compuerta de envío a revisión | PASS (determinista) | `pdtp-document-accreditation.test.ts` (17 PGlite) |
| Suites | PASS | `test:fast` 750 archivos; `test:pglite` 190/191 en la corrida completa y `prevention-pdtp.test.ts` 82/82 tras ajustar su fixture; `typecheck`, `lint`, `db:verify-migrations` |

## Hallazgos

- **UX-1 (corregido).** En "Cargar" desde la carpeta y en "Clasificar documento", el foco inicial del diálogo caía en el buscador de tipo, lo desplegaba y ocultaba el tipo ya declarado. Ahora el foco va al archivo o a la faena cuando el tipo viene declarado.
- **UX-2 (corregido, capa compartida).** `FileDropzone` mostraba siempre un ícono de Excel, también para un PDF. Se agregó la prop opcional `icon`; el valor por defecto no cambia.
- **UX-3 (corregido).** En móvil, el estado del mes era una frase dentro de un badge que no parte línea y se cortaba. Ahora es texto con el color de su tono.
- **AUTOMATION WARNING / entorno.** En `bodega_dev`, `storage.cloudreve.backend = cloudreve` apunta a `drive.portalchome.cl` con credenciales que dev no puede descifrar, así que toda subida falla con "No se pudo completar la acción". Para verificar se cambió temporalmente a `filesystem` y después se restauró. Aunque se pudieran descifrar, una subida desde dev escribiría en el Cloudreve real, así que dev debería usar `filesystem` de forma permanente.

## Datos de prueba

En `bodega_dev`, el programa `pdtp-2026-v2` está firmado y la carpeta no se puede declarar por el servicio. Para ver el panel se insertaron temporalmente cinco requisitos de la N°19 (`qa-verify-req-*`).

Al terminar se dejó todo como estaba:

- se borraron los cinco requisitos;
- se borraron la carta de prueba y sus dos archivos;
- se restauró el backend de almacenamiento.

Quedó aplicada en dev la migración `0327` y la taxonomía nueva (`db:apply-sst-taxonomy`).

## Brechas de cobertura

- **Entrega del RIOHS (N°18) en navegador.** Publicar un RIOHS exige tres personas distintas (carga, revisión, aprobación) y en dev no hay un programa en borrador. Solo la cubren las pruebas PGlite: obligación por faena a 30 días, asignación a la dotación, acuse más exención en lote que reportan la entrega, cancelación al reemplazarse la versión y caso a tiempo en el indicador. La tarjeta `[id]/riohs-rollout-card.tsx` no se recorrió.
- **Editor de la carpeta en el constructor PDTP.** Solo abre con el programa en borrador. Lo cubren pruebas de componente (`document-requirements-panel.test.tsx`); no hubo recorrido de navegador.
- **Acreditación mensual de la N°19 en navegador.** La carpeta de dev nunca llegó a 5 de 5. El barrido y el cierre por carga los cubren las pruebas PGlite.
- **Admin de taxonomía y enlace desde la bandeja de obligaciones.** No se recorrieron en navegador.
- **Producción.** No se ejecutó nada: el programa de prod sigue en borrador y el script `apply-pdtp-2026-legal-folder.ts` solo se probó en modo prueba contra dev, donde no escribe porque el programa está firmado.
