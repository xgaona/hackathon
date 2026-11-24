import * as fs from 'fs';
import * as path from 'path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { DESCRIPCION_VERSION_GUARDRAIL, EvaStack } from './eva-stack';

function sintetizar(contexto: Record<string, unknown> = {}): Template {
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [], ...contexto } });
  const stack = new EvaStack(app, 'eva-dev', {
    ambiente: 'dev',
    env: { account: '111111111111', region: 'us-east-1' },
  });
  return Template.fromStack(stack);
}

/** Declaraciones de todas las polÃ­ticas IAM de la plantilla, con sus acciones y recursos como listas. */
function declaraciones(plantilla: Template): { acciones: string[]; recursos: unknown[] }[] {
  const politicas = plantilla.findResources('AWS::IAM::Policy');
  const resultado: { acciones: string[]; recursos: unknown[] }[] = [];
  for (const politica of Object.values(politicas)) {
    const lista = politica.Properties.PolicyDocument.Statement as Record<string, unknown>[];
    for (const d of lista) {
      resultado.push({
        acciones: ([] as string[]).concat(d.Action as string | string[]),
        recursos: ([] as unknown[]).concat(d.Resource),
      });
    }
  }
  return resultado;
}

describe('Tarea 1: identidad', () => {
  const plantilla = sintetizar();

  it('crea el User Pool sin auto registro', () => {
    plantilla.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: 'eva-dev-usuarios',
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });

  it('crea un cliente pÃºblico con USER_PASSWORD_AUTH', () => {
    plantilla.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_PASSWORD_AUTH']),
    });
  });

  it('crea el usuario SYN-USR-0001 sin correo y sin contraseÃ±a en la plantilla', () => {
    plantilla.hasResourceProperties('AWS::Cognito::UserPoolUser', {
      Username: 'SYN-USR-0001',
      MessageAction: 'SUPPRESS',
    });
    const usuarios = Object.values(plantilla.findResources('AWS::Cognito::UserPoolUser'));
    expect(JSON.stringify(usuarios)).not.toMatch(/password/i);
  });

  it('genera la contraseÃ±a en Secrets Manager', () => {
    plantilla.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'eva/dev/usuario-prueba',
      GenerateSecretString: Match.objectLike({ PasswordLength: 24, RequireEachIncludedType: true }),
    });
  });

  it('no usa recursos personalizados con secretos', () => {
    const texto = JSON.stringify(plantilla.toJSON());
    expect(texto).not.toMatch(/resolve:secretsmanager/);
  });
});

describe('Tarea 1: tabla', () => {
  it('crea eva-dev-estado con pk/sk, TTL, pago por uso y cifrado', () => {
    sintetizar().hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'eva-dev-estado',
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
      SSESpecification: { SSEEnabled: true },
    });
  });

  it('se destruye con el stack', () => {
    sintetizar().hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Delete' });
  });
});

describe('Tarea 1: Lambda del nÃºcleo', () => {
  it('es arm64, Node 22, con timeout de 28 s', () => {
    sintetizar().hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'eva-dev-nucleo',
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      Timeout: 28,
    });
  });

  it('recibe solo las variables de los recursos que ya existen (sin valores inventados)', () => {
    const plantilla = sintetizar();
    const funciones = plantilla.findResources('AWS::Lambda::Function', { Properties: { FunctionName: 'eva-dev-nucleo' } });
    const entorno = Object.values(funciones)[0].Properties.Environment.Variables as Record<string, unknown>;
    expect(Object.keys(entorno).sort()).toEqual([
      'FLUJO_TRANSACCIONAL_ARN',
      'GUARDRAIL_ID',
      'GUARDRAIL_VERSION',
      'INVESTIGACION_ACTIVA',
      'KB_ID',
      'MODEL_ID',
      'TABLA_ESTADO',
      'TITULOS_SECCION',
    ]);
    expect(entorno.MODEL_ID).toBe('amazon.nova-pro-v1:0');
    expect(String(entorno.TITULOS_SECCION)).toContain('|');
  });

  it('INVESTIGACION_ACTIVA es "false" por defecto y "true" con -c investigacion=true', () => {
    const valor = (p: Template): unknown => {
      const f = p.findResources('AWS::Lambda::Function', { Properties: { FunctionName: 'eva-dev-nucleo' } });
      return Object.values(f)[0].Properties.Environment.Variables.INVESTIGACION_ACTIVA;
    };
    expect(valor(sintetizar())).toBe('false');
    expect(valor(sintetizar({ investigacion: 'true' }))).toBe('true');
  });

  it('tiene permisos sobre la tabla y su rol no puede invocar Lambdas (invariante 2)', () => {
    const plantilla = sintetizar();
    const politicasNucleo = Object.values(plantilla.findResources('AWS::IAM::Policy')).filter((p) =>
      JSON.stringify(p.Properties.Roles).includes('NucleoServiceRole'),
    );
    expect(politicasNucleo.length).toBeGreaterThan(0);
    const acciones = politicasNucleo
      .flatMap((p) => p.Properties.PolicyDocument.Statement as { Action: string | string[] }[])
      .flatMap((d) => ([] as string[]).concat(d.Action));
    expect(acciones.some((a) => a.startsWith('lambda:'))).toBe(false);
    plantilla.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['dynamodb:GetItem', 'dynamodb:PutItem']),
          }),
        ]),
      },
    });
  });
});

