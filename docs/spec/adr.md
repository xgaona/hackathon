# Registro de decisiones de arquitectura (ADR)

Formato por decisión: contexto, decisión, consecuencias y alternativas descartadas.

| ADR | Decisión | Estado | Requisitos |
|-----|----------|--------|------------|
| ADR-01 | Servicios AWS administrados serverless | Aceptada | RNF-04, RNF-11 |
| ADR-02 | Separación IA / políticas / ejecución | Aceptada | RF-08, RS-01 |
| ADR-03 | Step Functions para flujos transaccionales | Aceptada | RF-09, RF-21 |
| ADR-04 | Un rol IAM por conector | Aceptada (revisada v2) | RS-04 |
| ADR-05 | Guardrails + validación contra catálogo | Aceptada (revisada v2) | RS-06, RS-15 |
| ADR-06 | Mocks con el contrato real | **Reemplazada por ADR-13 y ADR-14** | — |
| ADR-07 | IaC con AWS CDK (TypeScript) | Aceptada | RNF-10 |
| ADR-08 | DynamoDB single-table con TTL | Aceptada | RF-06, RF-20, RNF-06 |
| ADR-09 | Capa de conectores híbrida con `ConnectorPort` | Aceptada | RF-10, RF-12, RNF-13 |
| ADR-10 | Base de conocimiento híbrida por clasificación | Aceptada | RF-13, RF-14, RF-15, RS-16 |
| ADR-11 | Autenticación declarada por conector | Aceptada | RF-11, RS-09, RS-18 |
| ADR-12 | AgentCore Gateway como adaptador MCP/A2A, sin invocación desde la IA | Aceptada. Parcialmente reemplazada por ADR-18 (la activación en `dev` entra en esta entrega) | RF-10.4, RF-10.5, RS-01 |
| ADR-13 | Contratos canónicos + capa anticorrupción | Aceptada | RF-10.3, RF-24.7, RNF-15 |
| ADR-14 | Mocks desde OpenAPI con escenarios, prohibidos en prod | Aceptada | RF-24, RS-17 |
| ADR-15 | Contenido propio curado por administradores, ciclo de publicación y visibilidad general | Aceptada | RF-16, RS-19 |
| ADR-16 | Certificados laborales con generador propio y mock del gestor de recursos | Propuesta | FR6 (Requirements Analysis de AI-DLC) |
| ADR-17 | Ambiente único de desarrollo con mocks para el ejercicio de formación | Propuesta | RNF-08, RNF-10, RS-17 |
| ADR-18 | AgentCore dentro de la entrega, sin invocación desde la IA ni desde el orquestador | Aceptada (opción A, 17/11/2026) | RF-10.4, RF-10.5, RS-01 |

---

## ADR-01 — Servicios AWS administrados serverless

- **Contexto:** carga variable, equipo pequeño, control de costos.
- **Decisión:** Lambda, Step Functions, DynamoDB, SQS, EventBridge, API Gateway, Bedrock Knowledge Bases con almacén vectorial de pago por uso.
- **Consecuencias:** escala automática y pago por uso. Hay que gestionar cold starts y límites de concurrencia.
- **Descartado:** contenedores siempre encendidos.

## ADR-02 — Separación IA / políticas / ejecución

- **Contexto:** un modelo de lenguaje puede ser manipulado por prompt injection, directa o vía contenido recuperado.
- **Decisión:** Bedrock solo propone; el Policy Engine determinístico autoriza; los conectores ejecutan.
- **Consecuencias:** autorizaciones auditables y repetibles. Añade un salto de latencia.
- **Descartado:** que el modelo invoque herramientas o conectores directamente.

## ADR-03 — Step Functions para flujos transaccionales

- **Contexto:** las escrituras en terceros necesitan confirmación, reintentos e idempotencia auditables.
- **Decisión:** Standard Workflows para escrituras; Express Workflows para lecturas e ingesta por página.
- **Consecuencias:** estados explícitos e historial. Costo por transición en Standard.
- **Descartado:** toda la lógica en una Lambda.

