# Documento de requisitos

## Introducción

Spec del frente **infra-y-portal** (dueña: Liz). Cubre la infraestructura CDK del stack `eva-dev` (`infra/`) y la lógica del portal (`src/portal/app.js`). El núcleo y los conectores los escriben otros frentes; aquí solo se empaquetan, reciben permisos y se conectan según `.kiro/steering/contrato-mvp.md`.

Las reglas técnicas están en `.kiro/steering/tecnologia.md`, que incluye las lecciones de los ensayos. Fuera de alcance: AgentCore, MCP, VPC, WAF, Route 53, Daruma, Jira real y OAuth.

## Requisitos

### Requisito 1: Identidad y estado

**Historia de usuario:** Como colaboradora quiero ingresar con usuario y contraseña para que mis conversaciones y reservas queden a mi nombre.

#### Criterios de aceptación

1. El sistema DEBE crear el User Pool `eva-dev-usuarios`, sin auto registro, con un cliente público con `USER_PASSWORD_AUTH` y con el usuario `SYN-USR-0001`, creado sin enviarle correo.
2. El sistema DEBE generar la contraseña del usuario de prueba en el secreto `eva/dev/usuario-prueba`. CUANDO la operadora ejecute `infra/scripts/usuario-prueba.mjs` ENTONCES el script DEBE fijarla como permanente sin imprimirla.
3. El sistema DEBE crear la tabla `eva-dev-estado` con `pk` y `sk` de tipo texto, TTL en `ttl` y pago por uso, con lectura y escritura solo para las Lambdas del núcleo y de Skkeda.

### Requisito 2: Base de conocimiento

**Historia de usuario:** Como colaboradora quiero que EVA responda con los documentos de la empresa.

#### Criterios de aceptación

1. El sistema DEBE subir al bucket privado `eva-dev-kb-<cuenta>`, en el prefijo `general/`, solo `data/conocimiento/documentos/general/`. Lo que esté en `restringido/` NO DEBE subirse nunca.
2. El sistema DEBE crear un índice de S3 Vectors con 1024 dimensiones, distancia `cosine` y tipo `float32`, con `AMAZON_BEDROCK_TEXT` y `AMAZON_BEDROCK_METADATA` como `nonFilterableMetadataKeys`.
3. El sistema DEBE crear:
   - la Knowledge Base `eva-dev-kb`, con embeddings `amazon.titan-embed-text-v2:0`;
   - una fuente S3 con `inclusionPrefixes: ["general/"]`;
   - las salidas `KbId` y `DataSourceId`.
4. CUANDO la operadora ejecute `node infra/scripts/ingestar.mjs` ENTONCES el script DEBE lanzar la ingesta, esperar `COMPLETE` y mostrar cuántos documentos indexó. SI termina en `FAILED` ENTONCES DEBE salir con código 1.

### Requisito 3: Guardrail

**Historia de usuario:** Como responsable de seguridad quiero que EVA bloquee ataques de prompt también en español.

#### Criterios de aceptación

1. El sistema DEBE crear el guardrail `eva-dev-guardrail` con nivel `STANDARD` y el perfil entre regiones `us.guardrail.v1:0`.
2. El guardrail DEBE tener estos filtros:
   - `PROMPT_ATTACK` en `HIGH` para la entrada;
   - `MISCONDUCT` en `LOW` para la entrada y en `MEDIUM` para la salida;
   - `INSULTS` en `MEDIUM`;
   - bloqueo de números de tarjeta y contraseñas.
3. El guardrail NO DEBE tener contextual grounding. La `description` de su versión DEBE cambiar en cada ajuste.

### Requisito 4: Conectores y flujo transaccional

**Historia de usuario:** Como arquitecta quiero que solo Step Functions invoque a los conectores.

#### Criterios de aceptación

1. El sistema DEBE crear las Lambdas `eva-dev-skkeda` (con `TABLA_ESTADO`) y `eva-dev-jira` (sin variables ni permisos extra), cada una con su rol.
2. El sistema DEBE crear la máquina Express `eva-dev-transaccional` con un `Choice` que envíe `skkeda:*` a Skkeda y `jira:*` a Jira, y que devuelva el `InvokeResult` sin cambios.
3. SI el prefijo de `capabilityId` es desconocido ENTONCES la máquina DEBE devolver `status: "DENIED"` con `error.code: "UNKNOWN_CONNECTOR"`, sin invocar ninguna Lambda.

