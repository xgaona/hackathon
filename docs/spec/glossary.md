# Glosario — EVA (Enterprise Virtual Assistant)

> Documento de apoyo del Spec `eva-enterprise-virtual-assistant` (v2.0). Define el vocabulario común usado en `requirements.md`, `design.md` y `tasks.md`.

---

## 1. Términos del dominio

| Término | Definición |
|---------|------------|
| **EVA** | Enterprise Virtual Assistant. Asistente corporativo de Redeban que centraliza aplicaciones de terceros mediante conectores y ofrece una base de conocimiento unificada. |
| **Colaborador** | Empleado de Redeban que usa EVA. Usuario primario. |
| **Administrador de EVA** | Rol que gestiona catálogo, políticas, configuración y publica el contenido propio de EVA. |
| **Tercero** | Aplicación corporativa externa a EVA que es autoridad de su dato: Daruma, Skkeda, Jira y futuras. |
| **Daruma** | Tercero de gestión documental. Autoridad de documentos y de sus permisos. |
| **Skkeda** | Tercero de gestión de reservas de puestos y salas. Autoridad de sedes, disponibilidad y reservas. |
| **Jira** | Tercero de gestión de proyectos. Autoridad de proyectos, issues y flujos de trabajo. |
| **Autoridad del dato** | Principio: el dato y sus reglas viven en el tercero; EVA no los reemplaza ni sustituye su estado. |
| **Confirmación explícita** | Aprobación del colaborador antes de una escritura. Se registra como evidencia. |
| **Acción de escritura** | Operación que modifica información en un tercero (crear reserva, transicionar issue). |
| **Acción de lectura** | Operación que solo consulta información. |
| **Referencia verificable** | Identificador que permite validar el resultado en el tercero (p. ej. número de reserva, clave de issue). |
| **Escalamiento humano** | Transferencia de una solicitud no resuelta a soporte, con contexto no sensible. |
| **Caso de uso (CU)** | Escenario funcional del MVP: CU1 Daruma, CU2 Skkeda, CU3 Jira, CU4 Conocimiento unificado. |
| **MVP** | Minimum Viable Product. Alcance mínimo verificable. |
| **Roadmap** | Capacidad futura, no obligatoria en el MVP. |

---

## 2. Integración con terceros

| Término | Definición |
|---------|------------|
| **Conector** | Componente que integra un tercero con EVA implementando `ConnectorPort`. Tiene rol IAM, secreto y adaptador propios. |
| **ConnectorPort** | Interfaz común de todos los conectores: `invoke(capability, params, userContext)` y `listKnowledge(cursor)`. Contrato estable del núcleo. |
| **Connector Runtime** | Capa de ejecución que, tras la autorización, invoca el conector a través del adaptador declarado. |
| **Catálogo de conectores** | Registro versionado de conectores: capacidades, modo de integración, modo de autenticación, fuente de conocimiento, secreto y estado. |
| **Capacidad** | Operación declarada de un conector con esquema de parámetros, tipo, riesgo y permisos (p. ej. `space.availability`). |
| **Modo de integración** | Cómo se comunica el conector con el tercero: `REST_DIRECT` (API REST), `MCP_GATEWAY` (herramientas MCP vía AgentCore Gateway) o `A2A` (agente a agente). |
| **Modo de autenticación** | Cómo se autentica el conector ante el tercero: `DELEGATED_OBO`, `SERVICE_ACCOUNT_USER_CONTEXT`, `THIRD_PARTY_OAUTH` o `NONE`. |
| **DELEGATED_OBO** | On-Behalf-Of: intercambio del token del usuario por un token delegado con audiencia del tercero. |
| **SERVICE_ACCOUNT_USER_CONTEXT** | Credencial técnica de EVA más una aserción firmada con la identidad del usuario (UPN); el tercero aplica sus permisos sobre ese usuario. |
| **THIRD_PARTY_OAUTH** | Autorización OAuth 2.0 del propio tercero otorgada por el colaborador (p. ej. Jira 3LO). |
| **Aserción de usuario** | JWT de vida corta firmado por EVA con KMS que declara el UPN del colaborador ante un tercero. |
| **Contrato canónico** | Especificación OpenAPI definida por EVA para un tercero sin documentación pública. Es un supuesto a validar con el proveedor. |
| **Capa anticorrupción** | Traducción entre el contrato canónico de EVA y el contrato real del proveedor, aislada en el adaptador. |
| **MCP** | Model Context Protocol. Protocolo estándar para exponer herramientas a agentes. |
| **A2A** | Agent-to-Agent. Protocolo de interoperabilidad entre agentes de IA. |
| **AgentCore Gateway** | Servicio de Amazon Bedrock AgentCore que convierte APIs y Lambdas en herramientas MCP, enruta tráfico A2A y gestiona autenticación de entrada y salida. |
| **Cortocircuito (circuit breaker)** | Mecanismo que aísla temporalmente un conector con fallos repetidos. |

