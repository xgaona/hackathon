#!/usr/bin/env node
// Genera la plantilla de bootstrap de CDK sin el repositorio ECR de imágenes.
// Motivo: en la cuenta del taller el rol WSParticipantRole no tiene ecr:CreateRepository
// ni s3:PutEncryptionConfiguration, y EVA no usa imágenes Docker (las Lambdas se empaquetan con esbuild).
// Uso: node infra/bootstrap/generar-plantilla.mjs
//      cdk bootstrap aws://<cuenta>/us-east-1 --template infra/bootstrap/cdk-bootstrap-sin-ecr.json
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const cdk = join(aqui, '..', '..', 'node_modules', 'aws-cdk', 'bin', 'cdk');
const texto = execFileSync(process.execPath, [cdk, 'bootstrap', '--show-template', '--json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});
const plantilla = JSON.parse(texto.replace(/^\uFEFF/, ''));

delete plantilla.Resources.ContainerAssetsRepository;
delete plantilla.Resources.ImagePublishingRoleDefaultPolicy;
delete plantilla.Outputs.ImageRepositoryName;
delete plantilla.Conditions.HasCustomContainerAssetsRepositoryName;
// El rol del taller tampoco tiene s3:PutEncryptionConfiguration. S3 cifra con SSE-S3 por defecto,
// así que el bucket de assets queda cifrado igual.
delete plantilla.Resources.StagingBucket.Properties.BucketEncryption;
plantilla.Description = `${plantilla.Description ?? ''} (EVA: sin repositorio ECR)`.trim();

// Ninguna referencia al recurso borrado puede quedar (el parámetro ContainerAssetsRepositoryName sí queda).
const resultado = JSON.stringify(plantilla, null, 2);
const sinParametro = resultado.replaceAll('ContainerAssetsRepositoryName', '');
if (sinParametro.includes('ContainerAssetsRepository')) {
  throw new Error('La plantilla todavía referencia ContainerAssetsRepository');
}

const destino = join(aqui, 'cdk-bootstrap-sin-ecr.json');
writeFileSync(destino, `${resultado}\n`);
console.log(`Plantilla escrita en ${destino}`);
