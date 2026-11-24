# Documento de requisitos

## Introducción

Spec del frente **infra-y-portal** (dueña: Liz). Cubre la infraestructura AWS CDK del stack `eva-dev` (`infra/lib/eva-stack.ts`) y la lógica del portal (`src/portal/app.js`). El núcleo, los conectores y el corpus los escriben otros frentes; aquí solo se empaquetan, reciben permisos y se conectan según `.kiro/steering/contrato-mvp.md`.

Fuentes: `.kiro/steering/*` (en especial `tecnologia.md`, con sus lecciones 1 a 16, e `invariantes.md`), `docs/spec/06-seguridad.md` y `docs/spec/09-api.md`.

**Fuera de alcance:** AgentCore, MCP, VPC, WAF, Route 53, dominios propios, Daruma y Jira real.

**Convenciones de este documento**

- "La operadora" es la persona que ejecuta comandos contra AWS (Liz). Kiro propone esos comandos y no los ejecuta.
- No se modifican `src/portal/index.html` ni `src/portal/styles.css`, ni los `id` que ya tienen.
- Los nombres de recursos siguen `eva-dev-<recurso>` mediante `infra/lib/nombres.ts`.

## Requisitos

### Requisito 1: Esqueleto desplegable temprano (tarea 1)

**Historia de usuario:** Como operadora quiero desplegar pronto una versión mínima de EVA para detectar problemas de cuenta y de credenciales antes de construir el resto.

#### Criterios de aceptación

1. El sistema DEBE crear, en este orden: el User Pool de Cognito con su cliente y el usuario de prueba, la tabla `eva-dev-estado`, la Lambda del núcleo (stub existente en `src/nucleo/handler.ts`), la API REST con sus dos rutas y el portal con su `config.json`.
2. CUANDO la operadora despliegue solo el esqueleto ENTONCES el stack DEBE sintetizarse y desplegarse sin necesitar la base de conocimiento, el guardrail ni los conectores.
3. MIENTRAS el esqueleto no incluya la base de conocimiento ni el guardrail, la Lambda del núcleo NO DEBE recibir `KB_ID`, `GUARDRAIL_ID`, `GUARDRAIL_VERSION` ni `FLUJO_TRANSACCIONAL_ARN` con valores inventados.
4. El sistema DEBE entregar, con cada tarea, pruebas con `aws-cdk-lib/assertions` en un archivo `*.test.ts` junto al código, que verifiquen los recursos de esa tarea.

### Requisito 2: Identidad (Cognito y usuario de prueba)

**Historia de usuario:** Como colaboradora quiero ingresar con usuario y contraseña para que mis conversaciones y reservas queden a mi nombre.

#### Criterios de aceptación

1. El sistema DEBE crear un Cognito User Pool sin auto registro y un cliente público (sin secreto) con el flujo `USER_PASSWORD_AUTH`.
2. El sistema DEBE crear el usuario `SYN-USR-0001` sin enviarle correo ni invitación.
3. El sistema DEBE generar la contraseña del usuario de prueba en el secreto de Secrets Manager `eva/dev/usuario-prueba`, con cifrado.
4. CUANDO la operadora ejecute `infra/scripts/usuario-prueba.mjs` después del primer despliegue ENTONCES el script DEBE leer el secreto con AWS CLI y fijarlo como contraseña permanente del usuario.
5. El script `usuario-prueba.mjs` NO DEBE imprimir la contraseña en la salida, en los errores ni en los registros.
6. El sistema NO DEBE pasar la contraseña a ningún recurso personalizado de CloudFormation (CloudFormation no admite secretos en recursos personalizados).

### Requisito 3: Tabla de estado

**Historia de usuario:** Como núcleo y como conector de Skkeda quiero una tabla de estado para guardar turnos, acciones pendientes, idempotencia y reservas.

#### Criterios de aceptación

1. El sistema DEBE crear la tabla `eva-dev-estado` con `pk` y `sk` de tipo texto, TTL en el atributo `ttl`, pago por uso y cifrado en reposo, según `contrato-mvp.md` §6.
2. El sistema DEBE conceder lectura y escritura sobre la tabla solo a las Lambdas del núcleo y de Skkeda.
3. La tabla DEBE tener `RemovalPolicy.DESTROY`.

### Requisito 4: Base de conocimiento (tarea 2)