---

## 3. Base de conocimiento

| Término | Definición |
|---------|------------|
| **Base de conocimiento unificada** | Conjunto de fuentes que EVA consulta para responder preguntas: contenido propio, contenido general de conectores y contenido restringido en vivo. |
| **Contenido general** | Contenido apto para todos los colaboradores (`classification = GENERAL`). Se indexa. |
| **Contenido restringido** | Contenido sujeto a permisos del tercero. Nunca se indexa; solo se consulta en vivo con la identidad del usuario. |
| **Clasificación** | Etiqueta declarada por el origen (`GENERAL`, `RESTRICTED`). Ausente o desconocida equivale a no indexable. |
| **Ingesta** | Proceso programado que obtiene contenido general de los conectores mediante `listKnowledge` y lo indexa. |
| **Knowledge Router** | Componente que, según la decisión del Policy Engine, combina recuperación del índice, contenido propio y consulta en vivo. |
| **Cita** | Referencia a la fuente de un fragmento usado en la respuesta: título, enlace, origen y fecha. |
| **Origen** | Procedencia de un dato o cita: `eva` (propio), `index` (indexado), `live` (tercero en vivo), `mock` (simulado). |
| **Base de conocimiento propia (`eva-native`)** | Contenido creado y publicado por los Administradores de EVA. Visible para todos los colaboradores. |
| **Documento (`DOCUMENT`)** | Guía, FAQ o manual propio de EVA. |
| **Ruta (`ROUTE`)** | Guía paso a paso. Subtipo `PROCESS`: cómo hacer un trámite en una aplicación. Subtipo `PHYSICAL`: cómo llegar a un piso, sala o puesto en una sede. |
| **Tip (`TIP`)** | Consejo corto sobre un tema. |
| **Ciclo de publicación** | Estados del contenido propio: `DRAFT → PUBLISHED → EXPIRED`, con retiro manual a `RETIRED`. |
| **Frescura** | Antigüedad del contenido indexado respecto a su origen. |
| **Prompt injection indirecta** | Instrucciones maliciosas incrustadas en contenido recuperado (documentos, respuestas de terceros). |
| **Verificación de anclaje (grounding)** | Control de Guardrails que verifica que la respuesta se sustente en el contenido recuperado. |

---

## 4. Pruebas y mocks

| Término | Definición |
|---------|------------|
| **Mock** | Simulación de un tercero que implementa su contrato canónico con datos sintéticos. Solo dev/test. |
| **Escenario de mock** | Comportamiento seleccionable con la cabecera `X-Mock-Scenario`: `ok`, `timeout`, `server_error`, `access_denied`, `conflict`, `rate_limited`, `stale_classification`. |
| **Prueba de contrato** | Verificación de que conector y mock cumplen el mismo contrato OpenAPI. |
| **Datos sintéticos** | Datos ficticios sin relación con personas o documentos reales. |
| **Conector piloto** | Conector de ejemplo incorporado para demostrar extensibilidad sin cambios en el núcleo. |

---

## 5. Arquitectura y seguridad