## ADR-04 — Un rol IAM por conector

- **Contexto:** un conector comprometido no debe alcanzar otros terceros.
- **Decisión:** cada conector (Daruma, Skkeda, Jira y futuros) tiene su Lambda, rol IAM, secreto y llave de cifrado. La ingesta y la administración de contenido tienen roles propios.
- **Consecuencias:** radio de impacto acotado. Más roles, automatizados vía CDK.
- **Descartado:** un rol compartido de integración.

## ADR-05 — Guardrails + validación contra catálogo

- **Contexto:** el prompt de sistema no frena la manipulación; el contenido recuperado de terceros también puede contener instrucciones.
- **Decisión:** Guardrails for Amazon Bedrock en entrada, sobre el contexto recuperado y en salida (incluida la verificación de anclaje); validación de la capacidad propuesta contra el catálogo.
- **Consecuencias:** defensa en profundidad. Falsos positivos a calibrar.
- **Descartado:** confiar solo en el prompt del sistema.

## ADR-06 — Mocks con el contrato real

- **Estado:** **Reemplazada por ADR-13 y ADR-14.**
- **Motivo:** suponía conocer el contrato real de cada sistema. Daruma y Skkeda no tienen documentación disponible; se necesita un contrato canónico propio (ADR-13) y mocks con escenarios de falla generados desde él (ADR-14).

## ADR-07 — IaC con AWS CDK (TypeScript)

- **Contexto:** tres ambientes reproducibles; mocks solo en dev/test.
- **Decisión:** CDK en TypeScript con `cdk-nag` y aserciones de prueba.
- **Consecuencias:** constructs tipados; la regla de "sin mocks en prod" se verifica en síntesis.
- **Descartado:** Terraform como opción principal (queda como alternativa).

## ADR-08 — DynamoDB single-table con TTL

- **Contexto:** estado simple: catálogo, políticas, conversación, idempotencia, estado de ingesta, metadatos de contenido propio.
- **Decisión:** una tabla con claves compuestas, GSI por usuario y TTL.
- **Consecuencias:** baja latencia sin servidores. El diseño de claves se documenta en `05-datos.md`.
- **Descartado:** RDS.

## ADR-09 — Capa de conectores híbrida con `ConnectorPort`

- **Contexto:** los terceros exponen hoy APIs REST y podrían ofrecer agentes (MCP/A2A) en el futuro. Habrá más terceros.
- **Decisión:** una interfaz propia y estable, `ConnectorPort` (`invoke`, `listKnowledge`), con adaptadores intercambiables declarados en el catálogo (`integrationMode`): `REST_DIRECT` (Lambda por conector, MVP), `MCP_GATEWAY` y `A2A` (vía AgentCore Gateway, ADR-12).
- **Consecuencias:** el núcleo no conoce protocolos ni contratos de proveedor; cambiar de modo es configuración. Hay que mantener el adaptador y sus pruebas de contrato.
- **Descartado:** solo Lambdas REST (cierra la puerta a A2A) y solo AgentCore Gateway (dependencia de un servicio nuevo para el MVP y menor control del saneamiento).

## ADR-10 — Base de conocimiento híbrida por clasificación

- **Contexto:** se quiere todo el conocimiento posible, pero Daruma es la autoridad de permisos y un índice propio no puede replicarlos con garantías.
- **Decisión:** indexar en Amazon Bedrock Knowledge Bases solo contenido `GENERAL` declarado por el origen (denegación por defecto) y el contenido propio de EVA; consultar el contenido restringido de Daruma **en vivo** con la identidad del colaborador. El Knowledge Router combina ambas fuentes con citas y origen.
- **Consecuencias:** cero fuga por índice (CP-10) y respuestas semánticas sobre lo general. La calidad sobre lo restringido depende del buscador de Daruma y suma latencia. Ventana de reclasificación acotada por la frecuencia de ingesta (RNF-14).
- **Descartado:** indexar todo con ACL replicadas (riesgo de desincronización de permisos) y solo búsqueda federada (sin búsqueda semántica propia).

