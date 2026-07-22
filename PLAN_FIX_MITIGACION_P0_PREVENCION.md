# Plan de fix y mitigación de los P0 de Prevención

**Plataforma:** Chome

**Fecha:** 18 de julio de 2026

**Documento de origen:** `AUDITORIA_MODULO_PREVENCION.md`

**Estado:** en ejecución

**Alcance:** P0-01 a P0-06 del módulo de Prevención, incluyendo mitigaciones operacionales, solución definitiva, migraciones, autorización, pruebas, despliegue y criterios de cierre.

**Nota de fuente (2026-07-22):** la fuente de verdad del PDTP es ahora `PROGRAMA ACTIVIDADES PREVENTIVAS DEL SG-SST (87 actividades).xlsx` (**87 actividades**, tras la quita total de N°4 y N°8; el archivo homónimo **sin** el sufijo fue un entregable degradado que no se adoptó). La mención al fixture `PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx` y a su SHA-256 `a6adc0fa…` en la bitácora de abajo es histórica (registro de una restauración) y se conserva sin alterar. Contraste y cambio: §2.0 de `PLAN_AJUSTE_INTEGRAL_PREVENCION_PDTP_SGSST_2026.md`.

---

## 1. Objetivo

Eliminar o contener los riesgos críticos detectados en Prevención sin presentar como evidencia legal datos, cierres o documentos que el sistema todavía no puede respaldar.

El plan debe conseguir cuatro resultados:

1. impedir cierres preventivos sin verificación;
2. impedir el uso oficial de indicadores incorrectos o sin fuente;
3. conservar evidencia documental aprobada, distribuida y trazable;
4. crear las fuentes de verdad de incidentes, riesgos, obligaciones y datos sensibles.

Este plan **no autoriza retirar SFTI**. SFTI seguirá siendo control compensatorio y fuente formal para los procesos que Chome todavía no cubre hasta que cada gate de sustitución quede aprobado.

---

## 2. Principios de ejecución

### 2.1 Mitigar antes de ampliar

Cada P0 tiene dos entregables diferentes:

- **mitigación:** reduce inmediatamente la exposición con el sistema actual;
- **fix definitivo:** crea el flujo y la fuente de verdad que permiten cerrar el hallazgo.

Una mitigación no cambia el estado del P0 a resuelto.

### 2.2 No convertir planillas manuales en evidencia automática

Los datos actuales de indicadores pueden conservarse como antecedentes históricos, pero no deben transformarse silenciosamente en eventos individuales. Todo backfill debe marcar procedencia, nivel de conciliación y responsable de validación.

### 2.3 No retirar SFTI por módulo completo

El corte se hará por capacidad concreta:

- incidentes y denuncias;
- MIPER;
- control documental;
- indicadores;
- información sensible.

Cada capacidad exige paridad, migración, operación paralela y aceptación propia.

### 2.4 Migraciones aditivas y reversibles

- Cambiar primero `db/schema/**`.
- Ejecutar `npm run db:generate` para producir una migración nueva.
- No editar migraciones ya creadas.
- No editar `db/migrations/meta/_journal.json` manualmente.
- Usar `db:migrate`, nunca `db:push`, sobre bases con historia.
- Ejecutar nuevamente `npm run db:generate` y exigir “No schema changes”.
- Mantener columnas/tablas anteriores durante la convivencia.
- Eliminar estructuras antiguas solo en una fase posterior y con migración propia.

### 2.5 Autorización negativa como criterio de cierre

Todo endpoint nuevo o modificado debe probar:

- rol autorizado en faena autorizada;
- rol autorizado en faena ajena;
- rol sin permiso en faena propia;
- usuario sin faenas;
- identificador inexistente;
- mutación concurrente;
- acceso directo sin pasar por la interfaz.

No se cerrará un P0 solo con pruebas de camino exitoso.

### 2.6 Fuente única y auditoría

- Toda transición crítica debe registrar actor, fecha, estado anterior, estado nuevo, comentario y alcance.
- Las cifras deben navegar hasta sus registros fuente.
- Los cierres deben ser idempotentes y resistentes a concurrencia.
- Ningún dato sensible debe vivir en JSON genérico o en una carpeta común sin política explícita.

---

## 3. Resumen ejecutivo de los P0

| P0 | Riesgo | Mitigación inmediata | Fix definitivo | Dependencia principal |
|---|---|---|---|---|
| P0-01 | Indicadores legales incorrectos o no conciliables | Ocultar tasas como oficiales, bloquear cierres y marcar exportaciones | Eventos canónicos + horas/dotación + motor DS 44 + recálculo histórico | P0-04 |
| P0-02 | Trabajo/caso cerrado sin verificar corrección | Guard server-side y bloqueo de cierre/reinicio | Máquina de estados + CAPA común + evidencia + verificación | Fundación CAPA |
| P0-03 | Versiones publicadas sin aprobación ni acuse demostrable | No reemplazar versión vigente al subir; restringir publicación | Workflow documental, distribución nominada, acuse y auditoría | P0-06 |
| P0-04 | Sin registro fuente de incidentes ni control de denuncias | Mantener SFTI y registro formal externo; conciliación diaria | Módulo de incidentes, DIAT/DIEP, investigación y CAPA | P0-06 y CAPA |
| P0-05 | PDTP puede omitir riesgos u obligaciones | Mantener MIPER/registro legal externos y prohibir declarar cobertura total | MIPER + registro legal + trazabilidad hacia PDTP | P0-04 para aprendizaje |
| P0-06 | Exposición de datos clínicos o reservados | Prohibir carga en biblioteca común; inventariar y restringir | Dominio sensible, mínimo privilegio, acceso auditado y retención | Bloquea P0-03/P0-04 |

---

## 4. Dependencias y orden obligatorio

```text
Gobierno + feature flags + inventario
│
├── P0-06 Privacidad y segregación
│   ├── P0-03 Control documental
│   └── P0-04 Incidentes y denuncias
│       ├── P0-01 Indicadores legales definitivos
│       └── P0-05 Actualización de MIPER por incidentes
│
├── Fundación CAPA
│   ├── P0-02 PPA seguro
│   ├── P0-04 Investigación de incidentes
│   └── P0-05 Controles y brechas de riesgo/legal
│
└── P0-05 MIPER + registro legal
    └── PDTP derivado y verificable
```

### Secuencia de entrega

1. **Ola 0:** mitigaciones operacionales y técnicas.
2. **Ola 1:** privacidad, permisos sensibles y CAPA común.
3. **Ola 2:** hardening de PPA y control documental.
4. **Ola 3:** registro canónico de incidentes y denuncias.
5. **Ola 4:** indicadores derivados y recálculo.
6. **Ola 5:** MIPER, registro legal e integración con PDTP.
7. **Ola 6:** operación paralela y cortes parciales desde SFTI.

P0-02 puede liberarse antes que CAPA completo mediante un guard transitorio, pero no se considerará cerrado hasta integrarse al modelo común.

---

## 5. Ola 0 — Mitigación inmediata

**Ventana objetivo:** primeros 2 a 3 días hábiles desde el inicio de la remediación.

**Responsables:** jefatura de Prevención, responsable técnico, administrador de plataforma y asesoría legal/privacidad.

### M-00 — Mantener SFTI como control compensatorio

- [ ] Comunicar que SFTI sigue siendo la fuente formal para incidentes, DIAT/DIEP, MIPER, vigilancia/salud y expedientes sensibles.
- [ ] Designar responsable de conciliación entre SFTI y Chome.
- [ ] Documentar qué dato se registra en cada plataforma durante la convivencia.
- [ ] Prohibir doble cierre con resultados contradictorios.
- [ ] Crear registro de discrepancias con responsable y fecha de resolución.

**Salida:** instrucción aprobada por jefatura de Prevención y visible para usuarios de faena.

### M-01 — Contener indicadores incorrectos

- [x] Deshabilitar el cierre de nuevos períodos mediante un toggle persistente en `system_settings`.
- [x] Ocultar “tasa de frecuencia” y “tasa de gravedad” o rotularlas inequívocamente como no oficiales mientras usan la fórmula actual.
- [x] Agregar marca “datos manuales no conciliados con registro de incidentes” en pantalla y Excel.
- [x] Impedir que un valor con `horasHombre = 0` aparezca como tasa cero; debe mostrarse “no calculable”.
- [ ] Inventariar períodos cerrados y exportaciones emitidas.
- [ ] Abrir una revisión formal de los períodos históricos potencialmente afectados.

**Salida:** ningún usuario puede confundir la tasa actual con la definida por el DS 44.

### M-02 — Contener el bypass de PPA

- [x] Agregar guard server-side a `closePpa`.
- [x] Bloquear cierre si existe acción en estado distinto de `verificada` o `cerrada`.
- [x] Bloquear autorización de reinicio mientras una corrección esté pendiente.
- [x] Para un caso rechazado, exigir motivo de cancelación o retorno a corrección; no usar `cerrado` como sinónimo de “resuelto”.
- [x] Ocultar el botón de cierre cuando el guard vaya a rechazar la transición.
- [ ] Auditar PPA ya cerrados que tengan acciones incompletas.

**Salida:** cero cierres nuevos con acciones pendientes, probado también por llamada directa al server action.

### M-03 — Contener publicación documental

- [x] Cambiar la carga de nueva versión para que nazca como `borrador`.
- [x] Mantener `currentVersionId` apuntando a la versión vigente anterior.
- [x] No marcar la versión anterior como `reemplazado` durante una simple carga.
- [x] Restringir temporalmente publicación y archivos sensibles a jefatura/administración.
- [x] Inventariar documentos donde el documento esté `borrador` y la versión `vigente`, o donde falte aprobador.
- [x] Publicar una lista de documentos que no pueden usarse como evidencia hasta ser regularizados.

**Salida:** cargar un archivo no lo publica ni reemplaza automáticamente la evidencia vigente.

### M-04 — Mantener registro formal de incidentes fuera de Chome

- [ ] Confirmar responsable de recepción de reportes 24/7 o durante la jornada aplicable.
- [ ] Mantener DIAT/DIEP y seguimiento en SFTI/proceso vigente.
- [ ] Mantener copia de denuncias y notificaciones según política aprobada.
- [ ] Registrar en Chome únicamente un identificador de referencia no sensible mientras no exista el dominio seguro.
- [ ] Reconciliar diariamente incidentes conocidos, denuncias emitidas y estados.
- [ ] Escalar de inmediato accidentes fatales/graves conforme al procedimiento corporativo vigente.

**Salida:** ningún incidente depende del módulo futuro para ser denunciado o atendido.

### M-05 — Mantener MIPER y registro legal externos como fuente formal

- [ ] Identificar documento vigente, versión, fecha y aprobador por faena.
- [ ] Identificar registro legal y evaluación de aplicabilidad vigentes.
- [ ] Adjuntar solo copias controladas o enlaces, sin afirmar que PDTP representa cobertura total.
- [ ] Agregar al PDTP un aviso de fuente externa y fecha de última conciliación.
- [ ] Designar responsable de mapear manualmente riesgos críticos y obligaciones hacia actividades PDTP.

**Salida:** todo PDTP activo declara qué MIPER y registro legal externos lo sustentan.

### M-06 — Contener datos sensibles