| Término | Definición |
|---------|------------|
| **Spec-Driven Development** | Metodología de Kiro: Requirements → Design → Tasks. |
| **Orquestador** | Componente que coordina identidad, NLU, autorización y flujo; no ejecuta acciones de dominio. |
| **Policy Engine** | Componente determinístico que autoriza o deniega cada acción o consulta. No usa IA. |
| **Separación razonamiento / autorización / ejecución** | La IA **propone**, el Policy Engine **autoriza**, los conectores **ejecutan**. |
| **Directorio Activo** | Fuente de identidad corporativa (Entra ID o AD con ADFS), federada con Cognito. |
| **UPN** | User Principal Name. Identificador corporativo del colaborador en el Directorio Activo. |
| **Zero Trust** | Ninguna solicitud es confiable por su origen; se autentica y autoriza cada una. |
| **Mínimo privilegio** | Cada componente recibe solo los permisos estrictamente necesarios. |
| **Idempotencia** | Repetir una operación con la misma clave no produce efectos duplicados. |
| **correlationId** | Identificador único de una interacción, propagado por todas las capas y conectores. |
| **Entrada no confiable** | Todo contenido externo o recuperado, que se valida y sanea antes de usarse. |
| **PII** | Datos personales identificables. |
| **DLQ** | Dead-Letter Queue. Cola de mensajes no procesables tras reintentos. |
| **IaC** | Infrastructure as Code. |
| **ADR** | Architecture Decision Record. |
| **EARS** | Easy Approach to Requirements Syntax (`CUANDO/SI… ENTONCES el sistema DEBE…`). |
| **NLU** | Natural Language Understanding. |
| **TTL** | Time To Live. Vencimiento automático de ítems efímeros. |
| **DoD** | Definition of Done. Criterio verificable de tarea terminada. |

---

## 6. Servicios AWS referenciados

| Servicio | Rol en EVA |
|----------|------------|
| **Amazon S3** | Frontend estático, contenido ingerido, contenido propio versionado y evidencia inmutable. |
| **Amazon CloudFront** | Distribución del canal web. |
| **AWS WAF** | Protección perimetral. |
| **Amazon API Gateway** | APIs `/v1` y `/v1/admin`, validación de token; también expone los mocks en dev/test. |
| **Amazon Cognito** | Autenticación federada con el Directorio Activo. |
| **Amazon Bedrock** | Modelos para intención, extracción y generación de respuestas. |
| **Guardrails for Amazon Bedrock** | Filtros de entrada/salida, PII y verificación de anclaje. |
| **Amazon Bedrock Knowledge Bases** | Índice vectorial y recuperación con filtros de metadatos. |
| **Amazon S3 Vectors** | Almacén vectorial de pago por uso para la Knowledge Base (alternativa: OpenSearch Serverless). |
| **Amazon Bedrock AgentCore Gateway** | Adaptador MCP/A2A preparado para conectores futuros. |
| **Amazon Comprehend** | Detección de PII antes de publicar contenido propio. |
| **AWS Lambda** | Orquestador, Policy Engine, conectores, ingesta, Knowledge Router y mocks. |
| **AWS Step Functions** | Flujos transaccionales y de ingesta. |
| **Amazon DynamoDB** | Catálogo, políticas, estado, idempotencia, trazabilidad, estado de ingesta y metadatos de contenido propio. |
| **Amazon SQS / DLQ** | Desacoplamiento y cola de excepciones. |
| **Amazon EventBridge** | Escalamiento, eventos de dominio y Scheduler de ingesta y vencimiento. |
| **AWS Secrets Manager** | Credenciales de conectores. |
| **AWS KMS** | Cifrado y firma de aserciones de usuario. |
| **Amazon CloudWatch / AWS X-Ray** | Logs, métricas, tableros, alarmas y trazas. |
| **AWS CloudTrail** | Auditoría inmutable. |
| **AWS CDK** | Infraestructura como código. |

---

## 7. Prefijos de identificadores

| Prefijo | Significado | Ejemplo |
|---------|-------------|---------|
| **RF-xx** | Requisito funcional | RF-18 (Skkeda) |
| **RNF-xx** | Requisito no funcional | RNF-13 (Extensibilidad) |
| **RS-xx** | Requisito de seguridad | RS-16 (Restringido nunca indexado) |
| **T-xx** | Tarea de implementación | T-12 (Connector Runtime) |
| **ADR-xx** | Decisión de arquitectura | ADR-09 (Capa de conectores híbrida) |
| **CP-xx** | Propiedad de correctitud | CP-10 (Índice sin contenido restringido) |
| **CUx** | Caso de uso | CU2 (Skkeda) |
