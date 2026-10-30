# Especificación · Módulo de mantención de equipos (Plataforma Chome)

> Copia de trabajo del prompt del 28-10-2026. Orden de precedencia: esta especificación → el prototipo
> `docs/mantencion/referencias/mantencion-chome-prototipo.html` → las convenciones del repositorio
> (`AGENTS.md`, `DESIGN.md`) → los valores por defecto de §19. Las decisiones y desviaciones ya tomadas
> están en `PLAN-modulo-mantencion.md` (raíz) y **mandan sobre este texto** donde difieren.

## 2. Contexto del negocio

- Chome registra hoy las mantenciones en 3 Google Forms; los datos no sirven para tableros.
- **Alexis Morales**: jefatura de mantención. **Francisco Amestica**: supervisor de la faena Biodiversa.
  Los **mecánicos** registran en terreno, a diario, desde **teléfonos personales**; se evalúa una **tablet compartida por faena**.
- Acuerdos 27-10-2026: (1) todos los campos y fotos son **obligatorios**; (2) la **firma de jefatura queda
  para una segunda etapa** (sólo el espacio para firmar a mano en el PDF; la pantalla no lo muestra porque ahí no hace nada); (3) módulo dentro de la plataforma,
  mecánicos con **cuenta propia**; (4) funciona **sin conexión** y sincroniza solo; (5) reportes **PDF y Excel**.
- Módulo **independiente** del de mantención antiguo (no modificarlo). Navegación: **Control operacional →
  Mantención** con **Panel, Registros, Equipos y Pautas**.

## 4. Alcance

Incluye: app del mecánico (PWA offline: preventiva, correctiva, estado en taller); jefatura (Panel, Registros
+ detalle, Equipos con ficha/alta/edición/importación, Pautas con editor y asignación); anular y observar;
Excel y PDF; carga inicial; auditoría; pruebas.
No incluye (dejar preparado): firma de jefatura, notificaciones push, integración con Bodega (repuestos son
texto con cantidad), costos.

## 5. Glosario

- **Equipo**: camión, tracto, cargador u otra máquina; código interno + patente; se mide en **km** (odómetro) o **h** (horómetro) según su tipo.
- **Pauta**: plantilla preventiva con unidad, intervalos y sistemas con ítems; matriz ítem × intervalo.
- **Intervalo base**: el menor intervalo de la pauta.
- **Regla por marca**: por ítem y marca, **A** aplica, **W** revisar (aviso «Confirmar con pauta del fabricante»), **X** no aplica (se oculta).
- **Preventiva**: checklist con Realizado / No realizado (con motivo) / No aplica. **Correctiva**: registro libre de una intervención de taller.
- **Folio**: correlativo legible que asigna el **servidor**.

## 6. Roles y permisos (siempre en el backend)

| Permiso (nombre real en el repo) | Mecánico | Supervisor de faena | Jefatura |
|---|:-:|:-:|:-:|
| `mant:app:use` registrar P/C y estado en taller | ✓ | ✓ | ✓ |
| `mant:records:view_own` | ✓ | ✓ | ✓ |
| `mant:records:view_worksite` (sólo sus faenas) | | ✓ | ✓ |
| `mant:records:view_all` | | | ✓ |
| `mant:records:observe` | | ✓ (su faena) | ✓ |
| `mant:records:review` (marcar revisado) | | | ✓ |
| `mant:records:void` | | | ✓ |
| `mant:equipment:manage` crear, editar, baja, importar, lecturas iniciales | | | ✓ |
| `mant:schedules:manage` crear, editar, asignar | | | ✓ |
| `mant:devices:manage` revocar credenciales de dispositivo | | | ✓ |
| `mant:export` Excel y PDF dentro de lo que puede ver | | ✓ | ✓ |

- Cada endpoint verifica permiso y alcance (faena) en el servidor. Ocultar un botón **no** es control de acceso.
- Un mecánico puede registrar en **cualquier equipo activo**; si es de otra faena, el registro queda con
  `out_of_worksite = true`, visible para jefatura.

## 8. Reglas de negocio (cada una con prueba unitaria)