**Historia de usuario:** Como colaboradora quiero que EVA responda solo con los documentos generales de la empresa.

#### Criterios de aceptación

1. El sistema DEBE crear el bucket privado `eva-dev-kb-<cuenta>` con `blockPublicAccess` y `enforceSSL`.
2. El sistema DEBE subir con `BucketDeployment` únicamente el contenido de `data/conocimiento/documentos/general/` al prefijo `general/`. El contenido de `restringido/` NO DEBE subirse nunca.
3. El sistema DEBE crear un `CfnVectorBucket` y un `CfnIndex` de S3 Vectors con dimensión 1024, métrica `cosine` y tipo `float32`, con `AMAZON_BEDROCK_TEXT` y `AMAZON_BEDROCK_METADATA` como `nonFilterableMetadataKeys`.
4. El sistema DEBE crear un rol IAM propio para la Knowledge Base, con mínimo privilegio: lectura del bucket de origen, invocación de `amazon.titan-embed-text-v2:0` y operaciones sobre el índice de S3 Vectors. El rol NO DEBE usar `"Action": "*"` ni `"Resource": "*"`.
5. El sistema DEBE crear la `CfnKnowledgeBase` de tipo `VECTOR` con embeddings `amazon.titan-embed-text-v2:0` y almacenamiento `S3_VECTORS`.
6. El sistema DEBE crear una `CfnDataSource` de tipo S3 sobre el bucket de origen con `inclusionPrefixes` igual a `["general/"]`.
7. El sistema DEBE exponer las salidas `KbId` y `DataSourceId`.
8. CUANDO la operadora ejecute `infra/scripts/ingestar.mjs` ENTONCES el script DEBE lanzar `StartIngestionJob`, esperar el estado `COMPLETE` y mostrar cuántos documentos indexó.
9. SI el trabajo de ingesta termina en `FAILED` ENTONCES `ingestar.mjs` DEBE mostrar el motivo y salir con código distinto de cero.
10. CUANDO la tarea 2 esté desplegada ENTONCES la Lambda del núcleo DEBE recibir `KB_ID` y el permiso `bedrock:Retrieve` sobre esa Knowledge Base.

### Requisito 5: Guardrail

**Historia de usuario:** Como responsable de seguridad quiero que EVA bloquee ataques de prompt también en español.

#### Criterios de aceptación

1. El sistema DEBE crear un `CfnGuardrail` con `contentFiltersTierConfig` de nivel `STANDARD` y `crossRegionConfig.guardrailProfileArn` igual a `arn:aws:bedrock:us-east-1:<cuenta>:guardrail-profile/us.guardrail.v1:0` (lección 2).
2. El guardrail DEBE incluir estos filtros de contenido:
   - `PROMPT_ATTACK` con fuerza alta en la entrada;
   - `MISCONDUCT` con fuerza baja en la entrada y media en la salida (lección 4);
   - `INSULTS` con fuerza media.
3. El guardrail DEBE bloquear números de tarjeta y contraseñas.
4. El guardrail NO DEBE tener contextual grounding (lección 3).
5. El sistema DEBE crear un `CfnGuardrailVersion` cuya `description` se cambie en cada ajuste del guardrail (lección 5).
6. El sistema DEBE entregar `GUARDRAIL_ID` y `GUARDRAIL_VERSION` a la Lambda del núcleo.

### Requisito 6: Conectores y flujo transaccional

**Historia de usuario:** Como arquitecta quiero que solo Step Functions invoque a los conectores, para que el núcleo no pueda ejecutarlos directamente.

#### Criterios de aceptación

1. El sistema DEBE crear una Lambda para Skkeda (`src/conectores/skkeda/handler.ts`, con `TABLA_ESTADO`) y otra para Jira (`src/conectores/jira/handler.ts`, sin variables de entorno), cada una con su propio rol IAM.
2. El rol de la Lambda de Jira NO DEBE tener permisos adicionales a los básicos de ejecución y registro.
3. El sistema DEBE crear la máquina Step Functions Express `eva-dev-transaccional` según `contrato-mvp.md` §4: un estado `Choice` con una rama por prefijo de `capabilityId` (`skkeda:` y `jira:`), cada rama invoca la Lambda correspondiente y la salida es el `InvokeResult` sin cambios.
4. SI el prefijo de `capabilityId` no es `skkeda:` ni `jira:` ENTONCES la máquina DEBE devolver un `InvokeResult` con `status: "DENIED"` sin invocar ninguna Lambda.
5. La máquina DEBE registrar su ejecución con `includeExecutionData = false`.
6. El sistema DEBE conceder `lambda:InvokeFunction` sobre las Lambdas de los conectores solo al rol de la máquina.

