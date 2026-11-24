# Plan de implementación

Una tarea a la vez. Al terminar cada una: `npm run build`, `npm test` y `npm run lint` pasan, y un commit `feat(infra-y-portal): <qué> [tarea n]`. Cada tarea trae sus pruebas con `aws-cdk-lib/assertions` en `infra/lib/eva-stack.test.ts` (un solo archivo que crece), con `new App({ context: { 'aws:cdk:bundling-stacks': [] } })`. Cada prueba debe fallar si se quita la propiedad que verifica.

Archivos permitidos: `infra/` y `src/portal/app.js`. No cambiar `index.html`, `styles.css` ni sus id.

Despliegue (lo hace la operadora, Kiro no ejecuta comandos contra AWS): después de la tarea 1, luego `usuario-prueba.mjs`; después de la tarea 2, luego `ingestar.mjs`; después de la tarea 4, `prueba-humo.mjs`.

- [x] 1. Esqueleto desplegable
  - `eva-stack.ts` con métodos `identidad()`, `tabla()`, `nucleo()`, `api()` y `portal()`, en ese orden.
  - User Pool `eva-dev-usuarios` sin auto registro y cliente público con `USER_PASSWORD_AUTH`; usuario `SYN-USR-0001` con `messageAction: 'SUPPRESS'` y sin contraseña en la plantilla; secreto `eva/dev/usuario-prueba`.
  - Tabla `eva-dev-estado` y Lambda `eva-dev-nucleo` (stub actual, arm64, Node 22, `externalModules: []`, 28 s) con `TABLA_ESTADO`, `MODEL_ID`, `TITULOS_SECCION` e `INVESTIGACION_ACTIVA`. Crear `infra/lib/titulos-seccion.ts` y su prueba.
  - API `eva-dev-api` con los dos `POST` y el autorizador de Cognito.
  - Portal: bucket privado, CloudFront con OAC, comportamiento `v1/*`, CSP y `BucketDeployment` de `src/portal` con `config.json` por `Source.jsonData`.
  - Salidas `PortalUrl`, `ApiUrl`, `UserPoolId` y `UserPoolClientId`.
  - `infra/scripts/usuario-prueba.mjs`: lee el secreto con AWS CLI y fija la contraseña permanente sin imprimirla.
  - Pruebas: Cognito, usuario, secreto, tabla, Lambda y su entorno, API con autorizador, distribución, CSP, `config.json`, salidas, y que ninguna política tenga `Action: "*"`.
  - _Requisitos: 1, 2, 3, 7.1, 7.4, 8, 9, 13_

- [x] 2. Base de conocimiento e ingesta
  - Método `baseConocimiento()`: bucket `eva-dev-kb-<cuenta>`, `BucketDeployment` solo de `data/conocimiento/documentos/general` a `general/`, `CfnVectorBucket` y `CfnIndex`, rol de la KB, `CfnKnowledgeBase` y `CfnDataSource` con `inclusionPrefixes: ['general/']`.
  - Salidas `KbId` y `DataSourceId`; `KB_ID` y `bedrock:Retrieve` para el núcleo.
  - `infra/scripts/ingestar.mjs`: `StartIngestionJob`, espera `COMPLETE`, muestra cuántos documentos indexó y sale con código 1 si hay `FAILED`.
  - Pruebas: bucket, prefijo del `BucketDeployment` y que no incluya `restringido/`, índice (1024, cosine, float32, claves no filtrables), rol de la KB sin comodines, KB, fuente de datos, salidas, `KB_ID` y `Retrieve` en el núcleo.
  - _Requisitos: 4, 13_

- [ ] 3. Guardrail
  - Método `guardrail()`: `CfnGuardrail` `eva-dev-guardrail` (STANDARD, perfil `us.guardrail.v1:0`, `PROMPT_ATTACK` alto en la entrada, `MISCONDUCT` bajo en la entrada y medio en la salida, `INSULTS` medio, bloqueo de tarjeta y contraseña, sin grounding) y `CfnGuardrailVersion` con `description`.
  - Variables `GUARDRAIL_ID` y `GUARDRAIL_VERSION` y permiso `bedrock:ApplyGuardrail` (guardrail y perfil) para el núcleo; `bedrock:InvokeModel` sobre Nova Pro.
  - Pruebas: nivel, perfil, filtros y fuerzas, información sensible, ausencia de `contextualGroundingPolicyConfig`, `description` no vacía, variables y permisos del núcleo.
  - _Requisitos: 5, 7.2, 7.5_

- [ ] 4. Conectores, flujo transaccional y núcleo completo
  - Método `conectores()`: Lambdas `eva-dev-skkeda` (con `TABLA_ESTADO` y acceso a la tabla) y `eva-dev-jira` (sin permisos extra), cada una con su rol; máquina Express `eva-dev-transaccional` con `Choice` por `skkeda:*` y `jira:*`, `Pass` `DENIED` en `otherwise` y registro con `includeExecutionData: false`.
  - Al núcleo: `FLUJO_TRANSACCIONAL_ARN` y `states:StartSyncExecution`. Verificar la lista completa de permisos del núcleo y que no tenga `lambda:InvokeFunction`.
  - Pruebas: Lambdas y roles, ramas y `DENIED`, registro, quién puede invocar los conectores (solo el rol de la máquina), lista exacta de acciones del núcleo.
  - _Requisitos: 6, 7, 13_

- [ ] 5. Lógica del portal (`src/portal/app.js`)
  - Ingreso con `fetch` a `InitiateAuth`, token solo en memoria, vuelta al ingreso con `401`.
  - Envío a `/v1/conversations`, burbujas de persona y de EVA con `#plantilla-mensaje`, lista de fuentes (título, sección, fecha), bloque "Cómo lo investigué", resumen con Confirmar y Cancelar y llamada a `/confirm` con los botones deshabilitados.
  - Sugerencias de la demo en `#sugerencias`. Solo `textContent` y el atributo `hidden`.
  - Pruebas de la lógica pura con Jest si `jsdom` ya está disponible; si no, quedan cubiertas por la prueba de humo y se avisa.
  - _Requisitos: 10, 11_

- [ ] 6. Prueba de humo
  - `infra/scripts/prueba-humo.mjs`: lee las salidas y el secreto con AWS CLI sin imprimirlo, inicia sesión, ejecuta las preguntas 1 a 7 (con "piso 3" → "El jueves" → confirmar) y muestra `status`, títulos citados y resumen de la acción pendiente.
  - Con `--investigacion`: agrega las preguntas 8 y 9 y muestra los `researchSteps`.
  - Prueba de las funciones puras del script (armado de salida, lectura de argumentos) con Jest, sin llamadas reales a AWS.
  - Cierre: `npm run build`, `npm test`, `npm run lint` y `npm run synth` pasan.
  - _Requisitos: 12, 13.7_