1. **Lectura vigente**: la del registro `vigente` con mayor fecha de trabajo; sin registros, la lectura inicial. Los anulados no cuentan.
2. **Validación de lectura con fecha F**: ≥ la última vigente con fecha ≤ F y ≤ la primera vigente con fecha > F. El error dice qué lectura choca y de qué fecha.
3. **Salto de lectura**: aumento > 5.000 km o > 300 h, o > 1.500 km/día o > 24 h/día entre ambas fechas. El teléfono pide confirmación («Son 363.000 km más que la última vez. ¿Está bien?»); con confirmación se acepta y queda `reading_jump_alert = true`. El servidor recalcula la alerta.
4. **Pauta sugerida**: punto = max(b, round(L/b)×b); el **mayor** intervalo que divide exacto al punto, o b. 5.400 h → 900 h. Elegir otra pauta exige **motivo**; se guardan sugerida, usada y motivo.
5. **Ítems de una preventiva**: activos que aplican en el intervalo; regla por marca (X oculta, W avisa); marca fuera de tabla aplica todo; la marca es de lista cerrada.
6. **Estado de mantención** (servidor): `baja`, `sin_pauta`, `sin_lecturas`; si no, próxima = punto sugerido de la última preventiva vigente + b (sin preventivas: (piso(L/b)+1)×b); falta = próxima − lectura; `vencida` si falta ≤ 0, `proxima` si falta ≤ 15 % de b, `al_dia` si no. Más el intervalo de la próxima pauta.
7. **Preventiva duplicada**: misma pauta/intervalo y equipo, vigente, en los últimos 7 días o a menos de 10 % de b en lectura → aviso con enlace a la anterior; se puede continuar y se guarda la marca.
8. **Fotos obligatorias**: preventiva 1 de filtros + 1 del sticker; correctiva 1 a 3. Cada foto con **sello** dibujado (fecha, hora, código, patente). Se conserva el EXIF y la hora de recepción. En el detalle se advierte si sello y recepción difieren > 72 h sin período sin señal registrado.
9. **Correctiva obligatoria**: ≥1 tipo de trabajo, quién lo hizo, aceite (o «No se cambió aceite», excluyente), descripción ≥ 5; repuestos o «No se usaron repuestos»; horas 0,5–72 en pasos de 0,5 (aviso sin bloqueo > 12 h); si sigue en taller, fecha de ingreso; ≥1 conductor de las últimas 24 h.
10. **Otro mecánico**: «Registrado por X en nombre de Y» en detalle, PDF y Excel; filtros de jefatura distinguen «Hecho por» de «Registrado por».
11. **Equipo en taller**: una correctiva con `in_workshop` deja el equipo en taller hasta una actualización `salio`. Se pide actualizar cada 2 días; > 2 días sin actualización = «sin actualizar». Días detenido = ingreso → salida, o hasta hoy.
12. **Folio**: `M{P|C}-{CODFAENA}-{0000}` por faena y tipo, asignado por el servidor al recibir. En el teléfono, «Folio pendiente» hasta sincronizar.
13. **Anulación**: sólo jefatura, motivo obligatorio; sigue visible, marcado; se excluye de lecturas, estados y KPI; al anular se ofrece crear el registro corregido.
14. **Observación**: supervisor o jefatura comentan → `observado`; el mecánico lo ve en su inicio («1 registro observado») y responde (queda en la bitácora); jefatura puede marcar `revisado`.
15. **Cambios en pauta**: cada edición sube `version`; los firmados conservan su snapshot; quitar un ítem lo inactiva; un intervalo nuevo **hereda** la columna del mayor intervalo existente que lo divide (o la base) y queda resaltado «por revisar».
16. **Patente**: mayúsculas, sin espacios ni puntos, guion antes de los números; formatos `^[A-Z]{2}-?\d{4}$`, `^[BCDFGHJKLPRSTVWXYZ]{4}-?\d{2}$` y especiales del inventario; «Sin patente» explícito → la patente se muestra igual al código.
17. **Faena nueva**: si el nombre coincide normalizado con una existente («cholguán»/«Cholguan»), se usa la existente.