### Requisito 7: Lambda del núcleo

**Historia de usuario:** Como núcleo de EVA quiero la configuración y los permisos justos para responder y ejecutar acciones.

#### Criterios de aceptación

1. El sistema DEBE crear la Lambda del núcleo con `NodejsFunction` sobre `src/nucleo/handler.ts`, arquitectura arm64, Node 22, `externalModules: []` y timeout de 28 segundos.
2. El sistema DEBE entregarle las variables de `contrato-mvp.md` §5: `TABLA_ESTADO`, `KB_ID`, `FLUJO_TRANSACCIONAL_ARN`, `MODEL_ID` (`amazon.nova-pro-v1:0`), `GUARDRAIL_ID`, `GUARDRAIL_VERSION`, `TITULOS_SECCION` e `INVESTIGACION_ACTIVA`.
3. El sistema DEBE calcular `TITULOS_SECCION` durante la síntesis, leyendo los títulos `##` de `data/conocimiento/documentos/general/*.md`, sin repetidos, separados por `|` y ordenados del más largo al más corto (lección 7).
4. El sistema DEBE leer `INVESTIGACION_ACTIVA` del contexto `-c investigacion=true`. CUANDO el contexto no se indique ENTONCES el valor DEBE ser `"false"`.
5. El rol de la Lambda del núcleo DEBE tener únicamente estos permisos:
   - `bedrock:InvokeModel` sobre el modelo `amazon.nova-pro-v1:0`;
   - `bedrock:Retrieve` sobre la Knowledge Base;
   - `bedrock:ApplyGuardrail` sobre el guardrail y sobre el perfil `us.guardrail.v1:0`;
   - `states:StartSyncExecution` sobre `eva-dev-transaccional`;
   - lectura y escritura sobre `eva-dev-estado`;
   - los permisos básicos de registro de Lambda.
6. El rol del núcleo NO DEBE tener `lambda:InvokeFunction` (invariante 2) ni `"Action": "*"` ni `"Resource": "*"` fuera de lo que AWS exige para registro.
7. El sistema NO DEBE activar el registro de invocaciones de Bedrock.

### Requisito 8: API REST

**Historia de usuario:** Como portal quiero llamar a EVA por una API protegida con el token de Cognito.

#### Criterios de aceptación

1. El sistema DEBE crear una API REST con `POST /v1/conversations` y `POST /v1/conversations/{id}/confirm`, ambas integradas con la Lambda del núcleo.
2. Ambas rutas DEBEN usar un autorizador de Cognito sobre el User Pool.
3. CUANDO una solicitud no lleve token válido ENTONCES la API DEBE responder `401`.
4. El sistema NO DEBE exponer otras rutas.

### Requisito 9: Entrega del portal

**Historia de usuario:** Como colaboradora quiero abrir EVA desde una URL segura y única.

#### Criterios de aceptación

1. El sistema DEBE servir el contenido de `src/portal/` desde un bucket privado, con `blockPublicAccess` y `enforceSSL`, detrás de CloudFront con Origin Access Control.
2. El sistema DEBE generar `config.json` con `Source.jsonData` y el contenido `{ region, userPoolId, userPoolClientId }`.
3. CloudFront DEBE enviar `/v1/*` a la API sin caché, con todos los métodos HTTP y reenviando la cabecera `Authorization`.
4. CloudFront DEBE añadir una cabecera `Content-Security-Policy` cuyo `connect-src` permita `'self'` y `https://cognito-idp.us-east-1.amazonaws.com`.
5. El sistema DEBE exponer las salidas `PortalUrl`, `ApiUrl`, `UserPoolId` y `UserPoolClientId`.

### Requisito 10: Portal, ingreso y conversación

**Historia de usuario:** Como colaboradora quiero conversar con EVA y ver de dónde sale cada respuesta.

#### Criterios de aceptación

