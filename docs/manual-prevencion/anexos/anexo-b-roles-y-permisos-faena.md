# Anexo B: Matriz de Roles y Permisos en Terreno

> **Propósito:** Esta tabla clarifica las atribuciones operativas de cada cargo en la plataforma, explicando qué puede hacer cada usuario y por qué ciertas acciones están reservadas o segregadas por ley.

---

## 1. Comparativa de Roles por Función Operativa

| Área / Tarea Operativa | Prevencionista Faena (`prevencionista_faena`) | Jefe de Terreno (`jefe_terreno`) | Supervisor Terreno (`supervisor_terreno`) | Admin. Contrato (`admin_contrato`) | Jefa Depto. Prevención (`prevencionista`) |
|---|:---:|:---:|:---:|:---:|:---:|
| **Ver Inicio y Alertas (`/prevencion`)** | ✅ Sus faenas | ✅ Sus faenas | ✅ Sus faenas | ✅ Sus faenas | ✅ Todas las faenas |
| **Programa de Trabajo (PDTP)** | ✅ Ver y ejecutar | ✅ Ver y ejecutar | ✅ Ver y ejecutar | ✅ Ver y ejecutar | ✅ Aprobar y gestionar |
| **Registrar Constancias** | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Sí |
| **Controles de Alcotest (DO-48)** | ✅ Registrar y enviar | ✅ Registrar | ✅ Registrar | 👁️ Solo ver | ✅ Todo el ciclo |
| **Envío Mensual de Alcotest (N° 32)** | ✅ Sí | ❌ No | ❌ No | ❌ No | ✅ Sí |
| **Ejecutar Inspecciones en Terreno** | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Sí |
| **Ingesta de Report Físico por Foto OCR** | ✅ Sí | ✅ Sí | ❌ No | ✅ Sí | ✅ Sí |
| **Cerrar Inspecciones (Segregado)** | ✅ Si no la ejecutó | ✅ Si no la ejecutó | ❌ No | ❌ No | ✅ Sí |
| **Registrar Charla Diaria 5 min (N° 53)** | ✅ Sí | ✅ Sí | ✅ Sí | ❌ No | ✅ Sí |
| **Dictar Cursos y Capacitaciones** | ✅ Sí | ✅ Sí | ✅ Sí | ❌ No | ✅ Sí |
| **Aprobar Nuevos Cursos en Catálogo** | ❌ No | ❌ No | ❌ No | ❌ No | ✅ Sí |
| **Cerrar Acta Trabajador Nuevo (4 sem)** | ✅ Sí | 👁️ Solo ver | 👁️ Solo ver | 👁️ Solo ver | ✅ Sí |
| **Gestionar y Reactivar Casos PPA** | ✅ Sí | 👁️ Solo ver | 👁️ Solo ver | 👁️ Solo ver | ✅ Sí |
| **Solicitar Permiso de Trabajo (AST)** | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Sí |
| **Verificar Controles y Bloqueo LOTO** | ✅ Sí | ✅ Sí | ❌ No | ❌ No | ✅ Sí |
| **Activar Permiso de Trabajo** | ✅ Sí | ❌ No | ❌ No | ❌ No | ✅ Sí |
| **Reportar Incidentes / Accidentes** | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Sí |
| **Emitir y Subir DIAT (< 24h a Mutual)** | ❌ No | ❌ No | ❌ No | ✅ Sí | ✅ Sí |
| **Investigar Accidente (Árbol Causas)** | ✅ Sí | ✅ Sí | ✅ Sí | 👁️ Solo ver | ✅ Sí |
| **Autorizar Reinicio Operación Suspendida**| ❌ No | ❌ No | ❌ No | ❌ No | ✅ Sí (Segregado) |
| **Confirmar Difusión de Accidente** | ✅ Sí | ✅ Sí | ❌ No | ❌ No | ✅ Sí |
| **Cerrar Expediente RE-20 Definitivo** | ✅ Sí | ❌ No | ❌ No | ❌ No | ✅ Sí |
| **Gestionar y Cerrar Acciones CAPA** | ✅ Verificar | 🛠️ Implementar | 🛠️ Implementar | 🛠️ Implementar | ✅ Todo el ciclo |
| **Cerrar Estadística Mensual (N° 7)** | ✅ Sí | ❌ No | ❌ No | ❌ No | ✅ Sí |
| **Publicar Matriz IPER / Matriz GRD** | ✏️ Proponer | 👁️ Solo ver | 👁️ Solo ver | 👁️ Solo ver | ✅ Publicar |
| **Aprobar Plan de Emergencia (N° 83)** | ✏️ Elaborar | 👁️ Solo ver | 👁️ Solo ver | 👁️ Solo ver | ✅ Aprobar |

---

## 2. Los 3 Motivos por los que un Botón Aparece Deshabilitado

Si en algún momento intentas hacer clic en un botón y no responde o aparece en color gris tenue, comprueba estas 3 razones:

1. **Segregación por Actor ("Quien hace no aprueba"):**  
   Si tú fuiste el usuario que creó una versión de un documento, redactó un plan de emergencia o ejecutó una inspección, el sistema deliberadamente bloquea el botón de aprobación o cierre para tu cuenta. Debe ingresar otro usuario con rol autorizado para firmarlo.
2. **Falta de Alcance en la Faena (`Worksite Scope`):**  
   Los roles de terreno (`prevencionista_faena`, `jefe_terreno`, `supervisor_terreno`) tienen su visibilidad restringida estrictamente a sus faenas asignadas en el contrato. Si intentas consultar datos de otra faena donde no estás registrado, el sistema te mostrará un mensaje de acceso restringido.
3. **Compuerta Previa Incompleta:**  
   En los flujos secuenciales (como el RE-20 de incidentes o la habilitación del trabajador nuevo), un botón no se habilita hasta que el paso anterior esté completado (ejemplo: no puedes cerrar el expediente de un accidente si aún no se adjunta el comprobante de la DIAT).