## 9. App del mecánico (PWA offline)

**Arquitectura**: ruta propia `/m/mantencion`, móvil primero, instalable (manifest, íconos, pantalla
completa). Service worker cachea el shell. **IndexedDB** guarda: catálogos del alcance (equipos activos de sus
faenas y los demás en una segunda carga liviana, pautas con versión, reglas por marca, talleres, conductores,
estado de mantención), borradores, **cola de envío** y **fotos como Blob** (nunca `localStorage`). Pide
`navigator.storage.persist()`. Fotos comprimidas a lado largo 1.600 px, JPEG 0,7, y selladas antes de
guardarse. **Sin espacio: se bloquea el guardado con mensaje claro; nunca se descarta una foto en silencio.**

**Sincronización**: al abrir, con `online`, cada 60 s con pendientes, Background Sync donde exista. Protocolo:
(1) `PUT` de cada foto (idempotente por id, sha256); (2) `POST` del registro con su id. Existente → 200 con el
mismo folio. Reintentos con backoff exponencial con tope. Respuesta con folio, hora de recepción y
advertencias. La foto local se borra **sólo** después de que el servidor confirma el registro completo.
Catálogos con `ETag`/`If-None-Match`; un borrador conserva su versión de pauta.

**Sesión y dispositivo compartido**: entra con su cuenta con señal; credencial de dispositivo de alcance
limitado (sólo sincroniza lo propio, 30 días, revocable, asociada a `device_id`). Sin conexión sólo si ya entró
en ese dispositivo. Tablet: «Cambiar de cuenta» lista las cuentas que ya entraron; cambiar sin señal exige el
**PIN local** de 4 dígitos (definido en su primer ingreso); cada elemento de la cola guarda su autor y se envía
con la credencial de ese autor. Cerrar sesión con pendientes avisa y **no** borra la cola.

**Pantallas** (replica el prototipo):
- **Inicio**: saludo, faena e indicador de señal **único, neutro, gris** (ámbar sólo con pendientes de > 24 h).
  «**Le toca mantención**» (vencidos y próximos de su faena: código y patente, «Toca la de 40.000 km · faltan
  141 km», etiqueta Vencida/Próxima) → abre la preventiva **en el paso 2 con el equipo elegido**. Botones
  grandes «Mantención preventiva» y «Mantención correctiva». Equipos en taller de su faena con «Actualizar
  estado». «Mis últimos registros» con estado de envío. Avatar con indicador para cambiar de cuenta.
- **Paso 1 · Equipo**: búsqueda por patente o código, filtro «Mi faena / Todas»; vencidos y próximos primero
  con etiqueta; sólo inventario.
- **Paso 2 · Lectura**: el tipo va en el título. Lectura con separador de miles mientras se escribe + unidad.
  Última lectura con su fecha. En preventiva, recuadro: «Lectura 40.312 km → toca la de 40.000 km (última
  preventiva: 20.000 km, 12-09-2026)»; otras pautas detrás de «Elegir otra pauta» con unidad, y elegir otra
  exige motivo. Fecha del trabajo, no futura.
- **Paso 3 · Pauta** (P): ítems por sistema con cabecera **sticky** y avance; botón «**Todo realizado en
  {sistema} (n)**»; corregir excepciones sin que la pantalla salte; «Listo · seguir con {siguiente}».
  Realizado / No realizado / No aplica; NR abre motivo con atajos (Falta repuesto, Sin herramienta, Requiere
  taller, Equipo en operación). Barra «n de N». No continúa con ítems sin marcar o sin motivo.
- **Paso 4 · Fotos** (P): 2 fotos con cámara trasera + notas obligatorias (atajo de un toque «Sin novedad»).
- **Paso 3 · Trabajo** (C): tipos de trabajo y aceites con **casilla visible** (múltiple), «No se cambió aceite»
  aparte y excluyente; quién hizo el trabajo (Yo / Otro mecánico / Taller externo); descripción; repuestos con
  cantidad (o «No se usaron»); horas con +/−; si sigue en taller y fecha de ingreso; conductores de las
  últimas 24 h con búsqueda por apellido.