describe('Tarea 1: API', () => {
  const plantilla = sintetizar();

  it('crea eva-dev-api con la etapa api', () => {
    plantilla.hasResourceProperties('AWS::ApiGateway::RestApi', { Name: 'eva-dev-api' });
    plantilla.hasResourceProperties('AWS::ApiGateway::Stage', { StageName: 'api' });
  });

  it('expone exactamente dos mÃ©todos POST, ambos con autorizador de Cognito', () => {
    const metodos = Object.values(plantilla.findResources('AWS::ApiGateway::Method'));
    expect(metodos).toHaveLength(2);
    for (const m of metodos) {
      expect(m.Properties.HttpMethod).toBe('POST');
      expect(m.Properties.AuthorizationType).toBe('COGNITO_USER_POOLS');
      expect(m.Properties.AuthorizerId).toBeDefined();
    }
  });

  it('define las rutas /v1/conversations y /v1/conversations/{id}/confirm', () => {
    plantilla.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: 'conversations' });
    plantilla.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: '{id}' });
    plantilla.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: 'confirm' });
    plantilla.hasResourceProperties('AWS::ApiGateway::Authorizer', { Type: 'COGNITO_USER_POOLS' });
  });
});

describe('Tarea 1: portal', () => {
  const plantilla = sintetizar();

  it('el bucket del sitio es privado y exige TLS', () => {
    plantilla.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    plantilla.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }),
        ]),
      },
    });
  });

  it('CloudFront usa Origin Access Control', () => {
    plantilla.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
  });

  it('/v1/* va a la API sin cachÃ©, con todos los mÃ©todos y reenviando Authorization', () => {
    const distribuciones = Object.values(plantilla.findResources('AWS::CloudFront::Distribution'));
    const config = distribuciones[0].Properties.DistributionConfig;
    const comportamiento = config.CacheBehaviors.find((c: { PathPattern: string }) => c.PathPattern === 'v1/*');
    expect(comportamiento).toBeDefined();
    expect(comportamiento.AllowedMethods).toEqual(['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE']);
    // CACHING_DISABLED y ALL_VIEWER_EXCEPT_HOST_HEADER (polÃ­ticas administradas de AWS).
    expect(comportamiento.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
    expect(comportamiento.OriginRequestPolicyId).toBe('b689b0a8-53d0-40ab-baf2-68738e2966ac');
  });

  it('aplica una CSP que permite connect-src a Cognito', () => {
    plantilla.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: {
        SecurityHeadersConfig: {
          ContentSecurityPolicy: {
            ContentSecurityPolicy: Match.stringLikeRegexp(
              "default-src 'self'.*connect-src 'self' https://cognito-idp\\.us-east-1\\.amazonaws\\.com",
            ),
            Override: true,
          },
        },
      },
    });
  });

  it('despliega src/portal y genera config.json con region, userPoolId y userPoolClientId', () => {
    plantilla.hasResourceProperties('Custom::CDKBucketDeployment', { DistributionPaths: ['/*'] });
    // El contenido de config.json va dentro del paquete; en la plantilla quedan como marcadores
    // los dos valores que se conocen al desplegar: el User Pool y su cliente. La regiÃ³n es literal.
    const despliegues = Object.values(
      plantilla.findResources('Custom::CDKBucketDeployment', { Properties: { DistributionPaths: ['/*'] } }),
    );
    const marcadores = JSON.stringify(despliegues[0].Properties.SourceMarkers);
    expect(marcadores).toMatch(/"Ref":"UserPool[0-9A-F]+"/);
    expect(marcadores).toMatch(/"Ref":"UserPoolCliente[0-9A-F]+"/);
    expect(Object.keys(despliegues[0].Properties.SourceMarkers[1])).toHaveLength(2);
  });
});