- [x] Prohibir cargas clínicas, resultados de vigilancia, alcohol/drogas y casos Ley Karin en la biblioteca preventiva común.
- [x] Inventariar archivos sensibles ya cargados, accesos y descargas.
- [x] Reducir permisos mientras se clasifica cada caso.
- [ ] Mover información a repositorio aprobado mediante procedimiento trazable, sin borrado irreversible inicial.
- [x] Revocar enlaces públicos o accesos amplios que puedan existir.
- [x] Activar revisión diaria de auditoría durante la contención.

**Salida:** no quedan datos clínicos o de denuncia disponibles mediante permisos preventivos generales.

---

## 6. Fundación transversal — CAPA común

### 6.1 Objetivo

Unificar las acciones correctivas/preventivas que hoy viven separadas en:

- `pdtpActionPlan`;
- `sstActionPlan`;
- `ppaCorrectiveActions`;
- futuros incidentes;
- futuros riesgos y requisitos legales.

### 6.2 Modelo objetivo

Crear un dominio común, con nombres definitivos acordados antes de generar migración:

- acción;
- fuente (`sourceType`, `sourceId`);
- faena;
- descripción;
- causa o hallazgo;
- medida inmediata;
- acción definitiva;
- responsable `userId`;
- responsable alterno/rol solo para asignación pendiente;
- prioridad;
- fecha objetivo;
- estado;
- evidencia exigida;
- completado por/en;
- verificado por/en;
- evaluación de eficacia;
- reabierto por/en y motivo;
- historial de transiciones;
- seguimientos y adjuntos.

### 6.3 Máquina de estados

```text
pendiente → en_proceso → pendiente_verificacion → verificada → cerrada
                    ↑              │
                    └── reabierta ←┘
```

Reglas:

- creador y verificador no pueden ser la misma persona en criticidad alta, salvo excepción auditada;
- no hay transición directa de `pendiente` a `cerrada`;
- cambiar responsable, plazo o prioridad genera historial;
- la evidencia es obligatoria según tipo/criticidad;
- una acción vencida genera notificación y escalamiento;
- cerrar la fuente no cierra automáticamente la acción.

### 6.4 Estrategia de convivencia

1. Crear CAPA común de forma aditiva.
2. Agregar referencias desde los modelos actuales.
3. Escribir nuevas acciones en CAPA común.
4. Mantener lectura de acciones históricas durante la transición.
5. Migrar registros existentes con identificador de origen.
6. Conciliar conteos, estados, responsables y evidencias.
7. Cambiar pantallas a la fuente común.
8. Retirar escrituras antiguas.
9. Eliminar tablas antiguas en una migración futura independiente.

### 6.5 Criterios de aceptación

- [x] Una acción puede rastrearse hasta su fuente.
- [x] Una acción no puede cerrarse sin transición y evidencia requeridas.
- [x] Se conserva el historial de las acciones PDTP, SST y PPA migradas.
- [x] Los responsables son usuarios reales o quedan explícitamente “sin asignar”.
- [x] La faena se valida en cada lectura y mutación.
- [x] Los contadores del dashboard provienen de CAPA común.

---

## 7. P0-02 — Fix definitivo del PPA

### 7.1 Problema a corregir

`reviewPpa` puede cambiar un PPA detenido a `autorizado` y crear a la vez una acción `pendiente`. `closePpa` permite luego cerrar por el estado del PPA sin comprobar implementación, evidencia ni verificación.

### 7.2 Estado objetivo

```text
aprobado_auto

detenido → en_correccion → pendiente_verificacion → autorizado → cerrado
    │              │                 │
    └→ rechazado/cancelado           └→ en_correccion (si verificación falla)
```

Definiciones:

- `autorizado`: los controles fueron implementados y verificados; el trabajo puede iniciar o reiniciar.
- `rechazado`: el trabajo no está autorizado.
- `cancelado`: la tarea no se ejecutará; contiene motivo y actor.
- `cerrado`: el caso terminó con trazabilidad completa, no solamente con una decisión.

### 7.3 Cambios de datos

- Agregar timestamps y actores para corrección, verificación, autorización, cancelación y cierre.
- Reemplazar responsable libre por `responsibleUserId`; conservar el texto histórico como snapshot.
- Enlazar la acción PPA a CAPA común.
- Agregar evidencia y comentario de verificación.
- Agregar historial de transición del PPA.
- Revisar el índice único que limita a una acción por PPA; permitir varias si el proceso lo requiere.

### 7.4 Cambios de servicio y UI

- Separar “solicitar corrección”, “declarar corrección”, “verificar”, “autorizar”, “cancelar” y “cerrar”.
- Ejecutar cada transición en transacción con condición sobre estado actual.
- Usar lock o actualización condicional para impedir dobles revisiones.
- Mostrar en detalle la línea de tiempo, evidencia y responsable.
- No presentar “Autorizar” antes de una verificación satisfactoria.
- Añadir notificaciones a responsable, verificador y escalamiento por vencimiento.
- Incluir estado y trazabilidad en Excel.

### 7.5 Permisos

- `ppa:view`
- `ppa:review`
- `ppa:correct`
- `ppa:verify`
- `ppa:authorize_restart`
- `ppa:cancel`
- `ppa:close`
- `ppa:manage`

`authorize_restart`, `verify` y `close` no deben quedar implícitos en un permiso general.

### 7.6 Backfill

- Clasificar PPA abiertos por estado y acción.
- Reabrir administrativamente los cerrados con acción no verificada.
- Mapear responsables de texto a usuario cuando exista coincidencia inequívoca.
- Dejar responsables no conciliados en cola de asignación manual.
- Conservar snapshot del estado original y actor del backfill.

### 7.7 Pruebas obligatorias

- [x] No autoriza con acción pendiente.
- [x] No cierra con acción pendiente, en proceso o esperando verificación.
- [x] Rechazo de verificación retorna a corrección.
- [x] Cancelar exige motivo.
- [x] Una llamada concurrente solo produce una transición.
- [x] Rol sin `ppa:verify` no verifica aunque tenga acceso a la faena.
- [x] Usuario con permiso no opera sobre faena ajena.
- [x] La UI oculta acciones y el server action también las rechaza.
- [x] El Excel refleja estados y fechas reales.

### 7.8 Cierre del P0-02

- [ ] Cero PPA cerrados con CAPA sin verificar.
- [ ] Cero autorizaciones de reinicio anteriores a la verificación.
- [ ] Backfill conciliado al 100 % de los PPA abiertos y cerrados con acción.
- [x] Prueba negativa rol × faena × endpoint aprobada.
- [ ] Jefatura de Prevención acepta la semántica de todos los estados.

---

## 8. P0-03 — Fix definitivo del control documental

### 8.1 Problema a corregir

El esquema ya contiene versiones, aprobadores, acuses y enlaces, pero el flujo operativo no los ejecuta. Una carga crea la versión como `vigente`, cambia `currentVersionId` y reemplaza la anterior sin aprobación.

### 8.2 Máquina de estados de versión

```text
borrador → en_revision → observado → borrador
                     └→ aprobado → vigente → reemplazado
```

Reglas:

- una carga siempre nace en `borrador`;
- `currentVersionId` apunta solamente a la versión publicada vigente;
- aprobar no publica si la fecha efectiva es futura;
- publicar una versión y reemplazar la anterior ocurre en una transacción;
- una versión observada conserva comentario y revisor;
- no se modifica el binario de una versión existente;
- el checksum forma parte de la evidencia del acuse.

### 8.3 Distribución y acuse

La tabla `sst_document_acks` registra quién acusó, pero falta el denominador de personas obligadas. Crear distribución nominada por versión con:

- versión;
- destinatario usuario/trabajador;
- causa de asignación;
- faena/cargo/empresa de origen;
- fecha de asignación;
- fecha límite;
- estado pendiente/acusado/exento;
- exención, actor y motivo;
- recordatorios enviados.

El contador pendiente debe ser:

> destinatarios activos asignados a la versión − acuses válidos − exenciones justificadas.

### 8.4 Acciones y permisos

Acciones:

- enviar a revisión;
- observar;
- aprobar;
- publicar;
- retirar publicación;
- distribuir;
- acusar recibo;
- vincular/desvincular;
- reemplazar;
- archivar/restaurar.

Permisos separados:

- `prevention:docs:submit_review`
- `prevention:docs:review`
- `prevention:docs:approve`
- `prevention:docs:publish`
- `prevention:docs:distribute`
- `prevention:docs:ack`
- `prevention:docs:link`

Los permisos de confidencialidad actuales siguen aplicando además del permiso de acción.

### 8.5 Integridad y segregación

- El aprobador no debe ser el uploader cuando el tipo requiere segregación.
- Documentos sensibles no pueden distribuirse por reglas masivas generales.
- Un destinatario accede solo a la versión asignada y vigente.
- El enlace a una entidad valida existencia y alcance de la entidad.
- El acuse firma versión, checksum, usuario, momento, método, IP y user agent.
- Un nuevo documento aprobado no borra acuses de versiones anteriores.

### 8.6 Backfill

Construir un informe de inconsistencias:

- documento `borrador` con versión `vigente`;
- versión vigente sin aprobador;
- `currentVersionId` que apunta a versión no vigente;
- dos versiones vigentes del mismo documento;
- versión reemplazada sin sucesora;
- documento que exige acuse sin distribución;
- enlaces a entidades inexistentes;
- confidencialidad incompatible con audiencia.

Cada fila se resuelve mediante una acción administrativa auditada. No corregir estados masivamente sin guardar antes/después y responsable.

### 8.7 Pruebas obligatorias

- [x] Subir versión no cambia la versión vigente.
- [x] Publicar reemplaza exactamente una versión en una transacción.
- [x] Uploader no aprueba cuando se exige segregación.
- [x] Observación exige comentario.
- [x] Acuse corresponde a versión/checksum exactos.
- [x] El contador pendiente usa destinatarios reales.
- [x] Un usuario no acusa por otra persona.
- [x] Documento sensible no aparece a roles generales.
- [x] Acceso de faena ajena falla por UI y endpoint.
- [x] Fallo de escritura/DB no deja binario huérfano o estado publicado parcial.

### 8.8 Cierre del P0-03

- [ ] 100 % de documentos vigentes con aprobador y versión coherente.
- [ ] 100 % de documentos con acuse requerido tienen distribución nominada.
- [x] Dashboard de acuses conciliado con detalle nominativo.
- [x] Todos los bypass de publicación identificados en el checkout están cerrados server-side.
- [x] Expediente exportable demuestra revisión, aprobación, publicación y acuses.

---

## 9. P0-06 — Fix definitivo de privacidad y datos sensibles

### 9.1 Objetivo

Preparar la plataforma para tratar datos de salud, vigilancia ocupacional y denuncias sin exponer diagnósticos o antecedentes reservados a roles operacionales.

### 9.2 Clasificación obligatoria

| Clase | Ejemplo | Acceso esperado |
|---|---|---|
| Operacional | inspección de equipo | roles de faena autorizados |
| Personal | identificación/contacto | mínimo necesario por función |
| Sensible preventivo | exposición individual | prevención/salud autorizados |
| Clínico | examen, diagnóstico | salud ocupacional y roles expresamente habilitados |
| Investigación reservada | Ley Karin/testigos | equipo investigador delimitado |
| Secreto de cliente | composición/proceso | contrato y faena autorizados |