### Requisito 5: Núcleo y API `/v1`

**Historia de usuario:** Como núcleo de EVA quiero la configuración y los permisos justos para responder y ejecutar acciones.

#### Criterios de aceptación

1. El sistema DEBE crear la Lambda `eva-dev-nucleo` con las variables de `contrato-mvp.md` §5. `TITULOS_SECCION` DEBE calcularse en la síntesis desde los `##` del corpus. `INVESTIGACION_ACTIVA` DEBE valer `"true"` solo si se despliega con `-c investigacion=true`.
2. El rol del núcleo DEBE tener solo:
   - `bedrock:InvokeModel` sobre Nova Pro;
   - `bedrock:Retrieve` sobre la Knowledge Base;
   - `bedrock:ApplyGuardrail` sobre el guardrail y el perfil `us.guardrail.v1:0`;
   - `states:StartSyncExecution` sobre la máquina;
   - acceso a la tabla.

   NO DEBE tener `lambda:InvokeFunction`.
3. El sistema DEBE crear la API REST `eva-dev-api` con `POST /v1/conversations` y `POST /v1/conversations/{id}/confirm`, ambos con autorizador de Cognito. CUANDO falte el token ENTONCES la API DEBE responder `401`.

### Requisito 6: Entrega del portal

**Historia de usuario:** Como colaboradora quiero abrir EVA desde una URL segura.

#### Criterios de aceptación

1. El sistema DEBE servir `src/portal/` desde un bucket privado con CloudFront y Origin Access Control, y generar `config.json` con `{ region, userPoolId, userPoolClientId }`.
2. CloudFront DEBE enviar `/v1/*` a la API sin caché, con todos los métodos y reenviando `Authorization`.
3. El sistema DEBE aplicar una CSP con `default-src 'self'` y `connect-src 'self' https://cognito-idp.us-east-1.amazonaws.com`, y exponer las salidas `PortalUrl`, `ApiUrl`, `UserPoolId` y `UserPoolClientId`.

### Requisito 7: Portal (ingreso, conversación y confirmación)

**Historia de usuario:** Como colaboradora quiero conversar con EVA, ver sus fuentes y confirmar las reservas.

#### Criterios de aceptación

1. CUANDO la persona ingrese ENTONCES el portal DEBE autenticarse con Cognito `InitiateAuth` y guardar el `IdToken` solo en memoria. SI la API responde `401` ENTONCES el portal DEBE volver a la vista de ingreso.
2. CUANDO llegue una respuesta ENTONCES el portal DEBE mostrar `reply` con `textContent`, como mensaje normal para cualquier `status` (incluido `NEEDS_CLARIFICATION`), junto con:
   - las `citations`, con título, sección y fecha;
   - el bloque "Cómo lo investigué", si hay `researchSteps`.
3. SI hay `pendingAction` ENTONCES el portal DEBE mostrar el `summary` con los botones Confirmar y Cancelar. CUANDO la persona pulse uno ENTONCES el portal DEBE llamar a `/confirm` con el `summaryHash` y deshabilitar ambos botones.
4. El portal DEBE ofrecer como sugerencias las preguntas 1 a 7 de `producto.md`.

### Requisito 8: Prueba de humo

**Historia de usuario:** Como equipo quiero comprobar en un minuto que la demo funciona contra lo desplegado.

#### Criterios de aceptación

1. CUANDO se ejecute `npm run prueba-humo` ENTONCES el script DEBE:
   - leer las salidas de `eva-dev`;
   - iniciar sesión con la contraseña de Secrets Manager, sin imprimirla;
   - comprobar el `401` sin token;
   - ejecutar las preguntas 1 a 7 de la demo, mostrando el `status` obtenido y el esperado.
2. El script DEBE confirmar las reservas, comprobar que reconfirmar no duplica y cancelar al final las reservas creadas, para poder repetirse.
3. CUANDO se use `--investigacion` ENTONCES el script DEBE agregar las preguntas 8 y 9. SI algún paso falla ENTONCES DEBE salir con código 1.