describe('Tarea 1: salidas', () => {
  it.each(['PortalUrl', 'ApiUrl', 'UserPoolId', 'UserPoolClientId'])('exporta %s', (salida) => {
    sintetizar().hasOutput(salida, {});
  });
});

describe('Tarea 2: base de conocimiento', () => {
  const plantilla = sintetizar();
  const recursos = plantilla.toJSON().Resources as Record<string, { Type: string; Properties: Record<string, unknown> }>;

  it('crea el bucket eva-dev-kb-<cuenta> privado y con TLS obligatorio', () => {
    plantilla.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'eva-dev-kb-111111111111',
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    const politicas = Object.values(recursos).filter((r) => r.Type === 'AWS::S3::BucketPolicy');
    const bucketKb = Object.entries(recursos).find(
      ([, r]) => r.Type === 'AWS::S3::Bucket' && r.Properties.BucketName === 'eva-dev-kb-111111111111',
    )?.[0];
    const politicaKb = politicas.find((p) => JSON.stringify(p.Properties.Bucket).includes(String(bucketKb)));
    expect(JSON.stringify(politicaKb)).toContain('aws:SecureTransport');
  });

  it('sube solo el corpus general al prefijo general/', () => {
    const despliegues = Object.values(recursos).filter(
      (r) => r.Type === 'Custom::CDKBucketDeployment' && r.Properties.DestinationBucketKeyPrefix === 'general/',
    );
    expect(despliegues).toHaveLength(1);
    expect(despliegues[0].Properties.SourceObjectKeys).toHaveLength(1);
  });

  it('el paquete del corpus es la carpeta general y no incluye restringido', () => {
    const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
    new EvaStack(app, 'eva-dev', { ambiente: 'dev', env: { account: '111111111111', region: 'us-east-1' } });
    const salida = app.synth().directory;
    const manifiesto = JSON.parse(fs.readFileSync(path.join(salida, 'eva-dev.assets.json'), 'utf8')) as {
      files: Record<string, { source: { path: string } }>;
    };
    const fuentes = Object.values(manifiesto.files).map((a) => a.source.path);
    const conCorpus = fuentes
      .map((p) => path.join(salida, p))
      .filter((d) => fs.existsSync(d) && fs.statSync(d).isDirectory())
      .filter((d) => fs.readdirSync(d).some((f) => f.endsWith('.md.metadata.json')));
    expect(conCorpus).toHaveLength(1);
    const archivos = fs.readdirSync(conCorpus[0]);
    expect(archivos).toContain('politica-viajes.md');
    expect(archivos).not.toContain('tabla-salarial.md');
    expect(archivos).not.toContain('restringido');
  });

  it('crea el Ã­ndice de S3 Vectors con 1024, cosine, float32 y las claves no filtrables', () => {
    plantilla.hasResourceProperties('AWS::S3Vectors::VectorBucket', { VectorBucketName: 'eva-dev-vectores' });
    plantilla.hasResourceProperties('AWS::S3Vectors::Index', {
      DataType: 'float32',
      Dimension: 1024,
      DistanceMetric: 'cosine',
      MetadataConfiguration: { NonFilterableMetadataKeys: ['AMAZON_BEDROCK_TEXT', 'AMAZON_BEDROCK_METADATA'] },
    });
  });

  it('el rol de la KB lo asume solo Bedrock de esta cuenta y tiene permisos acotados', () => {
    const roles = Object.values(recursos).filter(
      (r) => r.Type === 'AWS::IAM::Role' && r.Properties.RoleName === 'eva-dev-kb-rol',
    );
    expect(roles).toHaveLength(1);
    const rol = roles[0].Properties as {
      AssumeRolePolicyDocument: { Statement: { Principal: unknown; Condition: Record<string, unknown> }[] };
      Policies: { PolicyDocument: { Statement: { Action: string | string[]; Resource: unknown }[] } }[];
    };
    const confianza = rol.AssumeRolePolicyDocument.Statement[0];
    expect(confianza.Principal).toEqual({ Service: 'bedrock.amazonaws.com' });
    expect(confianza.Condition.StringEquals).toEqual({ 'aws:SourceAccount': '111111111111' });

    const declaracionesKb = rol.Policies.flatMap((p) => p.PolicyDocument.Statement);
    const acciones = declaracionesKb.flatMap((d) => ([] as string[]).concat(d.Action)).sort();
    expect(acciones).toEqual([
      'bedrock:InvokeModel',
      's3:GetObject',
      's3:ListBucket',
      's3vectors:DeleteVectors',
      's3vectors:GetIndex',
      's3vectors:GetVectors',
      's3vectors:PutVectors',
      's3vectors:QueryVectors',
    ]);
    for (const d of declaracionesKb) {
      expect(([] as unknown[]).concat(d.Resource)).not.toContain('*');
    }
    expect(JSON.stringify(declaracionesKb)).toContain('foundation-model/amazon.titan-embed-text-v2:0');
    expect(JSON.stringify(declaracionesKb)).toContain('/general/*');
  });

  it('crea la Knowledge Base VECTOR con Titan v2 y S3_VECTORS', () => {
    plantilla.hasResourceProperties('AWS::Bedrock::KnowledgeBase', {
      Name: 'eva-dev-kb',
      KnowledgeBaseConfiguration: {
        Type: 'VECTOR',
        VectorKnowledgeBaseConfiguration: { EmbeddingModelArn: Match.anyValue() },
      },
      StorageConfiguration: {
        Type: 'S3_VECTORS',
        S3VectorsConfiguration: { VectorBucketArn: Match.anyValue(), IndexArn: Match.anyValue() },
      },
    });
    const kbs = Object.values(plantilla.findResources('AWS::Bedrock::KnowledgeBase'));
    expect(JSON.stringify(kbs[0].Properties.KnowledgeBaseConfiguration)).toContain(
      'foundation-model/amazon.titan-embed-text-v2:0',
    );
  });

  it('crea la fuente S3 con inclusionPrefixes general/', () => {
    plantilla.hasResourceProperties('AWS::Bedrock::DataSource', {
      DataSourceConfiguration: {
        Type: 'S3',
        S3Configuration: { InclusionPrefixes: ['general/'] },
      },
    });
  });

  it.each(['KbId', 'DataSourceId'])('exporta %s', (salida) => {
    plantilla.hasOutput(salida, {});
  });

  it('el nÃºcleo recibe KB_ID y bedrock:Retrieve solo sobre la KB', () => {
    const funciones = plantilla.findResources('AWS::Lambda::Function', { Properties: { FunctionName: 'eva-dev-nucleo' } });
    const entorno = Object.values(funciones)[0].Properties.Environment.Variables;
    expect(entorno.KB_ID).toEqual({ 'Fn::GetAtt': [expect.stringMatching(/^Kb/), 'KnowledgeBaseId'] });
    plantilla.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          {
            Action: 'bedrock:Retrieve',
            Effect: 'Allow',
            Resource: { 'Fn::GetAtt': [Match.stringLikeRegexp('^Kb'), 'KnowledgeBaseArn'] },
          },
        ]),
      },
    });
  });
});