### 9.3 Diseño de dominio

- Crear tablas y servicios separados para salud/vigilancia; no usar `extraMetadata` documental.
- Mantener diagnóstico y resultado clínico fuera de vistas operacionales.
- Exponer a supervisión únicamente aptitud, restricciones necesarias, vigencia y emisor autorizado.
- Aplicar permisos por propósito, empresa y faena.
- Registrar cada lectura, descarga y cambio sensible.
- Definir cifrado de campos/archivos y gestión de llaves.
- Definir retención, bloqueo legal, archivo y eliminación verificable.
- Definir atención de acceso, rectificación, supresión, oposición, portabilidad y demás derechos aplicables.
- Definir procedimiento de incidente de seguridad y notificación.
- Alinear diseño con la Ley 21.719 antes de su entrada en vigencia el 1 de diciembre de 2026.

### 9.4 Permisos sensibles

- `prevention:health:view_restrictions`
- `prevention:health:view_clinical`
- `prevention:health:manage_surveillance`
- `prevention:health:upload_clinical`
- `prevention:reserved_case:view`
- `prevention:reserved_case:investigate`
- `prevention:privacy:audit`
- `prevention:privacy:export_subject`

No otorgar estos permisos mediante roles preventivos generales.

### 9.5 Inventario y remediación histórica

- Buscar archivos, metadatos, comentarios, logs y exports con datos sensibles.
- Clasificar cada registro con dueño y finalidad.
- Revisar quién accedió y si el acceso fue adecuado.
- Reubicar mediante procedimiento auditable.
- Revocar copias y enlaces no necesarios.
- Aplicar retención sin destruir evidencia que deba conservarse.
- Registrar excepciones legales y contractuales.

### 9.6 Pruebas obligatorias

- [x] Supervisor ve restricción necesaria, no diagnóstico.
- [x] Prevencionista general no ve expediente clínico.
- [x] Usuario de otra faena/empresa no infiere existencia del caso.
- [x] Exportaciones respetan clasificación y minimización.
- [x] Toda lectura sensible genera auditoría.
- [x] Auditoría no almacena el contenido clínico completo.
- [x] Respaldo y restauración conservan cifrado y permisos.
- [x] Derechos del titular pueden ejecutarse sin romper retenciones obligatorias.

### 9.7 Cierre del P0-06

- [ ] Inventario histórico completado y firmado.
- [ ] Cero datos clínicos/denuncias en biblioteca general sin excepción aprobada.
- [ ] Matriz de roles y finalidades aprobada.
- [x] Pruebas negativas de inferencia y acceso aprobadas.
- [ ] Evaluación jurídica y de seguridad acepta la preparación para Ley 21.719.

---

## 10. P0-04 — Registro canónico de incidentes y denuncias

### 10.1 Alcance mínimo legal y operacional

Tipos de evento:

- incidente o suceso peligroso;
- accidente del trabajo;
- accidente de trayecto;
- presunta enfermedad profesional;
- daño material;
- daño ambiental/derrame;
- evento vehicular;
- afectación a contratista o tercero.

### 10.2 Modelo mínimo

**Evento:**

- identificador/código;
- tipo y estado;
- empresa y faena;
- fecha/hora de ocurrencia y conocimiento;
- lugar;
- relato inicial;
- reportante;
- personas involucradas;
- proceso/tarea/turno;
- vehículo/equipo/residuo/sustancia cuando corresponda;
- gravedad real y potencial;
- medidas inmediatas;
- suspensión/evacuación;
- fuente y procedencia.

**Persona/lesión:**

- trabajador/identificación controlada;
- empleador;
- sexo para desagregación exigida;
- tipo de relación;
- lesión y parte afectada;
- ausencia igual o superior a jornada normal;
- días de ausencia;
- días de cargo;
- resultado/calificación del organismo administrador.

**Denuncia/notificación:**

- DIAT/DIEP;
- plazo calculado desde conocimiento;
- organismo administrador;
- fecha de emisión/envío;
- responsable;
- copia/evidencia;
- estado y observaciones;
- notificación fatal/grave a DT/SEREMI cuando corresponda;
- autorización de reinicio.

**Investigación:**

- equipo investigador;
- metodología;
- entrevistas y evidencia;
- causas inmediatas, básicas y organizacionales;
- controles fallidos;
- conclusiones;
- CAPA;
- verificación de eficacia;
- actualización de MIPER/procedimiento/capacitación.

### 10.3 Estados

```text
reportado → triage → medidas_inmediatas → en_investigacion
         → pendiente_capa → pendiente_verificacion → cerrado
```

Carriles adicionales no sustituyen el estado principal:

- atención médica;
- denuncia DIAT/DIEP;
- notificación fatal/grave;
- calificación;
- autorización de reinicio.

### 10.4 Alertas y plazos

- Contador de 24 horas para DIAT desde conocimiento del accidente.
- Contador de 24 horas para DIEP desde conocimiento de presunta enfermedad.
- Escalamiento inmediato para fatal/grave según procedimiento aplicable.
- Recordatorios previos al vencimiento y alerta crítica al superar el plazo.
- El sistema registra y controla la presentación; no debe declarar integración automática con autoridad/organismo si no existe interfaz oficial implementada y validada.

### 10.5 UI mínima

- Reporte rápido móvil y offline.
- Bandeja de triage.
- Detalle con línea de tiempo.
- Panel de denuncias/plazos.
- Investigación guiada.
- CAPA.
- Autorización de reinicio.
- Vista reservada de datos personales/salud.
- Excel de expediente y registro legal.

### 10.6 Permisos

- `prevention:incidents:report`
- `prevention:incidents:view`
- `prevention:incidents:triage`
- `prevention:incidents:investigate`
- `prevention:incidents:notify`
- `prevention:incidents:authorize_restart`
- `prevention:incidents:close`
- `prevention:incidents:view_sensitive`
- `prevention:incidents:export`

### 10.7 Importación desde SFTI

1. Definir export disponible y diccionario de campos.
2. Guardar archivo fuente y hash.
3. Importar a staging, no directamente a producción lógica.
4. Detectar duplicados por identificadores y atributos.
5. Resolver trabajadores/faenas/empresas.
6. Conservar valor original y valor normalizado.
7. Conciliar conteos por tipo, año, faena y estado.
8. Muestrear expedientes con Prevención.
9. Aprobar lote.
10. Recién entonces activar los registros importados.

### 10.8 Pruebas obligatorias

- [x] Evento reportado offline sincroniza una sola vez.
- [x] Hora de conocimiento genera deadline correcto.
- [x] DIAT/DIEP atrasada escala y no se oculta por cerrar el evento.
- [x] Fatal/grave exige medidas, notificación y autorización de reinicio.
- [x] Incidente de contratista mantiene empresa y faena.
- [x] Datos sensibles no aparecen en vistas generales.
- [x] Cierre exige investigación/CAPA según clasificación.
- [x] Un cambio posterior conserva historial.
- [x] Importación es idempotente y conciliable.
- [x] Rol × faena × endpoint negativo aprobado.

### 10.9 Cierre del P0-04

- [ ] 100 % de eventos nuevos se registran en la fuente canónica.
- [ ] 100 % de DIAT/DIEP tienen deadline, responsable y evidencia.
- [x] Indicadores pueden navegar a eventos y personas fuente.
- [x] Investigación y CAPA están conectadas.
- [ ] Operación paralela con SFTI no muestra pérdidas ni duplicados críticos.
- [ ] Jefatura de Prevención autoriza el corte de esta capacidad.

---

## 11. P0-01 — Indicadores legales derivados y conciliables

### 11.1 Separar numeradores y denominadores

**Numeradores:** derivados de P0-04.

- personas lesionadas;
- accidentes del trabajo;
- ausencias iguales o superiores a una jornada normal;
- días de ausencia;
- días de cargo;
- incidentes y daños clasificados.

**Denominadores:** fuente mensual controlada.

- dotación del período;
- horas trabajadas;
- procedencia: RR.HH., importación o carga manual aprobada;
- responsable, fecha y evidencia;
- estado de conciliación.

### 11.2 Fórmulas a implementar

**Tasa de accidentabilidad:** accidentes/accidentados definidos para el período validado por cada 100 personas trabajadoras, con período no superior a un año.

**Tasa mensual de frecuencia:** personas lesionadas incluidas por cada 1.000.000 de horas trabajadas.

**Tasa semestral de gravedad:** días de ausencia más días de cargo por cada 1.000.000 de horas trabajadas.

La interpretación final de casos incluidos, accidentes versus accidentados y días de cargo debe quedar aprobada por Prevención con casos de prueba basados en instrucciones oficiales. No se codificará una decisión jurídica solamente desde nombres de columnas antiguas.

### 11.3 Comportamiento obligatorio

- Cero horas: indicador “no calculable”, no cero.
- Numerador sin horas: error de conciliación.
- Eventos no calificados: mostrar resultado provisional y pendiente.
- Cambio de calificación: recalcular y auditar.
- Período cerrado: corrección solo con permiso, motivo e historial.
- Exportación: mostrar fórmula, período, fecha de cálculo y procedencia.
- Drill-down: cada numerador abre los eventos que lo componen.
- Desagregación por sexo conforme al DS 44, protegiendo grupos pequeños.

### 11.4 Estrategia para `safety_indicators`

No sobrescribir historia sin trazabilidad.

- Mantener filas actuales como snapshot manual legado.
- Agregar estado `manual_legacy`, `reconciled` o equivalente.
- Crear tabla/fuente de denominadores mensuales.
- Calcular indicadores legales desde incidentes + denominadores.
- Guardar snapshots de cierre con versión de fórmula y hash de fuente.
- Generar reporte de diferencia entre valor legado y valor recalculado.
- Habilitar aprobación del recálculo por período.

### 11.5 Casos dorados mínimos

- [x] 2 personas lesionadas / 200.000 HH = frecuencia 10,00.
- [x] 5 días de ausencia + 6 días de cargo / 200.000 HH = gravedad 55,00.
- [x] 2 casos incluidos / 100 trabajadores = accidentabilidad 2,00.
- [x] 0 HH produce “no calculable”.
- [x] Un accidente sin ausencia mínima no entra donde la regla legal lo excluye.
- [x] Un cambio de calificación actualiza el período y deja historial.
- [x] Suma por faena no duplica una persona/evento.
- [x] Semestre usa los seis meses correctos y no un promedio de tasas mensuales.

### 11.6 Superficie técnica afectada

- `lib/prevention/safety-indicators-calc.ts`
- `lib/services/prevention-indicadores*`
- `db/schema/prevention/safety-indicators.ts`
- `app/(app)/prevencion/indicadores/**`
- `app/api/prevencion/indicadores/export/route.ts`
- pruebas de cálculo, dashboard, actions y exportación.

### 11.7 Cierre del P0-01

- [ ] Fórmulas aprobadas con casos dorados.
- [x] Numeradores derivados del registro canónico.
- [x] Denominadores tienen fuente y aprobador.
- [x] Todos los períodos históricos tienen estado de conciliación.
- [x] Excel y UI usan el mismo motor.
- [x] Ningún valor no calculable se muestra como cero.
- [ ] Prevención firma el informe de diferencias y recálculo.

---

## 12. P0-05 — MIPER, registro legal e integración con PDTP

### 12.1 MIPER mínimo

