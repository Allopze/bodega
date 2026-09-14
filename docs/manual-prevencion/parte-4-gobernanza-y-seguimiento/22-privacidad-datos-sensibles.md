# Capítulo 22: Protección de Datos Personales y Confidencialidad Médica

> **Marco Normativo:** Ley 21.719 (Protección de Datos Personales), Ley 20.584 (Derechos y Deberes del Paciente) y Secreto Profesional.  
> **Ruta en Plataforma:** Menú > Seguimiento > **Datos personales** (`/prevencion/privacidad`).

---

## 1. La Ley 21.719 en la Prevención de Riesgos

La nueva Ley de Protección de Datos Personales en Chile impone sanciones severas a las empresas que recopilen, compartan o expongan información médica privada de sus trabajadores sin autorización expresa o sin las medidas de seguridad debidas.

En el área de Prevención se manipulan datos altamente delicados (exámenes ocupacionales, accidentes, alcoholimetría y restricciones de salud). Por ello, la plataforma implementa un **aislamiento estricto entre los datos operativos y los datos clínicos reservados**.

---

## 2. La Regla de Oro: Aptitud Laboral vs. Diagnóstico Médico

Es fundamental que todo Prevencionista de Faena, Jefe de Terreno y Supervisor comprenda esta diferencia:

| Información que el PRF DEBE conocer y registrar | Información que el PRF NUNCA debe pedir ni registrar |
|---|---|
| 🟢 **Aptitud Laboral Funcional:** <br>• *"Apto para conducción profesional"*. <br>• *"Apto con restricción para trabajar en altura física superior a 1.8 metros"*. <br>• *"Restricción de exposición a ruido sobre 85 dB(A)"*. | 🔴 **Diagnóstico Médico o Historia Clínica:** <br>• Resultados de exámenes de sangre, ecografías o biopsias. <br>• Diagnósticos de enfermedades crónicas, cáncer, VIH o tratamientos psiquiátricos. <br>• Detalle de fármacos personales que consume el trabajador. |

> [!WARNING]
> **Prohibición Absoluta:**  
> Nunca subas a la plataforma una fotografía de una receta médica, una licencia médica con diagnóstico visible o un informe clínico confidencial. Si la Mutual te entrega un certificado, asegúrate de subir únicamente la hoja de **"Certificado de Aptitud Ocupacional"**.

---

## 3. Gestión de Solicitudes de los Trabajadores (Derechos del Titular)

Cualquier trabajador de la faena tiene derecho legal a solicitar conocer qué datos personales y de seguridad existen sobre él en la empresa:

1. **Derecho de Acceso:** El trabajador puede solicitar un consolidado de sus capacitaciones, inducciones ODI recibidas, entregas de EPP y accidentes reportados.
2. **Derecho de Rectificación:** Si su RUT, nombre, cargo o faena están mal digitados, puede solicitar la corrección inmediata.
3. **Registro en Plataforma:** En `/prevencion/privacidad/solicitudes`, el administrador registra y gestiona las solicitudes ciudadanas entregando exportaciones anonimizadas y minimizadas conforme a la ley.

---

## 4. Auditoría de Accesos a Datos Sensibles

Para tranquilidad de los trabajadores y respaldo de la empresa ante el Consejo para la Transparencia y la Agencia de Protección de Datos:
*   Cada vez que un usuario consulta información médica restringida o abre un expediente de accidente con antecedentes sensibles, **el sistema guarda un registro de auditoría inmutable** (quién consultó, a qué hora, desde qué dirección IP y con qué propósito justificado).
*   En `/prevencion/privacidad/auditoria`, la jefatura puede supervisar que nadie consulte información privada sin una razón operativa legítima.