1. CUANDO la persona ingrese usuario y contraseña ENTONCES `app.js` DEBE llamar con `fetch` a Cognito `InitiateAuth` con `USER_PASSWORD_AUTH`, usando `region` y `userPoolClientId` de `/config.json`.
2. El portal DEBE guardar el token solo en memoria, sin `localStorage`, `sessionStorage` ni cookies.
3. SI la API responde `401` ENTONCES el portal DEBE descartar el token y volver a la vista de ingreso.
4. CUANDO la persona envíe un mensaje ENTONCES el portal DEBE enviarlo a `POST /v1/conversations` con `Authorization: Bearer <token>`, conservando el `conversationId` devuelto para los mensajes siguientes.
5. El portal DEBE mostrar los mensajes de la persona y de EVA como burbujas distintas.
6. El portal DEBE mostrar todo texto recibido con `textContent`, nunca como HTML.
7. El portal DEBE mostrar `reply` como un mensaje normal de EVA para cualquier `status`, incluido `NEEDS_CLARIFICATION`.
8. El portal DEBE ofrecer como sugerencias las preguntas 1 a 7 de la demo de `producto.md`.

### Requisito 11: Portal, fuentes, investigación y confirmación

**Historia de usuario:** Como colaboradora quiero ver las fuentes, saber cómo se investigó una respuesta y confirmar o cancelar las reservas.

#### Criterios de aceptación

1. CUANDO la respuesta traiga `citations` ENTONCES el portal DEBE mostrar una lista de fuentes con título, sección y fecha de cada una.
2. CUANDO la respuesta traiga `researchSteps` ENTONCES el portal DEBE mostrar un bloque plegable "Cómo lo investigué" con cada subpregunta, si se encontró o no y los documentos donde se encontró.
3. CUANDO la respuesta no traiga `researchSteps` ENTONCES el portal NO DEBE mostrar ese bloque.
4. CUANDO la respuesta traiga `pendingAction` ENTONCES el portal DEBE mostrar el `summary` con los botones Confirmar y Cancelar.
5. CUANDO la persona pulse Confirmar o Cancelar ENTONCES el portal DEBE llamar a `POST /v1/conversations/{id}/confirm` con el `summaryHash` de la acción y la decisión elegida, y mostrar la respuesta como un mensaje nuevo de EVA.
6. MIENTRAS la llamada de confirmación esté en curso o ya se haya resuelto, el portal DEBE deshabilitar ambos botones.

### Requisito 12: Prueba de humo contra lo desplegado

**Historia de usuario:** Como equipo quiero comprobar en pocos minutos que la demo funciona contra lo desplegado.

#### Criterios de aceptación

1. CUANDO la operadora ejecute `infra/scripts/prueba-humo.mjs` ENTONCES el script DEBE iniciar sesión con el usuario de prueba, leyendo la contraseña de Secrets Manager sin imprimirla.
2. El script DEBE ejecutar las preguntas 1 a 7 de la demo de `producto.md`, incluida la conversación de varios turnos "piso 3" → "El jueves" → confirmar.
3. Para cada paso el script DEBE mostrar el `status` obtenido, los títulos de las citas y, si existe, el resumen de la acción pendiente.
4. CUANDO se ejecute con `--investigacion` ENTONCES el script DEBE agregar las preguntas 8 y 9 de la demo y mostrar también los `researchSteps` de cada respuesta.
5. El script NO DEBE imprimir contraseñas ni tokens.

### Requisito 13: Seguridad transversal

**Historia de usuario:** Como responsable de seguridad quiero que la infraestructura cumpla los invariantes de EVA.

#### Criterios de aceptación

1. Cada Lambda DEBE tener su propio rol IAM, y la Knowledge Base el suyo.
2. Ninguna política IAM DEBE usar `"Action": "*"` ni `"Resource": "*"` salvo donde el servicio no admita un recurso concreto, y esa excepción DEBE quedar justificada en el diseño.
3. Todo bucket DEBE tener `blockPublicAccess` y `enforceSSL`.
4. Los recursos efímeros DEBEN usar `RemovalPolicy.DESTROY`.
5. Los registros de las Lambdas NO DEBEN incluir texto de preguntas ni de respuestas.
6. El código del repositorio NO DEBE contener secretos.
7. Antes de dar una tarea por terminada, `npm run build`, `npm test` y `npm run lint` DEBEN pasar.