Jerarquía:

```text
empresa → faena → proceso → tarea → puesto de trabajo
```

Por versión:

- metodología y versión de metodología;
- peligro/factor;
- evento o daño esperado;
- personas expuestas;
- consideración de sensibilidad y género;
- evaluación inherente;
- controles existentes;
- jerarquía de controles;
- control crítico y estándar de desempeño;
- riesgo residual;
- responsable;
- evidencia;
- participación/consulta;
- revisor y aprobador;
- vigencia y motivo de revisión.

No se debe hardcodear una matriz genérica como única metodología. Debe soportarse la guía ISP aplicable y metodologías especiales exigidas por agente o riesgo.

### 12.2 Disparadores de revisión

- revisión anual;
- cambio de condición de trabajo;
- accidente del trabajo;
- enfermedad profesional;
- riesgo grave e inminente;
- nueva sustancia/residuo/equipo/proceso;
- hallazgo de auditoría o control crítico fallido;
- cambio legal aplicable.

Cada disparador crea tarea, responsable y plazo. El histórico no se sobrescribe.

### 12.3 Registro legal mínimo

- fuente normativa/contractual;
- artículo/requisito;
- versión y vigencia;
- tema;
- rol de Chome;
- aplicabilidad por empresa/faena/actividad;
- fundamento;
- responsable;
- evidencia requerida;
- frecuencia;
- evaluación de cumplimiento;
- hallazgo/CAPA;
- revisión y aprobación.

El software puede controlar el proceso, pero el contenido y la aplicabilidad deben ser validados por Prevención y asesoría jurídica.

### 12.4 Integración con PDTP

Crear relación explícita de origen para cada actividad/medida:

- control MIPER;
- requisito legal;
- incidente/CAPA;
- auditoría;
- objetivo interno;
- obligación contractual.

Reglas:

- actualizar MIPER genera alerta para actualizar el programa dentro de 30 días corridos;
- riesgo crítico sin control/programa produce blocker visible;
- requisito aplicable sin evidencia produce brecha;
- actividad PDTP sin fuente se permite solo como objetivo interno justificado;
- cerrar una actividad no cierra el requisito ni reduce el riesgo automáticamente;
- la evaluación anual del PDTP revisa eficacia, no solo ejecución.

### 12.5 Migración desde documentos externos/SFTI

- Importar versiones como lotes inmutables.
- Conservar archivo fuente y hash.
- Mapear procesos, tareas, puestos y faenas.
- Evitar deduplicar peligros solo por nombre.
- Resolver controles y responsables manualmente cuando la equivalencia no sea inequívoca.
- Aprobar versión importada antes de hacerla fuente vigente.
- Generar informe de cobertura PDTP por riesgo/requisito.

### 12.6 Permisos

- `prevention:risk:view`
- `prevention:risk:edit`
- `prevention:risk:review`
- `prevention:risk:approve`
- `prevention:risk:publish`
- `prevention:legal:view`
- `prevention:legal:assess`
- `prevention:legal:approve_applicability`
- `prevention:legal:export`

### 12.7 Pruebas obligatorias

- [x] Publicar versión no altera la anterior.
- [x] Revisión anual y disparadores crean tarea.
- [x] Riesgo crítico sin control aparece en dashboard.
- [x] Riesgo de faena no es visible/modificable desde otra faena.
- [x] Requisito no aplicable exige fundamento y aprobación.
- [x] Actualización MIPER inicia reloj de 30 días para PDTP.
- [x] Toda medida PDTP navega a su fuente.
- [x] Importación conserva original, normalización y decisiones.
- [x] Matriz publicada es exportable en Excel con evidencia de aprobación.

### 12.8 Cierre del P0-05

- [ ] 100 % de procesos/puestos activos tienen versión MIPER vigente.
- [ ] 100 % de riesgos críticos tienen controles y verificación.
- [ ] 100 % de requisitos aplicables tienen dueño/evidencia/estado.
- [ ] PDTP vigente declara cobertura y brechas respecto de MIPER/legal.
- [x] Disparadores de revisión fueron probados de extremo a extremo.
- [ ] Prevención, línea de mando y representación de trabajadores aceptan la versión.

**Estado técnico al 18 de julio de 2026:** capacidad P0-05 implementada y probada en el checkout local. El cierre regulatorio permanece abierto porque la base local no contiene matrices, procesos, puestos, requisitos ni vínculos productivos que permitan afirmar los cuatro porcentajes de cobertura, y falta la aceptación humana indicada arriba. Chome no debe retirar todavía la fuente MIPER/legal externa ni presentar cobertura total hasta ejecutar importación, conciliación y aceptación en producción.

---

## 13. Plan de releases

### Release R0 — Contención

Contenido:

- feature flags;
- guard PPA;
- tasas no oficiales ocultas/rotuladas;
- cierre de indicadores deshabilitado;
- carga documental sin autopublicación;
- avisos operacionales y restricciones sensibles.

Gate:

- mitigaciones M-00 a M-06 aprobadas;
- smoke test en producción;
- comunicación emitida;
- rollback probado.

### Release R1 — Privacidad y CAPA

Contenido:

- clasificación y permisos sensibles;
- auditoría de accesos;
- CAPA común;
- migración inicial PDTP/SST/PPA.

Gate:

- pruebas negativas;
- backfill conciliado;
- revisión de seguridad y privacidad.

### Release R2 — PPA y documentos

Contenido:

- máquina de estados PPA;
- verificación/cierre;
- workflow documental;
- distribución y acuses;
- regularización histórica.

Gate:

- cero bypass;
- expediente probatorio completo;
- aceptación de usuarios de faena.

### Release R3 — Incidentes

Contenido:

- reporte/triage;
- DIAT/DIEP;
- investigación;
- CAPA;
- reinicio;
- importación SFTI;
- móvil/offline.

Gate:

- operación paralela;
- conciliación;
- simulacro fatal/grave;
- plazos y escalamiento probados.

### Release R4 — Indicadores

Contenido:

- motor legal;
- denominadores;
- snapshots;
- recálculo histórico;
- Excel y dashboard.

Gate:

- casos dorados;
- informe de diferencias;
- aprobación de Prevención.

### Release R5 — MIPER y legal

Contenido:

- MIPER versionada;
- mapa/cobertura inicial;
- registro legal;
- integración PDTP;
- migración SFTI/documentos externos.

Gate:

- cobertura completa de población priorizada;
- riesgos críticos sin brecha no justificada;
- aprobación participativa y legal.

### Release R6 — Cortes parciales desde SFTI

Cada capacidad se corta por separado. No hay “big bang”.

Gate común:

- paridad funcional;
- histórico migrado;
- conteos conciliados;
- operación paralela aprobada;
- usuarios entrenados;
- soporte y rollback disponibles;
- firma de dueño de proceso.

---

## 14. Estrategia de despliegue y rollback

### 14.1 Feature flags sugeridos

Persistidos en `system_settings` y gestionados con permiso administrativo:

- `prevention_indicators_official_enabled`
- `prevention_indicators_period_close_enabled`
- `ppa_verified_close_required`
- `prevention_docs_workflow_enabled`
- `prevention_incidents_enabled`
- `prevention_risk_register_enabled`
- `prevention_sensitive_domain_enabled`

Los defaults seguros deben ser restrictivos. Si falla la lectura del setting, no se habilita el comportamiento riesgoso.

**Decisión vigente después de P0-01:** los toggles `prevention_indicators_official_enabled` y `prevention_indicators_period_close_enabled` sirvieron sólo durante la contención y fueron retirados del código al quedar sin consumidores. No se expondrán en administración: el estado oficial y la posibilidad de cierre dependen exclusivamente de eventos canónicos, denominadores aprobados, conciliación, snapshot/hash y permisos de cierre. Conservar o administrar un interruptor paralelo reintroduciría el bypass regulatorio que el fix definitivo eliminó. Los toggles de capacidades futuras sólo se implementarán junto con un consumidor real y un gate que no pueda degradar controles legales.

### 14.2 Despliegue

1. Backup y prueba de restauración.
2. Migración aditiva.
3. Deploy con feature apagada.
4. Verificación de schema, permisos y salud.
5. Backfill en lotes idempotentes.
6. Informe de conciliación.
7. Habilitación en una faena piloto.
8. Observación y corrección.
9. Expansión gradual.
10. Activación general.

### 14.3 Rollback

- Apagar feature sin eliminar datos.
- Volver lectura a fuente anterior.
- No revertir migración destructivamente durante incidente.
- Conservar escrituras nuevas para reconciliación.
- Documentar ventana, causa y registros afectados.
- Reanudar solo después de análisis y prueba de corrección.

---

## 15. Observabilidad y alertas

Métricas mínimas:

- intentos rechazados de cerrar PPA;
- PPA esperando corrección/verificación y vencidos;
- publicaciones documentales fallidas;
- documentos/versiones inconsistentes;
- acuses pendientes por población;
- incidentes sin triage;
- DIAT/DIEP próximas a vencer o vencidas;
- eventos sin investigación/CAPA;
- accesos sensibles por rol/faena;
- rechazos de autorización;
- períodos sin denominadores conciliados;
- diferencias entre indicador legado y recalculado;
- riesgos críticos sin control;
- requisitos aplicables sin evidencia;
- MIPER que exige actualización de PDTP.

Toda alerta crítica debe tener dueño, canal, tiempo de atención y escalamiento.

---

## 16. Matriz de pruebas y evidencia de cierre

| Capa | Evidencia exigida |
|---|---|
| Cálculo | unit tests con casos dorados y bordes |
| Servicio | integración DB con transacciones, locks y estados inválidos |
| Server actions/API | autenticación, permiso, faena y validación |
| UI | flujo principal, estados vacíos, errores y acciones ocultas |
| E2E | recorrido real por rol y faena |
| Migración | idempotencia, conteos, checksums y rollback lógico |
| Seguridad | acceso negativo, inferencia, exportación y auditoría |
| Operación | piloto, conciliación y aceptación del dueño del proceso |
| Legal | matriz de obligación → control → evidencia validada |

Comandos de verificación base:

```bash
npm test -- --run <pruebas-focalizadas>
npm run lint
npm run typecheck
npm run db:generate
npm run build
git diff --check
```

Para cambios de esquema:

- probar migración sobre copia representativa;
- verificar constraints e índices;
- ejecutar `npm run db:generate` nuevamente y exigir cero cambios;
- verificar el mismo flujo contra Postgres real, no solo mocks.

---

## 17. Roles de decisión

| Decisión | Responsable que aprueba |
|---|---|
| Fórmulas y casos incluidos | Jefatura de Prevención + asesoría legal |
| Semántica de PPA y reinicio | Jefatura de Prevención + Operaciones |
| Aprobación/distribución documental | Dueño del SG-SST |
| Flujo DIAT/DIEP y fatal/grave | Prevención + asesoría legal |
| Metodología MIPER | Profesional competente de Prevención |
| Aplicabilidad legal | Prevención + asesoría legal |
| Clasificación/retención sensible | Privacidad/legal + seguridad TI |
| Migración y corte SFTI | Dueño de proceso + TI + usuarios piloto |
| Aceptación técnica | Responsable técnico |

El equipo de desarrollo implementa reglas aprobadas; no define por sí solo aplicabilidad legal, metodología preventiva ni acceso clínico.