## ADR-11 — Autenticación declarada por conector

- **Contexto:** cada tercero autentica distinto; el usuario se identifica con el Directorio Activo.
- **Decisión:** el catálogo declara `authMode` por conector: `SERVICE_ACCOUNT_USER_CONTEXT` (Daruma y Skkeda, supuesto), `THIRD_PARTY_OAUTH` (Jira 3LO), `DELEGATED_OBO` (terceros con Entra ID) y `NONE` (`eva-native`). La identidad del usuario se declara con una aserción firmada por KMS de 60 s; los tokens OAuth viven en una bóveda cifrada accesible solo por el rol del conector.
- **Consecuencias:** soporte uniforme de terceros heterogéneos sin exponer secretos al modelo ni al navegador. La cuenta de servicio es sensible: rotación, alcance mínimo y aserción firmada para limitar suplantación.
- **Descartado:** una única cuenta técnica sin identidad de usuario (rompe RF-15 y RS-09).

## ADR-12 — AgentCore Gateway como adaptador MCP/A2A, sin invocación desde la IA

- **Contexto:** AgentCore Gateway convierte OpenAPI y Lambda en herramientas MCP, enruta tráfico A2A y gestiona autenticación de entrada y salida. Si el modelo invocara esas herramientas, se rompería ADR-02.
- **Decisión:** el **cliente MCP/A2A es el Connector Runtime** dentro de la capa de ejecución, tras la decisión del Policy Engine. Bedrock nunca recibe la lista de herramientas ni credenciales. En el MVP queda diseñado y probado en dev (prueba de concepto); su activación en prod es Roadmap.
- **Consecuencias:** puerta abierta a agentes de terceros sin cambiar el núcleo. Validar disponibilidad del servicio en la región.
- **Descartado:** agentes autónomos con acceso directo a herramientas MCP.

## ADR-13 — Contratos canónicos + capa anticorrupción

- **Contexto:** no hay documentación de Daruma ni Skkeda y no hay acceso a los proveedores.
- **Decisión:** EVA define contratos OpenAPI 3.1 canónicos (`contratos/`), marcados como SUPUESTO. Cada adaptador traduce canónico ↔ proveedor. Jira usa un subconjunto de su API pública v3.
- **Consecuencias:** se avanza sin depender del proveedor; al recibir la especificación real solo cambia el adaptador. Riesgo de brecha funcional a confirmar con cada proveedor.
- **Descartado:** esperar la documentación oficial para iniciar.

## ADR-14 — Mocks desde OpenAPI con escenarios, prohibidos en prod

- **Contexto:** hay que probar éxito, fallos y seguridad sin proveedores.
- **Decisión:** mocks generados del contrato canónico: Prism en local/CI; Lambda + API Gateway + DynamoDB sintético en dev/test con escenarios por `X-Mock-Scenario`. `MocksStack` solo existe en dev/test; el pipeline bloquea cualquier mock en prod.
- **Consecuencias:** pruebas de contrato y resiliencia reproducibles. Los mocks deben mantenerse alineados al contrato.
- **Descartado:** fallback a mock en producción.

## ADR-15 — Contenido propio curado por administradores, ciclo de publicación y visibilidad general

- **Contexto:** hay conocimiento que ningún tercero documenta: rutas físicas en sedes, guías de proceso entre aplicaciones, tips.
- **Decisión:** base `eva-native` en S3 versionado con metadatos en DynamoDB; solo Administradores de EVA crean y publican; ciclo `DRAFT → PUBLISHED → EXPIRED/RETIRED`; validación automática previa (PII, secretos, clasificación) y visibilidad para todos los colaboradores; indexada como fuente separada de la misma Knowledge Base.
- **Consecuencias:** EVA es autoridad de este contenido. Al ser visible para todos, no admite contenido restringido. Requiere disciplina de vigencias.
- **Descartado:** visibilidad por grupos (no requerida) y edición por dueños de proceso (el usuario definió solo administradores).