- **Paso 4 · Fotos** (C): la foto del trabajo, en su propio paso como en la preventiva (antes cerraba el paso
  Trabajo, que llegaba a 2,5 pantallas). Los borradores guardados con los pasos viejos se reubican solos
  (`stepsVersion` en `lib/mantencion/client/flow-types.ts`).
- **Revisar**: resumen con «**Cambiar**» en cada dato → lleva al paso y **vuelve directo a Revisar** (si el
  cambio invalida un paso intermedio, se detiene ahí). Una acción: «Firmar y guardar», con «Firmas como
  {nombre}. Después de guardar no se puede editar».
- **Guardado**: folio (o «Folio pendiente») y estado del envío; «Volver al inicio» y «Registrar {la otra} en {código}».
- **Actualizar estado en taller**: hoja inferior con «Sigue en taller» (motivo obligatorio) o «Ya salió» (fecha).
- **Salir a medias**: «Salir» en la barra de cada paso. Diálogo propio con «Guardar y salir» como acción
  principal (el borrador ya se guarda solo y el inicio ofrece «Seguir/Descartar»), «Seguir registrando» y,
  aparte, «Descartar registro».

**Diseño para el trabajador**: táctiles ≥ 44 px (52–56 px acciones principales); texto 15–17 px; un solo
estilo de seleccionado (verde #1e6e3e, texto blanco); mensajes cortos en español de Chile; cero pasos innecesarios.

## 10. Vistas de jefatura (escritorio, con sidebar)

- **Panel**: filtros de período (7 días, 30 días, este mes, todo) y faena. KPI **clicables**: Registros (→
  Registros del período); Mantenciones vencidas (rojo con ícono si > 0; → Equipos filtrados por vencida);
  Equipos en taller (ámbar sólo si alguno sin actualizar); Horas hombre del período; **días fuera de servicio**.
  Gráfico registros por semana (apiladas P/C, tooltip, tabla «Ver datos»); estado de la flota en barras
  clicables; próximas mantenciones (tabla); en taller ahora; horas por faena; ítems que más quedan sin hacer
  con su último motivo. Tarjetas en dos columnas sin estirarse.
- **Registros**: indicadores con **rango de fechas visible** (registros, equipos en taller, ítems no
  realizados, mecánicos que registraron); filtros: faena, tipo, equipo, «Hecho por», «Registrado por»,
  desde/hasta, estado, revisión, alertas (salto de lectura, fuera de faena, pauta manual, duplicado); tabla
  paginada y ordenable; Exportar a Excel.
- **Detalle**: snapshot del equipo, lectura anterior, hora de firma y de recepción; pauta usada + «Elegida a
  mano» y motivo; resultado por sistema; fotos con **visor a pantalla completa** (zoom, flechas, Esc, sello
  visible); firma del mecánico; historial del equipo; acciones **Marcar revisado y
  siguiente** (principal), **Observar**, Descargar PDF, Exportar a Excel y **Anular** (según permiso), con
  «Anterior · N de M · Siguiente» sobre la misma lista filtrada; alertas como un aviso en tipo oración que dice
  qué pasó, qué hacer y enlaza a la foto o al dato.
- **Equipos**: orden por estado (vencida → próxima → al día → sin lecturas → sin pauta), encabezados
  ordenables; filtros búsqueda, faena, tipo, pauta, estado, «mostrar dados de baja»; aviso de equipos sin pauta
  con enlace; «Mostrar 50 más»; Exportar a Excel.
- **Ficha de equipo**: **modo lectura** (estado, ficha, registros, historial de cambios: fecha y autor en una
  línea, acción debajo). «Editar ficha» → formulario: faena de lista con «Nueva faena…» (regla 17); marca de
  lista cerrada; pauta filtrada por unidad; lectura inicial; activo o baja con motivo. Si código y patente
  coinciden, se muestra uno solo.
- **Agregar equipo**: mismo formulario; aparece en la app en la siguiente sincronización.
- **Importar** (equipos y lecturas iniciales): plantilla descargable; vista previa (válidas, con error y su
  motivo, cambios sobre existentes); confirmación y resumen; todo en el historial.
- **Pautas**: lista (unidad, intervalos, ítems, equipos, si tiene reglas por marca); «Nueva pauta» (vacía o
  copia) con nombre, unidad e intervalos. **Editor**: matriz ítem × intervalo con **encabezado fijo**; sistemas
  plegables; «+ Agregar ítem en {sistema}» y «Agregar sistema»; «Quitar» visible al hover/foco, separado de las
  casillas, con **Deshacer**; intervalos en fichas con Quitar y Deshacer; cambio de nombre en línea; tabla de
  **reglas por marca con símbolo en cada celda** (✓ / ! / —) y leyenda. Equipos que usan la pauta por faena +
  «Ver en Equipos». Eliminar pauta: diálogo que dice cuántos equipos quedan sin pauta. **Asignar equipos**
  (modal): filtros; lista **agrupada por faena** con casilla por grupo (incl. parcial); cada fila dice «Se
  agrega», «Cambia desde «X»» o «Quedará sin pauta»; pie «n seleccionados · a se agregan · b cambian · c quedan sin pauta».
- Acciones destructivas: **diálogo propio** con el verbo en el botón, o **Deshacer**. Nunca `window.confirm`.
- Fechas con el selector de la plataforma, dd-mm-aaaa.

## 11. API (rutas reales: ver `PLAN-modulo-mantencion.md`)

| Ruta | Uso | Permiso |
|---|---|---|
| `GET /api/mantencion/sync/catalogo` (ETag) | equipos del alcance, pautas, reglas, catálogos, estado | `mant:app:use` |
| `PUT /api/mantencion/sync/fotos/{id}` | foto idempotente; sha256, MIME, ≤ 10 MB | `mant:app:use` |
| `POST /api/mantencion/sync/registros` | idempotente por id, revalida §8, asigna folio | `mant:app:use` |
| `POST /api/mantencion/sync/taller` | actualización de taller idempotente | `mant:app:use` |
| `GET` listado y detalle de registros | filtros y paginación | `view_*` |
| anular / observar / revisar | jefatura | §6 |
| PDF de registro, Excel de registros/equipos/pautas/panel | exportaciones | `mant:export` |
| CRUD equipos + importación (preview/commit) | gestión | `mant:equipment:manage` |
| CRUD pautas, intervalos, ítems, matriz, reglas, asignación | gestión | `mant:schedules:manage` |

Fotos sólo por endpoint autorizado (nunca públicas). Un registro rechazado queda «Rechazado» en el teléfono
con motivo y opción de corregir y reenviar; **nunca se pierde**.

## 12. Exportaciones

- **Excel**: encabezado con estilo, fila 1 fija, autofiltro; **fechas como fecha real** (`dd-mm-aaaa hh:mm`);
  números como número; nombre de archivo con fecha. Libros: **Registros** (hojas «Registros», «Ítems de
  preventivas», «Repuestos», «Conductores», «Actualizaciones de taller»); **Equipos** (equipo, estado, lectura,
  próxima); **Pautas** (una hoja por pauta con matriz y reglas por marca); **Panel** (KPI y tablas con filtros).
- **PDF de un registro** (servidor, desde el registro firmado y su snapshot): encabezado Chome, folio, «página
  X de Y»; datos del equipo y registro; tabla completa de ítems con valor y motivo; fotos con sello; firma del
  mecánico, hora de firma y de recepción, espacio «Firma jefatura» para firmar a mano; «ANULADO» con motivo.
  Se guarda la primera vez y luego se entrega el mismo; se regenera sólo al anular.

## 13. Carga inicial

Script idempotente (`npm run db:seed:mantencion`) desde `db/seed/mantencion-seed.json`: faenas con código de
folio, tipos con unidad, marcas, 10 talleres, 27 conductores, tipos de trabajo, aceites, 2 pautas con matriz y
reglas («Camiones y tractos» km 10.000/20.000/40.000/80.000/160.000, 53 ítems; «Maquinaria pesada» h
300/600/900/1.200, 37 ítems), 120 equipos con pauta. Los 7 mecánicos son cuentas con rol Mecánico y su faena,
sin contraseñas en el repo (flujo de invitación). Si ya hay equipos, **conciliar por código** y reportar
diferencias, sin duplicar.

## 14. Diseño

Tokens Chome: verde #27894d (#1e6e3e para fondos con texto blanco), ámbar #ffd51e, naranjo #f39200, gris
#4b4f54, negro #1d1d1b, fondo #f5f7f6; títulos Exo, cuerpo Myriad Pro (Source Sans 3), metadatos Geist Mono.
Reutilizar componentes y tokens de la plataforma. Minimalismo editorial, retícula modular, aire; sin
glassmorphism, degradados, sombras pesadas ni exceso de tarjetas. Estados (siempre con texto o ícono): Vencida
#b42318/#fbe3dc, Próxima #c99a00/#fff3c4, Al día verde, Sin datos gris. Gráficos: preventiva #1e6e3e,
correctiva #f39200. AA: foco visible, teclado completo en jefatura, `aria-pressed`/`aria-expanded`, diálogos con
foco atrapado y Esc, alt en fotos, contraste ≥ 4,5:1. Fechas dd-mm-aaaa, miles con punto, decimales con coma,
unidades siempre visibles.

## 15. Seguridad y auditoría

Autorización y alcance por faena en el servidor, en cada endpoint y consulta. Bitácora (`recordAudit`) para:
creación de registros; anulación, observación y revisión; todo cambio de equipos, pautas, reglas y asignación;
importaciones; exportaciones (quién, qué y con qué filtros). Validación de entrada y salida. Fotos: límites de
tamaño y tipo, rechazo por *magic bytes*. Límite de tasa en sincronización. Credencial de dispositivo
revocable desde jefatura (lista por usuario). **Ningún secreto en código, seeds, logs ni documentación.**
Snapshots: un documento firmado no cambia si se edita el catálogo.

## 16. Pruebas

Suite completa (no filtrar por nombre). E2E **con estado y secuenciales**.
- **Unitarias**: reglas 1–17; sugerencia (5.400 h → 900 h); estado; folio concurrente (20 simultáneos sin
  repetir); normalización de patente y faena; herencia de columna.
- **API**: matriz de permisos (rol × endpoint), alcance por faena, idempotencia (3 envíos → 1 fila),
  revalidación en servidor, foto con sha256 que no coincide.
- **E2E**: (1) mecánico con señal desde «Le toca mantención», «Todo realizado», excepciones, «Cambiar», firma,
  folio; (2) sin conexión (`context.setOffline(true)`): correctiva con 3 fotos + actualización de taller,
  recarga, persisten; al volver la señal sincroniza sin duplicados; (3) tablet compartida: dos mecánicos sin
  señal con cambio por PIN; cada registro llega con su autor; (4) salto de lectura con confirmación y alerta en
  jefatura; (5) jefatura: panel y KPI, filtros, detalle con visor, Excel con fechas reales (abrirlo con una
  librería), PDF con páginas y folio, observar y anular (desaparece de cálculos); (6) equipos: alta, edición
  con faena nueva normalizada, importación con preview y baja; (7) pautas: copia, intervalo e ítem, quitar con
  Deshacer, asignar con resumen y la app usa la pauta nueva; (8) permisos UI y API.
- Consola de E2E sin errores.

## 17. Restricciones de código

Archivos ≤ 300 líneas objetivo, **500 límite estricto**. TypeScript estricto, sin `any` injustificado. Sin
dependencias nuevas si el repo ya resuelve la necesidad (justificar en el plan). Linter del repo. Todo texto
visible en español de Chile. Atajos «Demo» del prototipo (fotos de ejemplo, cambio de usuario sin contraseña,
control de señal, reinicio) **no** pasan a producción.

## Criterios de aceptación globales

Preventiva completa en < 3 minutos con y sin señal. Ningún registro ni foto se pierde (sin señal, recarga,
cierre de sesión, espacio lleno). Sin folios repetidos. Un documento firmado nunca cambia. Toda acción de
jefatura en la bitácora.