---

## 18. Estimación relativa

La estimación depende de disponibilidad de Prevención, calidad de los históricos SFTI y definición de privacidad. Se usa tamaño relativo para no convertir incertidumbre normativa/datos en una fecha ficticia.

| Frente | Tamaño | Principal incertidumbre |
|---|---:|---|
| Ola 0 — mitigaciones | S | inventario histórico y comunicación |
| CAPA común | M | migración de tres modelos actuales |
| P0-02 PPA | M | semántica operacional de autorización/reinicio |
| P0-03 documentos | M/L | regularización y denominador de distribución |
| P0-06 privacidad | L | clasificación histórica y arquitectura de cifrado |
| P0-04 incidentes | XL | DIAT/DIEP, offline, históricos e investigación |
| P0-01 indicadores | M/L | reglas de inclusión y recálculo histórico |
| P0-05 MIPER/legal | XL | metodología, aplicabilidad, importación y cobertura |

Una calendarización responsable se fija después de completar Ola 0, inventario SFTI, decisiones de datos sensibles y diccionarios de migración.

---

## 19. Bitácora de ejecución

### 18 de julio de 2026 — Inicio del objetivo

- [x] Objetivo persistente creado para ejecutar el plan completo.
- [x] Marco DS 44, registros/indicadores y plazo DIAT/DIEP revalidados contra fuentes oficiales.
- [x] Dependencias técnicas revalidadas con CodeGraph sobre `calcRates`, `closePpa`, `reviewPpa`, `uploadDocumentVersion` y `getDocumentBundle`.
- [x] Diff local solapado auditado antes de editar: existen cambios del usuario en búsqueda/navegación de Documentación y manifiestos; deben preservarse.
- [x] Skill `react-doctor` incorporada como gate de regresión para los lotes con cambios React.
- [x] Baseline focalizado verde antes de editar: 5 archivos y 25 pruebas de PPA, indicadores, exportación y Documentación.
- [x] Mitigación PPA server-side: una decisión de corrección ya no autoriza el trabajo; cierre exige acción `verificada`/`cerrada` y los rechazados no pueden cerrarse como resueltos.
- [x] UI PPA alineada con el guard: el botón de cierre solo aparece si el caso está autorizado y la acción verificada.
- [x] Regresión PPA verde: 4 archivos y 30 pruebas.
- [x] Mitigación de indicadores: tasas legales ocultas por default seguro, cierres bloqueados, cero HH no calculable y Excel marcado como no conciliado.
- [x] Factor de gravedad legado corregido de 1.000 a 1.000.000; continúa como proxy no oficial hasta P0-04/P0-01 definitivos.
- [x] Toggles regulatorios implementados en lectura batched y con fallo seguro.
- [x] Regresión indicadores verde: 5 archivos y 16 pruebas; typecheck y ESLint focalizado limpios.
- [x] React Doctor mejoró de 91 a 92 al corregir la key inestable del timeline PPA. El aviso de Recharts es falso positivo porque el dashboard ya carga `indicadores-charts.tsx` con `next/dynamic(..., { ssr: false })`; los otros dos avisos pertenecen a cambios locales de Combustibles fuera de este lote.
- [x] Contención documental M-03: `uploadDocumentVersion` crea la versión en `borrador`, no cambia `currentVersionId`, no reemplaza la versión publicada y audita que la publicación sigue pendiente.
- [x] Copy de las acciones de carga actualizado: la UI ya no comunica una carga como publicación y señala que queda pendiente de revisión.
- [x] Prueba de regresión documental agregada: demuestra con una versión vigente preexistente que una carga no ejecuta ningún `UPDATE`; junto con las acciones, 2 archivos y 24 pruebas pasan, con ESLint focalizado limpio.
- [x] Máquina documental implementada server-side: `borrador → en_revision → observado/borrador → aprobado → vigente → reemplazado`, con comentario obligatorio para observar y revisión obligatoria antes de aprobar.
- [x] Segregación documental implementada: el uploader no puede aprobar su propia versión; aprobación y publicación usan permisos distintos y sólo se otorgan por default a `jefa_chome` y `administrador`.
- [x] Publicación transaccional implementada con bloqueo de documento: valida versión aprobada/fecha efectiva, reemplaza la vigente anterior, actualiza `currentVersionId` y escribe auditoría dentro de la misma transacción.
- [x] Controles de workflow expuestos en el historial de versiones sin interferir con el rediseño local de búsqueda documental.
- [x] Lectura de confidencialidad endurecida en búsqueda, contadores, detalle, descarga vigente, descarga histórica y descarga masiva; borradores/históricos requieren permisos operativos de workflow.
- [x] Regresión del lote documental parcial verde: 7 archivos de prueba, 54 pruebas y typecheck completo pasan.
- [x] Matriz de acceso negativo agregada para el endpoint de versión: sin sesión, faena ajena, borrador con sólo lectura y sensible sin permiso fallan; revisor autorizado de la misma faena puede inspeccionar el borrador. 5/5 pruebas pasan.
- [x] Denominador de distribución persistente agregado en `sst_document_distribution_targets`: usuario/trabajador, origen, fecha límite, estado, exención y recordatorios; la migración generada es `0063_dapper_loki.sql`.
- [x] Disciplina Drizzle verificada: la migración se generó desde schema y una segunda ejecución de `npm run db:generate` informó `No schema changes`.
- [x] Asignación nominativa, exención auditada y acuse digital implementados; la firma SHA-256 liga versión, checksum, usuario, momento y método.
- [x] Dashboard documental corregido: pendientes de acuse ahora cuentan destinatarios pendientes de la versión vigente, no documentos que simplemente declaran requerir acuse.
- [x] UI de distribución agregada al detalle: asignación individual, estado nominativo, acuse propio y exención con motivo.
- [x] Pruebas de distribución cubren firma exacta, prohibición de acusar sin asignación, cierre del target propio y bloqueo de distribución masiva sensible; 4/4 pasan y ESLint focalizado queda limpio.
- [x] Migración `0063_dapper_loki.sql` aplicada al Postgres local con `npm run db:migrate`; inspección real confirma 19 columnas, constraints de destinatario/estado/exención/recordatorios y `created_at` de migración `1784417241850`.
- [x] Inventario automático de regularización implementado: detecta borrador con versión vigente, publicación sin aprobador, referencia actual inválida, múltiples vigentes, reemplazo sin sucesor, acuse sin distribución y audiencia sensible incompatible.
- [x] Pantalla restringida `/prevencion/documentacion/regularizacion` y exportación Excel agregadas; cada hallazgo declara la evidencia como no utilizable y recomienda una corrección auditada, sin mutar estados masivamente.
- [x] Regresión de inventario/exportación verde: 3 archivos, 8 pruebas; valida autorización, Excel y seis clases de inconsistencia.
- [x] Política de confidencialidad probada con default público y grants explícitos; combinada con la matriz negativa del endpoint, impide que roles generales vean archivos sensibles.
- [x] Compensación de archivos probada: si falla el INSERT de versión, el binario persistido se elimina y no se actualiza el documento; 2 archivos y 7 pruebas pasan.
- [x] Gate React Doctor del lote documental mejorado de 83 a 90: se corrigieron sandbox del visor, awaits independientes, ZIP secuencial, lookup cuadrático, estado innecesario y API booleana del workflow. Quedan 6 avisos: lectura dinámica de archivos falsamente clasificada como estática, Recharts ya cargado detrás de `next/dynamic`, y cambios locales preexistentes del modal/Combustibles que no se sobrescriben.
- [x] Dominio sensible separado creado: proyección de aptitud/restricciones, payload clínico cifrado, casos reservados con miembros nominativos, auditoría especializada y solicitudes de derechos/retención.
- [x] Cifrado AES-256-GCM implementado con AAD por entidad y llave externa obligatoria; ausencia, tamaño inválido, cambio de contexto o fallo de autenticación cierran el acceso. La llave se documenta vacía en `.env.example` y el escáner la trata como secreto.
- [x] RBAC sensible implementado sin grants generales: ningún rol recibe por default acceso clínico, carga clínica, vigilancia o casos reservados; sólo jefatura/administración reciben la proyección mínima de restricciones y auditoría.
- [x] Biblioteca general clasificada mediante `data_class`: `clinical` y `reserved_investigation` se rechazan; además se bloquean patrones de resultados/fichas/casos antes de escribir el binario. Una prueba detectó y corrigió el bypass por nombres con guiones.
- [x] Inventario de regularización ampliado para clasificaciones sensibles y nombres prohibidos; revisión diaria disponible en `/prevencion/privacidad/auditoria`, combinando lecturas del dominio cifrado y vistas/descargas sensibles de la biblioteca.
- [x] Migración `0064_stale_nextwave.sql` generada desde schema, segunda generación sin drift, aplicada y verificada: seis tablas sensibles, `sst_documents.data_class` y `created_at` `1784418784070`.
- [x] Pruebas de privacidad verdes: proyección sin diagnóstico, denegación sin inferencia, lectura clínica nominativa, auditoría sin contenido, cifrado/contexto/fallo cerrado y membresía reservada; 5 archivos y 17 pruebas pasan.
- [x] Endpoints reservados agregados: creación exige permiso investigador explícito; lectura exige finalidad y delega en faena + membresía nominativa. Inexistencia, faena ajena, falta de permiso y no-membresía comparten el mismo `404`, y las respuestas autorizadas usan `no-store`.
- [x] Clasificación documental hecha obligatoria en la carga: ya no existe el fallback silencioso a `operational`; la UI obliga a elegir entre las cuatro clases permitidas en biblioteca general y reitera que clínica/denuncias van al dominio segregado.
- [x] Regresión del lote de endpoints/clasificación verde: 5 archivos y 40 pruebas, incluyendo auth, permiso investigador, finalidad, respuesta anti-inferencia, propagación de clase y rechazo server-side sin clasificación.
- [x] Solicitudes de derechos implementadas con permiso dedicado: recepción, validación de identidad, proceso, retención legal, liberación expresa, completado/rechazo y bitácora inmutable de transiciones.
- [x] Retención aplicada server-side: una solicitud no salta la validación de identidad, no se completa bajo `legalHold` y no sale de suspensión sin liberación expresa y motivo.
- [x] Exportación Excel minimizada implementada: requiere derecho de acceso/portabilidad, identidad validada, propósito y permiso dedicado; clínica es opt-in y exige además `view_clinical`. Cada hoja/fila declara clasificación, neutraliza fórmulas y excluye auditorías, terceros y casos sin vínculo estructurado.
- [x] Entregas demostrables: cada Excel se persiste con alcance, actor, propósito, inclusión clínica, conteo y checksum SHA-256 antes de responder; las rutas usan `no-store` y `nosniff`.
- [x] Bandeja `/prevencion/privacidad/solicitudes` agregada con alta, validación, retención/liberación, cierre/rechazo y exportación. Usa el buscador del `TopBar`, estados en español y acciones en contexto.
- [x] Migración `0065_colorful_vulcan.sql` generada desde schema, segunda generación sin drift, aplicada y verificada en Postgres: historial, entregas y cuatro campos de trazabilidad; `created_at` `1784419668997`.
- [x] Regresión de privacidad ampliada: 11 archivos y 30 pruebas de cifrado, salud, casos reservados, RBAC, workflow, exportación y endpoints pasan; typecheck y ESLint focalizado quedan limpios.
- [x] Gate `react-doctor` del lote vuelve a 90/100: helper de carga extraído del componente y subida con concurrencia acotada/caché de promesas. Los 6 avisos restantes corresponden a falsos positivos ya inspeccionados o cambios locales preexistentes preservados.
- [x] Fundación CAPA común agregada de forma aditiva: acciones, evidencia, seguimientos, transiciones inmutables, asignación real/snapshot, prioridad/plazo, eficacia, conciliación histórica y `version` optimista viven en `prevention_capa_*` sin eliminar las tablas legadas.
- [x] Máquina CAPA server-side implementada: `pending → in_progress → pending_verification → verified → closed`, con reapertura/cancelación motivadas, cero salto directo a cierre, evidencia verificable obligatoria y segregación creador/verificador para prioridad alta/crítica salvo override autorizado y fundado.
- [x] Migración `0066_fantastic_archangel.sql` generada desde schema, segunda generación sin drift, aplicada a Postgres y verificada sintácticamente; backfill idempotente enlaza PDTP, SST y PPA, conserva snapshots/seguimientos/evidencias existentes y deja ambigüedades en cola de conciliación.
- [x] Nuevas escrituras de acciones PDTP, SST y PPA ya crean CAPA común en la misma transacción y guardan `capa_action_id`; la adaptación de todas las mutaciones legadas y su UI común sigue en curso.
- [x] Workflow PPA definitivo implementado en el servicio: revisión sólo abre corrección, evidencia → declaración → verificación → autorización de reinicio → cierre; cancelación exige motivo, cada transición guarda actor/fecha/razón y todos los cambios sensibles usan versión optimista.
- [x] RBAC PPA separado por `review`, `correct`, `verify`, `authorize_restart`, `cancel` y `close`; el antiguo permiso de revisión ya no puede invocar el cierre directo.
- [x] Detalle PPA actualizado con controles contextuales para evidencia, implementación, inspección de eficacia, autorización expresa, cancelación y cierre. Una nota sola no cuenta como evidencia habilitante: debe existir documento, fotografía o URL verificable.
- [x] Historial PPA admite actor `system` sin identidad fabricada para la evaluación automática y actor humano nominativo para decisiones posteriores; migraciones `0067_unique_karnak.sql` y `0068_next_masked_marvel.sql` fueron generadas sin drift y aplicadas.
- [x] Backfill PPA conservador ejecutado: crea historial sólo con actores/fechas reales y reabre administrativamente autorizaciones/cierres cuya CAPA no esté verificada/cerrada. Las filas sin actor histórico no reciben una identidad inventada y quedan para conciliación explícita.
- [x] Regresión parcial CAPA/PPA verde: 6 archivos y 42 pruebas de estados, cierre, revisión, RBAC y acciones comunes; typecheck completo pasa. Incluye Postgres real desechable: el backfill PPA ejecutado dos veces produce una sola CAPA/transición y dos mutaciones concurrentes con la misma versión dejan exactamente un ganador.
- [x] Bandeja `/prevencion/capa` y detalle operable agregados: cuatro métricas accionables desde CAPA común, filtros, origen navegable, asignación/plazo/prioridad, evidencia, seguimiento, implementación, verificación, cierre, reapertura, cancelación y conciliación histórica.
- [x] Exportación CAPA Excel agregada con hojas de acciones, transiciones, evidencias y seguimientos; usa alcance por faena, neutraliza fórmulas y expone actores, timestamps, eficacia, conciliación y versión.
- [x] Exportación PPA ampliada con actores/fechas de corrección, verificación, autorización, cancelación y cierre, además de código/estado/evidencia/eficacia/conciliación CAPA.
- [x] Alertas CAPA diarias implementadas en `/api/cron/prevention-capa-reminders`: el responsable recibe la asignación antes del vencimiento; responsable y gestores reciben vencimientos; verificador recibe acciones implementadas; alta/crítica o 3+ días escala a jefatura con deduplicación estable.
- [x] Adaptadores PDTP/SST endurecidos: nuevas altas escriben CAPA en la misma transacción, edición no cambia estados arbitrariamente, seguimiento PDTP replica evidencia/transiciones comunes, verificación exige eficacia y “eliminar” conserva el registro como cancelado.
- [x] Migración `0069_premium_mad_thinker.sql` generada desde schema, segunda generación sin drift y aplicada; agrega `cancelado` al estado legado PDTP para convivencia no destructiva.
- [x] Matriz focalizada CAPA/PPA/PDTP/SST verde: 12 archivos y 109 pruebas, más 3 pruebas en Postgres real que cubren idempotencia, concurrencia, rollback de verificación, workflow completo, scope y Excel. Typecheck completo pasa.
- [x] Aviso de asignación CAPA agregado al job diario: notifica al responsable antes del vencimiento con clave idempotente por acción, usuario y plazo; las pruebas cubren asignación, verificación, vencimiento y escalamiento.
- [x] Regresiones React Doctor del lote corregidas: esperas independientes, búsquedas lineales dentro de bucle, iteraciones encadenadas y estado derivado/oculto. Gate final `90/100`, con exactamente los 6 avisos preexistentes preservados; ESLint focalizado, typecheck y 27 pruebas PDTP/PPA pasan.
- [x] Inventario de conciliación ejecutado el 2026-07-18 sobre PostgreSQL local: 0 CAPA pendientes de conciliación, 0 acciones PDTP/SST/PPA sin vínculo CAPA y 0 PPA autorizados/cerrados sin CAPA verificada. La base local no contiene filas históricas reales; producción debe ejecutarse como gate operacional separado.
- [x] Lote fundación CAPA común y cierre definitivo de estados PPA completado técnicamente en el checkout local.
- [x] Vínculos documentales endurecidos: sólo admiten tipos con validador, comprueban existencia y faena del destino, rechazan cruces de alcance y permiten volver a vincular después de un retiro auditado mediante índice único parcial.
- [x] Inventario documental ampliado con `LINKED_ENTITY_MISSING`, `LINK_TARGET_UNVERIFIED` y `LINK_TARGET_SCOPE_MISMATCH`; cada vínculo inválido puede retirarse individualmente con actor y motivo.
- [x] Regularización documental ejecutable agregada: restaurar publicación aprobada, retirar publicación sin aprobador, limpiar `currentVersionId` inválido, elegir versión autoritativa, enlazar sucesora y retirar vínculos rotos operan caso a caso, revalidan el hallazgo y guardan antes/después en auditoría.
- [x] Recordatorios de acuse agregados en `/api/cron/prevention-document-ack-reminders`: primera alerta, cadencia pre-vencimiento/sin plazo, recordatorio diario vencido, escalamiento a distribución, contador y `lastReminderAt`, todo con deduplicación diaria.
- [x] Lectura de detalle documental ajustada para no filtrar existencia por error: faena ajena devuelve ausencia uniforme en UI y `404` en ambos endpoints de archivo; la prueba confirma que nunca se lee el binario ni se audita una vista inexistente.
- [x] Expediente documental Excel agregado con seis hojas —documento, versiones, distribución, acuses, vínculos y bitácora—, checksum exacto por acuse, neutralización de fórmulas, auditoría de descarga y respuesta `no-store`.
- [x] Titulares de casos reservados modelados estructuralmente con relación, propósito, actor y retiro trazable; alta valida existencia, actividad y pertenencia a la faena sin guardar identidades en auditorías de acceso.
- [x] Ejecución efectiva de rectificación, supresión, oposición y restricción agregada por dominio de salud, caso reservado, PPA y vínculo documental: exige identidad validada, estado en proceso, derecho compatible y ausencia de retención; registra hash antes/después, actor, resultado y campos afectados sin copiar contenido sensible.
- [x] La solicitud ya no puede cerrarse sólo con una nota: acceso/portabilidad exige una entrega registrada; rectificación/supresión/oposición/restricción exige al menos una ejecución aplicada. La nueva vista por solicitud muestra inventario estructural y evidencia de ejecución.
- [x] Reubicación histórica cifrada implementada desde la regularización documental: valida destino/scope/membresía, checksum de origen, cifra AES-256-GCM con AAD por archivo, verifica descifrado antes de restringir la fuente, guarda cadena de custodia y sirve la copia sólo con propósito y permiso sensible.
- [x] Migración `0070_high_exodus.sql` generada desde schema, segunda generación sin drift y aplicada (`created_at` `1784426245287`): sujetos reservados, ejecuciones de derechos, restricciones, archivos sensibles, reubicaciones y unicidad parcial de vínculos.
- [x] Prueba PostgreSQL real de privacidad verde: 5 escenarios cubren supresión clínica, bloqueo de titular ajeno, redacción reservada, validación/re-vinculación documental, regularización antes/después y respaldo/restauración de ciphertext con denegación posterior a rol no autorizado.
- [x] Inventario local documental/privacidad ejecutado el 2026-07-18: 0 documentos, 0 vigentes incoherentes, 0 expedientes que requieren acuse y 0 archivos sensibles en biblioteca general. El resultado local no reemplaza inventario ni firma de producción.
- [x] Gate React Doctor documental/privacidad en `90/100`: se corrigió la única iteración encadenada nueva y quedaron exactamente los 6 avisos preexistentes ya inspeccionados; typecheck, ESLint focalizado, 40 pruebas unitarias/UI/API y 5 pruebas PostgreSQL del lote pasan.
- [x] 2026-07-18 — Contrato de datos canónico P0-04 agregado en `db/schema/prevention/incidents.ts`: evento idempotente y versionado, personas con payload sensible separado, carriles DIAT/DIEP/fatal-grave/reinicio, investigación, evidencia, historial inmutable y staging SFTI cifrado. CAPA se reutiliza por `sourceType=incident`; no se creó un segundo motor de acciones.
- [x] 2026-07-18 — Migración P0-04 `0071_abandoned_mandroid.sql` generada exclusivamente desde schema, segunda generación sin cambios y aplicada al PostgreSQL local (`created_at=1784427366633`); se verificaron las 9 tablas `prevention_incident*`.
- [x] 2026-07-18 — Auditoría sensible común extendida al dominio `incident` y acción `read_incident_sensitive` mediante migración aditiva `0072_far_the_watchers.sql`, también generada sin drift y aplicada; las lecturas futuras no reutilizarán etiquetas clínicas/reservadas incorrectas.
- [x] 2026-07-18 — Servicio canónico `prevention-incidents` implementado: alta idempotente por `clientSubmissionId`, scope por faena, deadline exacto de 24 h, carriles legales separados, triage optimista, investigación guiada/cifrada, evidencia, CAPA común, autorización de reinicio y cierre con gates. El atraso queda trazado por deadline, `escalatedAt`, fecha de envío e historial incluso después de regularizarse.
- [x] 2026-07-18 — Proyección general excluye payload de identidad/lesión y evidencia sensible; la lectura nominativa exige `view_sensitive`, propósito, faena, descifra con AAD por persona y registra concesión/denegación en la auditoría sensible común. ESLint focalizado y typecheck completo pasan tras el lote de servicio.
- [x] 2026-07-18 — Job idempotente `/api/cron/prevention-incident-reminders` agregado: recalcula atrasos, alerta seis horas antes, escala diariamente vencidos y trata DT/SEREMI fatal-grave como inmediato. La copia declara explícitamente que Chome controla presentación/evidencia y no finge una integración automática con autoridad.
- [x] 2026-07-18 — Importación SFTI en staging implementada para Excel: diccionario de columnas/aliases, archivo fuente cifrado + checksums, original de fila cifrado, normalizado seguro, resolución de faena, detección de duplicados, revisión, aprobación segregada y activación idempotente. La activación recién crea incidente, carriles legales, persona sensible cifrada e historial de procedencia.
- [x] 2026-07-18 — Los nueve permisos P0-04 y navegación fueron declarados en el manifiesto vivo; report/view/triage/investigate/notify/restart/close/export tienen grants deliberados. `view_sensitive` queda sin grant por defecto y requiere nominación. RBAC local sincronizado con `npm run db:sync-rbac`; typecheck y ESLint pasan.
- [x] 2026-07-18 — UI P0-04 conectada: bandeja con cuatro métricas accionables, filtros estructurados y búsqueda TopBar; reporte móvil con fechas del design system, cola IndexedDB y sincronización idempotente; detalle con timeline, triage, carriles legales, investigación, evidencia, CAPA, reinicio, cierre y vista reservada por propósito; staging SFTI permite conciliar/aprobar/activar.
- [x] 2026-07-18 — Exportación Excel agregada para registro legal y expediente: siete hojas operacionales trazan evento, personas minimizadas, notificaciones/deadlines/evidencia, investigación, CAPA e historial; la vista sensible es opt-in con permiso/propósito/auditoría. Todas las celdas controladas neutralizan fórmulas y las rutas usan `no-store`/`nosniff`.
- [x] 2026-07-18 — La implementación App Router fue contrastada con documentación oficial de Next.js 16.2.x: `params`/`searchParams` asíncronos, Server Actions como entradas no confiables con autorización interna, revalidación y Route Handlers dinámicos. ESLint focalizado y typecheck completo vuelven a pasar.
- [x] 2026-07-18 — La prueba PostgreSQL fatal/grave detectó que el constraint inicial impedía desactivar la suspensión incluso después de investigación, CAPA, avisos DT/SEREMI y autorización formal. Se corrigió sólo en schema y mediante la migración aditiva `0073_abandoned_menace.sql`; la segunda generación quedó sin drift y la migración fue aplicada localmente.
- [x] 2026-07-18 — Los 10 gates obligatorios de P0-04 quedaron cubiertos: 13 pruebas unitarias/UI/API más 4 escenarios PostgreSQL reales verifican sincronización offline exactamente una vez, deadline, atraso persistente, fatal/grave y reinicio, contratista/faena, minimización y auditoría sensible, investigación/CAPA/cierre, historial, staging SFTI idempotente y matriz negativa rol/faena/endpoint.
- [x] 2026-07-18 — La prueba PostgreSQL también genera y vuelve a leer el Excel real: siete hojas de registro, ocho de expediente reservado, auditoría de exportación y neutralización de fórmula. El job de recordatorios fue ejecutado dos veces sobre un carril SFTI atrasado y conserva el primer `escalatedAt`, sin borrar ni reiniciar el atraso.
- [x] 2026-07-18 — Gate de producción P0-04 verde: el build Next.js 16.2.10 detectó y se corrigieron seis Server Actions documentales no declaradas `async` y una fuga del servicio Node/PostgreSQL al bundle cliente SFTI. Typecheck, ESLint, build y React Doctor `90/100` pasan; Doctor queda sólo con los mismos seis avisos preexistentes del lote anterior.
- [x] 2026-07-18 — Motor legal P0-01 implementado en `safety-indicators-calc`: versión explícita `ds44-art73-2025-v1`, numeradores canónicos, denominadores mensuales, agregación cruda semestral/anual, deduplicación persona-evento, provisionalidad, “no calculable” con cero HH y supresión de grupos pequeños por sexo.
- [x] 2026-07-18 — Persistencia conciliable agregada: denominadores con fuente/evidencia/preparador/aprobador segregados, snapshots inmutables con hash y versión de fórmula, historial de cambios y períodos cerrados/reabiertos versionados. Las migraciones `0074_real_blockbuster.sql` y `0075_shiny_havok.sql` fueron generadas desde schema, una segunda generación quedó sin drift y ambas se aplicaron al PostgreSQL local.
- [x] 2026-07-18 — Corrección de fuentes cerradas endurecida: cambiar la inclusión de una persona o un denominador aprobado exige permiso de cierre, motivo, versión optimista y reapertura atómica; el snapshot anterior queda `superseded` y el nuevo cierre genera otro hash e historial.
- [x] 2026-07-18 — Dashboard canónico P0-01 conectado al registro de incidentes: denominadores y aprobación, conciliación legado/recalculado, estado provisional/confirmado, gravedad semestral, desagregación protegida, drill-down filtrado a los eventos fuente y cierre fundado. Los toggles de contención ya no deciden si un cálculo se presenta como oficial: lo hacen sus gates y su evidencia por período.
- [x] 2026-07-18 — Exportación Excel P0-01 usa el mismo resultado canónico que la UI y entrega resultados mensuales, gravedad semestral, accidentabilidad anual, denominadores, fuentes, conciliación legado, snapshots y metadatos; declara fórmula/versión/estado/fecha/procedencia, neutraliza fórmulas y conserva “No calculable” en vez de convertirlo en cero.
- [x] 2026-07-18 — Casos dorados completos: 13 pruebas puras validan 10,00/55,00/2,00, cero HH, ausencia menor a jornada, provisionalidad, deduplicación, semestre crudo y privacidad; 3 escenarios PostgreSQL reales validan además segregación, cierre/hash, reapertura/supersesión, historial y scope. La matriz de cierre/Server Actions añade 5 pruebas negativas/positivas de permiso, actor y faena; una prueba de dashboard confirma “No calculable”, privacidad y drill-down, y export/typecheck/ESLint focalizado pasan.
- [x] 2026-07-18 — Inventario local P0-01 ejecutado: 0 filas legadas, 0 denominadores, 0 snapshots y 0 entradas de historial en la base local. Por ello no hay recálculos locales pendientes, pero producción debe inventariar y conciliar sus filas reales antes del corte.
- [x] 2026-07-18 — Contrato de datos P0-05 agregado en `db/schema/prevention/risk-legal.ts`: 16 tablas aditivas para metodologías, jerarquía proceso/tarea/puesto, MIPER versionada, controles, disparadores, staging Excel, requisitos/aplicabilidad/evaluaciones, vínculos PDTP, relojes e historial inmutable. Las migraciones `0076_equal_menace.sql` y `0077_tired_solo.sql` fueron generadas desde schema, aplicadas al PostgreSQL local y dos generaciones posteriores confirmaron `No schema changes`.
- [x] 2026-07-18 — Workflow MIPER implementado con metodología ISP configurable, metodologías especiales, segregación autor/revisor/aprobador, versión optimista, hash de publicación, vigencia, revisión anual y disparadores por cambio/incidente/enfermedad/gravedad/auditoría. Publicar una revisión no sobrescribe la anterior: la marca `superseded`, incrementa su versión y registra antes/después, hash, actor, motivo y matriz reemplazante.
- [x] 2026-07-18 — Registro legal implementado con fuente/artículo/vigencia, versiones, aplicabilidad por faena/proceso, fundamento obligatorio, aprobación segregada incluso para “no aplica”, responsable/evidencia/frecuencia y evaluación. Una brecha parcial/no conforme crea CAPA común atómicamente; reemplazar una versión conserva el hash anterior y escribe la transición indirecta en historial.
- [x] 2026-07-18 — Integración PDTP operativa: cada actividad puede vincular control MIPER, requisito legal aplicable, incidente/CAPA, auditoría, objetivo interno u obligación contractual; la cobertura muestra actividades sin fuente, riesgos críticos sin control verificable y brechas legales. Publicar MIPER inicia reloj de 30 días corridos; sólo se cierra si el programa tiene vínculo a la fuente. Duplicar un programa copia vínculos activos con snapshot y procedencia sin inventar cobertura para actividades huérfanas.
- [x] 2026-07-18 — Importación MIPER Excel implementada como staging recuperable: límites de archivo/filas, aliases, checksum, original inmutable, normalización, fingerprint/duplicados, observaciones, decisión por fila, aprobación segregada, activación idempotente y descarga del original con scope/auditoría. Cada peligro activado conserva original, normalizado y decisión.
- [x] 2026-07-18 — UI P0-05 conectada en `/prevencion/miper`, `/prevencion/requisitos-legales` y `/prevencion/pdtp/cobertura`, con cuatro métricas accionables, estados en español, filtros/acciones coherentes, detalle navegable de controles/requisitos y avisos explícitos de bloqueo. Las exportaciones Excel entregan cinco hojas por dominio, evidencia de aprobación/hash/metadatos, neutralización de fórmulas, `no-store`, `nosniff` y auditoría.
- [x] 2026-07-18 — Nueve permisos P0-05 y navegación sincronizados localmente con grants deliberados: lectura, edición, revisión, aprobación y publicación MIPER; lectura, evaluación, aprobación de aplicabilidad y exportación legal. Las Server Actions ignoran actor/scope forjados y derivan identidad, permisos y faenas de la sesión.
- [x] 2026-07-18 — Gates P0-05 focalizados verdes: 21 pruebas de acciones/UI/endpoints más 4 escenarios PostgreSQL reales cubren workflow, concurrencia, segregación, scope negativo, versionado/hashes/historial, CAPA, reloj de 30 días, cobertura/copia PDTP, Excel e importación. Typecheck y ESLint focalizado pasan. La regresión de incidentes también pasa y demuestra que una investigación que exige actualización MIPER no se completa con un checkbox: requiere una versión posterior publicada.
- [x] 2026-07-18 — Inventario P0-05 ejecutado en PostgreSQL local: 0 metodologías, matrices, procesos, tareas, puestos, peligros críticos, requisitos, aplicabilidades, vínculos, relojes, disparadores, lotes e historial. Por ello no hay backfill local posible ni cobertura productiva demostrable; los nueve permisos sí existen tras `db:sync-rbac`, con grants entre 2 y 6 roles según sensibilidad.
- [x] 2026-07-18 — Backlog de administración de toggles regulatorios resuelto por eliminación, no por una pantalla: CodeGraph y búsqueda del checkout confirmaron que ambos toggles de contención quedaron sin consumidores tras P0-01. Se retiró el servicio/pruebas muertos y se prohibió crear una vía administrativa paralela a los gates canónicos de denominador, conciliación, snapshot y cierre.
- [x] 2026-07-18 — El libro contractual `PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx` fue restaurado en la raíz desde la fuente exacta disponible en el workspace; origen y copia coinciden en SHA-256 `a6adc0fa017a9972dde09e5abdddb399cfce23526332807a122e52bfd15690a4`. La regresión PDTP volvió a validar las 28 pruebas del libro real.
- [x] 2026-07-18 — Los contratos de navegación, RBAC, control documental, captura de rutas y exportación se actualizaron para reflejar las capacidades P0 vigentes, sin congelar la auditoría anterior como verdad del código. La suite completa queda en 297 archivos aprobados, 13 omitidos; 2.493 pruebas aprobadas y 57 omitidas.
- [x] 2026-07-18 — Optimización final aplicada a copia/importación PDTP e indicadores: se sustituyeron escrituras y búsquedas iterativas por operaciones masivas, sin cambiar estados ni procedencia. Pasan 43 pruebas focalizadas PDTP/indicadores, 4 escenarios PostgreSQL MIPER/legal y 3 escenarios PostgreSQL de indicadores.
- [x] 2026-07-18 — Las fichas navegables de control MIPER y requisito legal ya traducen estado, jerarquía, fuente, aplicabilidad, cumplimiento y nivel de riesgo; no exponen enums internos en inglés al usuario.
- [x] 2026-07-18 — Gate final React Doctor `90/100`: las 16 advertencias nuevas del lote quedaron corregidas. Las seis restantes fueron inspeccionadas: Recharts de Indicadores ya está detrás de `next/dynamic(..., { ssr: false })`, el ZIP lee archivos variables de cada solicitud y cuatro avisos corresponden a cambios preexistentes fuera del lote que se preservan.
- [x] 2026-07-18 — Build de producción Next.js 16.2.10 verde con todas las rutas P0; typecheck, ESLint completo sin advertencias y `git diff --check` limpios. La reauditoría post-remediación se incorporó en `AUDITORIA_MODULO_PREVENCION.md`, distinguiendo capacidad técnica de corte productivo y aceptación regulatoria.