describe('Tarea 3: guardrail', () => {
  const plantilla = sintetizar();
  const guardrails = Object.values(plantilla.findResources('AWS::Bedrock::Guardrail'));
  // Propiedades de CloudFormation sin tipar: se navegan como JSON en las aserciones.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props = guardrails[0]?.Properties as Record<string, any>;

  it('crea un solo guardrail eva-dev-guardrail', () => {
    expect(guardrails).toHaveLength(1);
    expect(props.Name).toBe('eva-dev-guardrail');
  });

  it('usa el nivel STANDARD dentro de contentPolicyConfig', () => {
    expect(props.ContentPolicyConfig.ContentFiltersTierConfig).toEqual({ TierName: 'STANDARD' });
    expect(props.ContentFiltersTierConfig).toBeUndefined();
  });

  it('usa el perfil entre regiones us.guardrail.v1:0 de la cuenta', () => {
    expect(JSON.stringify(props.CrossRegionConfig.GuardrailProfileArn)).toContain(
      ':bedrock:us-east-1:111111111111:guardrail-profile/us.guardrail.v1:0',
    );
  });

  it('tiene exactamente los filtros y fuerzas de las lecciones 2 a 4', () => {
    const filtros = (props.ContentPolicyConfig.FiltersConfig as Record<string, string>[])
      .map((f) => `${f.Type}:${f.InputStrength}/${f.OutputStrength}`)
      .sort();
    expect(filtros).toEqual(['INSULTS:MEDIUM/MEDIUM', 'MISCONDUCT:LOW/MEDIUM', 'PROMPT_ATTACK:HIGH/NONE']);
  });

  it('bloquea números de tarjeta y contraseñas', () => {
    const pii = (props.SensitiveInformationPolicyConfig.PiiEntitiesConfig as Record<string, string>[])
      .map((p) => `${p.Type}:${p.Action}`)
      .sort();
    expect(pii).toEqual(['CREDIT_DEBIT_CARD_NUMBER:BLOCK', 'PASSWORD:BLOCK']);
  });

  it('no tiene contextual grounding (lección 3)', () => {
    expect(props.ContextualGroundingPolicyConfig).toBeUndefined();
  });

  it('tiene mensajes de bloqueo en español', () => {
    expect(props.BlockedInputMessaging).toMatch(/No puedo ayudarte/);
    expect(props.BlockedOutputsMessaging).toMatch(/No encontré/);
  });

  it('publica una versión con la descripción vigente (lección 5)', () => {
    plantilla.hasResourceProperties('AWS::Bedrock::GuardrailVersion', {
      GuardrailIdentifier: { 'Fn::GetAtt': [Match.stringLikeRegexp('^Guardrail'), 'GuardrailId'] },
      Description: DESCRIPCION_VERSION_GUARDRAIL,
    });
    expect(DESCRIPCION_VERSION_GUARDRAIL.trim().length).toBeGreaterThan(0);
  });

  it('el núcleo recibe GUARDRAIL_ID y GUARDRAIL_VERSION', () => {
    const funciones = plantilla.findResources('AWS::Lambda::Function', { Properties: { FunctionName: 'eva-dev-nucleo' } });
    const entorno = Object.values(funciones)[0].Properties.Environment.Variables;
    expect(entorno.GUARDRAIL_ID).toEqual({ 'Fn::GetAtt': [expect.stringMatching(/^Guardrail/), 'GuardrailId'] });
    expect(entorno.GUARDRAIL_VERSION).toEqual({
      'Fn::GetAtt': [expect.stringMatching(/^GuardrailVersion/), 'Version'],
    });
  });

  it('el núcleo puede aplicar el guardrail y su perfil, e invocar solo Nova Pro', () => {
    const texto = JSON.stringify(declaraciones(plantilla).filter((d) => d.acciones.includes('bedrock:ApplyGuardrail')));
    expect(texto).toContain('GuardrailArn');
    expect(texto).toContain(':bedrock:*:111111111111:guardrail-profile/us.guardrail.v1:0');

    const invocar = declaraciones(plantilla).filter((d) => d.acciones.includes('bedrock:InvokeModel'));
    const recursosNucleo = invocar.map((d) => JSON.stringify(d.recursos)).filter((r) => r.includes('nova'));
    expect(recursosNucleo).toEqual([expect.stringContaining('foundation-model/amazon.nova-pro-v1:0')]);
  });
});

