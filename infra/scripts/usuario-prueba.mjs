#!/usr/bin/env node
// Fija como permanente la contraseña del usuario de prueba SYN-USR-0001.
// La contraseña se genera en Secrets Manager (eva/dev/usuario-prueba) y NUNCA se imprime.
// Lo ejecuta la operadora de AWS después del primer despliegue: node infra/scripts/usuario-prueba.mjs
// Variables opcionales: STACK (por defecto eva-dev), SECRETO (por defecto eva/dev/usuario-prueba).
import { execFileSync } from 'node:child_process';

const STACK = process.env.STACK ?? 'eva-dev';
const SECRETO = process.env.SECRETO ?? 'eva/dev/usuario-prueba';
const USUARIO = 'SYN-USR-0001';

function aws(args) {
  return execFileSync('aws', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Muestra un error del AWS CLI sin la contraseña y sin la línea de comandos. */
function fallar(mensaje, error, secreto) {
  const detalle = String(error?.stderr ?? '').trim();
  const limpio = secreto ? detalle.split(secreto).join('***') : detalle;
  console.error(`${mensaje}${limpio ? `\n${limpio}` : ''}`);
  process.exit(1);
}

let userPoolId;
try {
  userPoolId = aws([
    'cloudformation', 'describe-stacks', '--stack-name', STACK,
    '--query', "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue | [0]",
    '--output', 'text',
  ]);
} catch (error) {
  fallar(`No pude leer las salidas del stack ${STACK}. ¿Está desplegado y hay credenciales?`, error);
}
if (!userPoolId || userPoolId === 'None') {
  fallar(`El stack ${STACK} no tiene la salida UserPoolId.`);
}

let clave;
try {
  clave = aws([
    'secretsmanager', 'get-secret-value', '--secret-id', SECRETO,
    '--query', 'SecretString', '--output', 'text',
  ]);
} catch (error) {
  fallar(`No pude leer el secreto ${SECRETO}.`, error);
}

try {
  aws([
    'cognito-idp', 'admin-set-user-password',
    '--user-pool-id', userPoolId, '--username', USUARIO,
    '--password', clave, '--permanent',
  ]);
} catch (error) {
  fallar(`No pude fijar la contraseña de ${USUARIO}.`, error, clave);
}

console.log(`Listo: ${USUARIO} ya tiene la contraseña del secreto ${SECRETO} como permanente.`);