### Pendiente accionable por el agente — corte actualizado

> **19 de julio de 2026:** el trabajo P1 derivado de la auditoría se ejecuta en `PLAN_P1_PREVENCION.md`. La primera capacidad (capacitación, ODI y competencias) quedó técnicamente cerrada; allí también se registra un hallazgo transversal: las suites PostgreSQL de Prevención no corren en el gate de CI.

No queda implementación P0 accionable de forma autónoma en este checkout. Los pendientes siguientes requieren datos reales, despliegue productivo, decisiones de proceso o aceptación de responsables; el agente puede ejecutarlos cuando se le entregue el acceso, los archivos fuente y la autorización correspondiente.

- [ ] Operación/terceros — Completar M-01: inventario y revisión de períodos históricos/exportaciones potencialmente afectadas en producción; la contención técnica de tasas ya está implementada.
- [ ] Operación/terceros — Completar M-02/P0-02: conciliar toda fila productiva sin actor/evidencia y obtener aceptación de semántica por Jefatura; máquina, alertas, cancelación, actores, evidencia, integración CAPA y prueba DB ya están implementados.
- [ ] Operación/terceros — Ejecutar P0-03 en producción: resolver cada hallazgo real desde la bandeja, asignar toda distribución requerida y obtener firma del dueño; validación de enlaces, regularización caso a caso, recordatorios, prueba UI/endpoint y expediente Excel ya están implementados.
- [x] No crear administración para los toggles regulatorios de contención: quedaron sin consumidores tras P0-01 y se retiraron para no reintroducir un bypass. Los gates canónicos son la única autoridad de oficialidad/cierre.
- [ ] Operación/terceros — Completar el corte CAPA: conciliar filas históricas productivas y autorizar el retiro de escrituras legadas; schema, servicio, UI, Excel, contadores, alertas, conciliación y adaptadores PDTP/SST/PPA ya existen.
- [x] Las matrices negativas rol × faena × endpoint de los dominios P0 quedaron cubiertas por pruebas de acciones/rutas y escenarios PostgreSQL: PPA, documentos, salud, casos reservados, privacidad, incidentes, indicadores y MIPER/legal.
- [ ] Operación/terceros — Ejecutar P0-06 en producción: inventariar/reubicar expedientes reales, conciliar titulares reservados, aprobar matriz de finalidades y obtener aceptación jurídica/seguridad.
- [ ] Operación/terceros — Ejecutar el corte de incidentes: operar en paralelo y obtener autorización de Jefatura. **La importación desde SFTI fue retirada el 19-07-2026** (migración `0081`), por lo que la carga de la exportación histórica ya no es un camino del producto: se resuelve fuera de la plataforma o mediante una carga puntual acordada.
- [ ] Operación/terceros — Ejecutar P0-01: inventariar filas/períodos reales, cargar denominadores con evidencia, aprobar conciliaciones, firmar reglas/casos dorados y aceptar el informe de diferencias.
- [ ] Operación/terceros — Ejecutar P0-05: cargar los Excel MIPER y registro legal reales, resolver filas ambiguas, aprobar/publicar por faena, conciliar cada actividad PDTP, verificar controles críticos y obtener aceptación participativa/jurídica.
- [ ] Producción/autorización — Aplicar migraciones `0063` a `0077` y ejecutar los backfills/cargas reales; localmente están aplicadas y sin drift.
- [x] Verificación del checkout — Typecheck, ESLint focalizado, pruebas focalizadas, PostgreSQL real, `test:fast`, build y React Doctor ejecutados sobre el lote final.
- [x] Documentación — Bitácora y auditoría post-remediación actualizadas.