## ADR-16 — Certificados laborales con generador propio y mock del gestor de recursos

- **Contexto:** la arquitectura v2 dejaba los certificados laborales fuera de alcance porque los emite otro sistema interno. El equipo decidió incluirlos en esta entrega como parte del ejercicio de formación (D-06). Ese sistema no está disponible, así que se construye el generador desde cero y se conecta a un mock del gestor de recursos (D-20). Este ADR reemplaza lo registrado como fuera de alcance para los certificados.
- **Decisión:** un conector del gestor de recursos (identificador propuesto `rrhh`, **SUPUESTO**: confirmar en Contract Design) que entrega los datos del colaborador autenticado, y un generador de PDF propio (U5). La capacidad `rrhh:certificate.request` es una escritura: pasa por el Policy Engine con `ALLOW_WITH_CONFIRMATION`, usa `idempotencyKey` y registra evidencia. Los datos del empleado se obtienen solo con la identidad del token. En esta entrega el certificado **no incluye salario** (FR6.3, que prevalece sobre D-19); cuando se incorpore, solo se incluirá si el colaborador lo pide de forma expresa (D-19). Contiene nombre, número de documento sintético, cargo, fecha de ingreso y tipo de contrato (FR6.2). Si el gestor no responde o no encuentra al colaborador, no se genera un documento parcial (FR6.4). El certificado sale en PDF por el portal (D-25), con datos sintéticos y marca de documento de ejemplo.
- **Consecuencias:** se agrega un conector y una unidad (U5) sin tocar el orquestador ni el Policy Engine (RNF-13, invariante 11 de `AGENTS.md`). El salario es dato personal sensible (ley colombiana de protección de datos, D-17): no debe aparecer en conversación, trazas ni registros. Es lo primero que se recorta si el tiempo no alcanza (D-26). `AGENTS.md` §1 todavía lista los certificados como fuera de alcance y debe actualizarse cuando el ADR se acepte.
- **Descartado:** reutilizar el sistema interno real (no hay acceso), incluir siempre el salario (riesgo de exposición innecesaria) y generar el certificado desde el modelo de lenguaje (la IA no debe producir documentos con valor formal).

## ADR-17 — Ambiente único de desarrollo con mocks para el ejercicio de formación

- **Contexto:** EVA es un ejercicio de formación sin usuarios reales ni terceros reales (D-13, D-14). Hay un tope de gasto de 200 USD (D-15) y la primera versión es una demostración con el mock de Teams y el portal (D-16). Tres ambientes completos duplican costo y trabajo sin aportar evidencia.
- **Decisión:** se despliega un solo ambiente, `dev`, en `us-east-1` (D-18), con `MocksStack` y `allowMockScenarios=true`. La configuración de `test` y `prod` se conserva en el CDK para que `cdk synth` los genere, pero no se despliegan. `prod` sigue sin sintetizar `MocksStack` y con `allowMockScenarios=false`.
- **Consecuencias:** se mantiene la invariante 9 de `AGENTS.md` (sin mocks en producción, RS-17, CP-13), porque no existe un ambiente productivo desplegado y la configuración de `prod` sigue bloqueándolos. Las pruebas del pipeline solo ejercen `dev`. Las metas de rendimiento y disponibilidad son de referencia y no se miden. Si EVA pasa a un uso real, hay que desplegar `test` y `prod`, validar los contratos con los proveedores y reemplazar este ADR.
- **Descartado:** tres ambientes desplegados (costo) y un único ambiente sin la configuración de `prod` (perdería la verificación de CP-13).

## ADR-18 — AgentCore dentro de la entrega, sin invocación desde la IA ni desde el orquestador

