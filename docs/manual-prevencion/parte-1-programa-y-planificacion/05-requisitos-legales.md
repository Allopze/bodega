# Capítulo 05: Matriz de Requisitos Legales y Evaluación de Cumplimiento

> **Marco Normativo:** Marco legal general de SST (Código del Trabajo, Ley 16.744, DS 44, DS 594, DS 76, DS 54, Ley 18.290 de Tránsito y Decretos sectoriales).  
> **Ruta en Plataforma:** Menú > Prevención > **Requisitos legales** (`/prevencion/requisitos-legales`).

---

## 1. Propósito de la Matriz Legal

La Matriz de Requisitos Legales es el catálogo normativo donde la empresa identifica, evalúa y demuestra el cumplimiento de **todas las leyes, decretos y resoluciones aplicables a cada faena**.

Durante una auditoría de certificación (ISO 45001, auditoría del cliente mandante o fiscalización de la Inspección del Trabajo), la matriz legal es el documento probatorio donde el prevencionista exhibe qué cuerpos legales aplican a la faena y con qué documentos o registros se demuestra su cumplimiento.

---

## 2. Consulta y Filtros de la Matriz

Al ingresar a `/prevencion/requisitos-legales`:
1. **Selección de Faena:** Filtra por tu faena asignada.
2. **Clasificación por Materia:**
   *   *Seguridad General:* Código del Trabajo (Art. 184 sobre deber general de protección del empleador), DS 44 (SG-SST).
   *   *Condiciones Sanitarias y Ambientales:* DS 594 (servicios higiénicos, agua potable, comedores, ventilación, límites de ruido y contaminantes).
   *   *Higiene y Salud Ocupacional:* Protocolos MINSAL (PREXOR, PLANESI, TMERT, Radiación UV, Psicosocial).
   *   *Vehículos y Conducción:* Ley de Tránsito, Decretos del Ministerio de Transportes sobre tiempos de conducción y descanso.
   *   *Comités Paritarios:* DS 54.

---

## 3. Estados de Cumplimiento de Cada Requisito

Cada artículo normativo contiene una ficha técnica con los siguientes campos:

| Estado de Cumplimiento | Criterio de Evaluación en Terreno | Acción Requerida por el PRF |
|---|---|---|
| 🟢 **Cumple totalmente** | La exigencia se cumple y se cuenta con la evidencia documental o física respaldada. | Mantener actualizada la evidencia ante vencimientos (ej. calibraciones anuales o resoluciones). |
| 🟡 **En proceso de implementación** | Se iniciaron las gestiones pero falta el respaldo formal (ej. trámite en curso ante la SEREMI). | Monitorear el avance y registrar el número de expediente o carta de ingreso. |
| 🔴 **No cumple (Brecha)** | La faena presenta una desviación o incumplimiento frente a la ley. | Generar de inmediato una Acción Correctiva en `/prevencion/capa` para subsanar la brecha con plazo definido. |
| ⚪ **No aplicable** | La norma no corresponde a las operaciones de la faena (ej. trabajos submarinos o faenas de gran minería subterránea). | Debe contar con una justificación técnica escrita de por qué no aplica. |

---

## 4. Cómo Adjuntar Evidencias de Cumplimiento

Para respaldar una exigencia legal (por ejemplo, *Resolución Sanitaria del Comedor y Baños de la Faena* o *Certificados de Calibración de Alcotest*):

1. En la tabla de requisitos legales, haz clic en el requisito deseado.
2. Presiona **"Editar evaluación"**.
3. En la sección de **Evidencia**, haz clic en **"Adjuntar archivo"** y sube el PDF correspondiente (resolución, certificado o informe técnico).
4. Escribe una breve referencia (ej. *Resolución Sanitaria N° 1245 de SEREMI de Salud Biobío, vigente hasta diciembre 2027*).
5. Presiona **"Guardar cambios"**.

---

## 5. Exportación del Expediente Legal en Excel

Para entregar un informe formal al Administrador de Contrato o a un fiscalizador:

1. En la esquina superior derecha de `/prevencion/requisitos-legales`, haz clic en **"Exportar Excel"**.
2. El sistema descargará una planilla con:
   *   Cuerpo legal, artículo y texto de la norma.
   *   Nivel de exigencia y faena evaluada.
   *   Estado de cumplimiento actual.
   *   Enlace a los documentos de respaldo.
   *   Fecha de la última evaluación y profesional evaluador.