### Estado global

- [ ] Ola 0 — mitigaciones
- [ ] Fundación CAPA
- [ ] P0-02 — PPA
- [ ] P0-03 — documentos
- [ ] P0-06 — privacidad
- [ ] P0-04 — incidentes (capacidad técnica cerrada; corte SFTI/aceptación pendientes)
- [ ] P0-01 — indicadores (capacidad técnica cerrada; conciliación/firma productiva pendientes)
- [ ] P0-05 — MIPER/legal (capacidad técnica cerrada; migración/cobertura/aceptación productiva pendientes)
- [ ] Operación paralela
- [ ] Cortes parciales SFTI

### Regla de actualización

Al implementar, cada ítem debe registrar:

- fecha;
- commit o diff;
- migración;
- pruebas ejecutadas;
- resultado;
- evidencia de rol × faena × endpoint;
- decisión de negocio/legal asociada;
- pendientes y riesgo residual.

Ningún checkbox se marca solo porque el código compile.

---

## 20. Condiciones para declarar mitigados y corregidos los P0

### Mitigado

Un P0 está mitigado cuando:

- el comportamiento riesgoso fue bloqueado o claramente retirado del uso oficial;
- existe control compensatorio documentado;
- hay dueño y seguimiento;
- el usuario conoce la limitación;
- se monitorea el riesgo residual.