- **Contexto:** la persona decidió que AgentCore entra en esta entrega junto con Step Functions, con un ADR de excepción (D-24, que reemplaza a D-05). ADR-12 lo dejaba preparado y con activación en Roadmap. Las invariantes 1 y 2 de `AGENTS.md` exigen que Bedrock no invoque la Gateway y que solo Step Functions invoque conectores. Dos documentos del repositorio describen otra cosa:
  - `.kiro/steering/agentcore-tools.md` muestra la topología Policy Engine → Orquestador → Gateway → tools y dice que el orquestador solo llama por `tools/call` a la Gateway.
  - `docs/requiremets/.agents/tasks/design-agentcore.md` propone un orquestador agéntico en AgentCore Runtime que **ve y elige herramientas**, con una barrera de autorización delante de la Gateway. Ese documento dice que invierte el principio de ADR-02.

  El diseño agéntico no está reflejado en ADR-01 a ADR-15 (ADR-12 sigue diciendo "sin invocación desde la IA"), por eso este ADR no lo toma como decidido. Verificación del 17/11/2026 en la cuenta de trabajo (E-03): AgentCore Runtime, Gateway, Knowledge Bases y S3 Vectors responden en `us-east-1`; los modelos Claude están bloqueados por una SCP y el orquestador usa `amazon.nova-pro-v1:0`.
- **Decisión (opción A, la que respeta las invariantes):** AgentCore Runtime aloja el Policy Engine, el orquestador y cada tool (una por tercero). AgentCore Gateway expone las tools como MCP. El **único cliente MCP es el Connector Runtime**, que Step Functions invoca después de que el Policy Engine devuelve `ALLOW` o se confirma la acción. El modelo de Bedrock solo devuelve una propuesta JSON validada contra un esquema cerrado y no recibe herramientas, URLs, secretos ni tokens. El rol del orquestador no tiene permiso para invocar la Gateway ni los runtimes de las tools. AgentCore Memory guarda solo contexto conversacional mínimo, sin tokens ni contenido restringido.
- **Registry (decidido):** el Registry de AgentCore **complementa** al catálogo `CONNECTOR#` de DynamoDB y no lo reemplaza. El catálogo versionado y auditado (RF-06, RF-12) sigue siendo la única fuente de las capacidades activas que usa el Policy Engine; el Registry solo sirve para descubrir tools y nunca habilita una capacidad que el catálogo tenga `INACTIVE`. Así el Policy Engine no depende de un servicio adicional.
- **Alternativas:**
  - **B. Orquestador agéntico** (`design-agentcore.md`): el modelo ve las tools y razona sobre ellas. Exige enmendar las invariantes 1 y 2, reemplazar ADR-02 y reescribir ADR-12, y aumenta la superficie de prompt injection. No se adopta en esta entrega.
  - **C. Híbrida:** el código del orquestador (no el modelo) emite `tools/call` a la Gateway después del Policy Engine. Respeta la invariante 1, pero rompe la 2 porque el orquestador tendría permiso sobre la Gateway. Exigiría enmendar la invariante 2.
  - **Descartado en todos los casos:** darle al modelo credenciales o URLs, y dejar AgentCore para después de la entrega (contradice D-24).
- **Consecuencias:** ADR-12 pasa de prueba de concepto a activación en `dev` dentro de esta entrega; al aceptarse este ADR se marca ADR-12 como "Parcialmente reemplazada por ADR-18". Aumenta el costo y la superficie de permisos (`docs/infra/estimacion-costos.md` asume un modelo Claude y debe rehacerse con Nova Pro). La demo local (`demo/`) implementa la opción A.
- **Decisión tomada (17/11/2026):** se adopta la **opción A**. `.kiro/steering/agentcore-tools.md` se corrigió para describir esta topología y `design-agentcore.md` quedó marcado como no vigente (referencia histórica de la opción B). Las invariantes 1 y 2 de `AGENTS.md` no cambian. Las opciones B o C solo podrían reabrirse con un ADR que reemplace a este y a ADR-02.