describe('Seguridad transversal', () => {
  const plantilla = sintetizar();

  it('ninguna polÃ­tica usa Action "*"', () => {
    for (const d of declaraciones(plantilla)) {
      expect(d.acciones).not.toContain('*');
    }
  });

  it('Resource "*" solo aparece en acciones que AWS no permite acotar', () => {
    const permitidas = [
      // Invalidación del BucketDeployment del portal.
      'cloudfront:GetInvalidation',
      'cloudfront:CreateInvalidation',
      // Entrega de registros de Step Functions: estas acciones no admiten recursos concretos.
      'logs:CreateLogDelivery',
      'logs:GetLogDelivery',
      'logs:UpdateLogDelivery',
      'logs:DeleteLogDelivery',
      'logs:ListLogDeliveries',
      'logs:PutResourcePolicy',
      'logs:DescribeResourcePolicies',
      'logs:DescribeLogGroups',
    ];
    for (const d of declaraciones(plantilla)) {
      if (d.recursos.includes('*')) {
        expect(d.acciones.every((a) => permitidas.includes(a))).toBe(true);
      }
    }
  });

  it('todos los buckets bloquean el acceso pÃºblico', () => {
    const buckets = Object.values(plantilla.findResources('AWS::S3::Bucket'));
    for (const b of buckets) {
      expect(b.Properties.PublicAccessBlockConfiguration).toBeDefined();
    }
  });
});

describe('Canal de voz opcional (voz=true)', () => {
  it('sin voz=true no existe la Lambda eva-dev-voz', () => {
    const nombres = Object.values(sintetizar().findResources('AWS::Lambda::Function')).map(
      (f) => f.Properties.FunctionName,
    );
    expect(nombres).not.toContain('eva-dev-voz');
  });

  it('con voz=true crea eva-dev-voz con permisos solo de Polly y Transcribe', () => {
    const plantilla = sintetizar({ voz: 'true' });
    plantilla.hasResourceProperties('AWS::Lambda::Function', { FunctionName: 'eva-dev-voz' });
    const acciones = declaraciones(plantilla).flatMap((d) => d.acciones);
    expect(acciones).toEqual(
      expect.arrayContaining(['polly:SynthesizeSpeech', 'transcribe:StartStreamTranscription']),
    );
    plantilla.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: 'transcribir' });
    plantilla.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: 'sintetizar' });
  });
});