### Corregido

Un P0 está corregido cuando:

- existe fuente de verdad y flujo completo;
- no hay bypass por endpoint;
- datos históricos fueron conciliados;
- permisos negativos fueron probados;
- la evidencia es exportable y trazable;
- el dueño del proceso aceptó el resultado;
- la obligación legal aplicable fue validada;
- el control compensatorio puede retirarse sin pérdida.

### Gate final

- [ ] P0-01 corregido.
- [ ] P0-02 corregido.
- [ ] P0-03 corregido.
- [ ] P0-04 corregido.
- [ ] P0-05 corregido.
- [ ] P0-06 corregido.
- [ ] Cero riesgo residual crítico sin aceptación formal.
- [x] Auditoría técnica de cierre actualizada en `AUDITORIA_MODULO_PREVENCION.md`; no equivale a aceptación legal/operacional.

---

## 21. Fuentes normativas de control

- [DS 44/2024 vigente — BCN](https://www.bcn.cl/leychile/navegar?f=2025-02-01&i=1205298)
- [Ley 16.744, artículo 76 — BCN](https://www.bcn.cl/leychile/navegar?idNorma=28650&idParte=8745489&idVersion=2022-03-10)
- [SUSESO — Compendio DIAT/DIEP y plazo de 24 horas](https://www.suseso.cl/613/articles-496836_archivo_03.pdf)
- [Ley 21.719, régimen de protección de datos aplicable desde el 1 de diciembre de 2026 — BCN](https://www.bcn.cl/leychile/Navegar/imprimir?idNorma=1209272&idParte=10527471&idVersion=2026-12-01)

La interpretación aplicable a Chome debe ser validada por profesionales competentes antes de configurar reglas regulatorias como definitivas.

---

## 22. Mapa técnico inicial

La lógica nueva debe vivir en `lib/` + `app/`. `modules/` se modifica únicamente para manifiestos, navegación, permisos y grants.

| Frente | Superficies existentes | Superficies nuevas probables |
|---|---|---|
| Toggles/mitigación | `db/schema/system-settings.ts`, `lib/services/module-toggles.ts`, `lib/services/system-settings.ts` | claves y helpers de prevención con defaults seguros |
| PPA | `db/schema/ppa.ts`, `lib/services/ppa-module/reportes.ts`, `lib/validation/ppa.ts`, `app/(app)/prevencion/ppa/**`, `modules/ppa/manifest.ts` | historial de estados, endpoints de corrección/verificación y migración CAPA |
| Documentos | `db/schema/prevention/library.ts`, `lib/services/prevention-documents/**`, `app/(app)/prevencion/documentacion/**`, `modules/prevention/manifest.ts` | distribución nominada, workflow de estado y pruebas de autorización |
| CAPA | `db/schema/prevention/pdtp.ts`, `db/schema/sst.ts`, `db/schema/ppa.ts` | `db/schema/prevention/capa.ts`, `lib/services/prevention-capa/**`, rutas/acciones compartidas |
| Incidentes | agregados en `db/schema/prevention/safety-indicators.ts` y enlaces latentes en biblioteca | `db/schema/prevention/incidents.ts`, `lib/services/prevention-incidents/**`, `app/(app)/prevencion/incidentes/**`, server actions/API y PWA offline |
| Indicadores | `lib/prevention/safety-indicators-calc.ts`, `lib/services/prevention-indicadores*`, `app/(app)/prevencion/indicadores/**`, export API | denominadores, snapshots/versiones de fórmula y conciliación |
| MIPER/legal | PDTP en `db/schema/prevention/pdtp.ts` y `app/(app)/prevencion/pdtp/**` | `db/schema/prevention/risks.ts`, `db/schema/prevention/legal.ts`, servicios y rutas bajo `app/(app)/prevencion/` |
| Privacidad | confidencialidad documental y auditoría general existente | dominio de salud/reservados, política de acceso, cifrado y auditoría especializada |
| RBAC | `modules/prevention/manifest.ts`, `modules/ppa/manifest.ts`, `modules/permissions.ts` | permissions/grants y pruebas rol × faena × endpoint |
| Migraciones | `db/schema/**`, `db/migrations/**` | migraciones generadas y backfills idempotentes por lote |

Pruebas mínimas por superficie:

- ampliar `lib/__tests__/prevention-rbac.test.ts` para exigir los permisos nuevos y sus grants deliberados;
- ampliar `lib/__tests__/safety-indicators-calc.test.ts` con los casos dorados DS 44;
- agregar pruebas DB de estados PPA y CAPA;
- agregar pruebas de workflow, acuses y distribución documental;
- agregar pruebas de incidentes, deadlines, importación y acceso sensible;
- agregar E2E por rol/faena para cierres, publicaciones, denuncias, reinicio y aprobación MIPER.

No se crearán servicios o modelos de negocio bajo `modules/*`; esa superficie se mantiene limitada al contrato de navegación/permisos vigente del repositorio.

---

## 23. Nota sobre el árbol de trabajo

Al momento de crear este plan existen cambios locales sin commit en superficies de documentación, navegación y manifiestos de Prevención. Antes de implementar cada ola se debe revisar ese diff y preservar el trabajo en curso. El plan no autoriza sobrescribir ni descartar esos cambios.
