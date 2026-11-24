import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { EvaStack } from './eva-stack';

function sintetizar(contexto: Record<string, unknown> = {}): Template {
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [], ...contexto } });
  const stack = new EvaStack(app, 'eva-dev', {
    ambiente: 'dev',
    env: { account: '111111111111', region: 'us-east-1' },
  });
  return Template.fromStack(stack);
}

/** Declaraciones de todas las políticas IAM de la plantilla, con sus acciones y recursos como listas. */
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

  it('crea un cliente público con USER_PASSWORD_AUTH', () => {
    plantilla.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_PASSWORD_AUTH']),
    });
  });

  it('crea el usuario SYN-USR-0001 sin correo y sin contraseña en la plantilla', () => {
    plantilla.hasResourceProperties('AWS::Cognito::UserPoolUser', {
      Username: 'SYN-USR-0001',
      MessageAction: 'SUPPRESS',
    });
    const usuarios = Object.values(plantilla.findResources('AWS::Cognito::UserPoolUser'));
    expect(JSON.stringify(usuarios)).not.toMatch(/password/i);
  });

  it('genera la contraseña en Secrets Manager', () => {
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

describe('Tarea 1: Lambda del núcleo', () => {
  it('es arm64, Node 22, con timeout de 28 s', () => {
    sintetizar().hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'eva-dev-nucleo',
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      Timeout: 28,
    });
  });

  it('recibe las variables del esqueleto y no las que aún no existen', () => {
    const plantilla = sintetizar();
    const funciones = plantilla.findResources('AWS::Lambda::Function', { Properties: { FunctionName: 'eva-dev-nucleo' } });
    const entorno = Object.values(funciones)[0].Properties.Environment.Variables as Record<string, unknown>;
    expect(Object.keys(entorno).sort()).toEqual(['INVESTIGACION_ACTIVA', 'MODEL_ID', 'TABLA_ESTADO', 'TITULOS_SECCION']);
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

  it('solo tiene permisos sobre la tabla y no puede invocar Lambdas', () => {
    const plantilla = sintetizar();
    const acciones = declaraciones(plantilla).flatMap((d) => d.acciones);
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

  it('expone exactamente dos métodos POST, ambos con autorizador de Cognito', () => {
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

  it('/v1/* va a la API sin caché, con todos los métodos y reenviando Authorization', () => {
    const distribuciones = Object.values(plantilla.findResources('AWS::CloudFront::Distribution'));
    const config = distribuciones[0].Properties.DistributionConfig;
    const comportamiento = config.CacheBehaviors.find((c: { PathPattern: string }) => c.PathPattern === 'v1/*');
    expect(comportamiento).toBeDefined();
    expect(comportamiento.AllowedMethods).toEqual(['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE']);
    // CACHING_DISABLED y ALL_VIEWER_EXCEPT_HOST_HEADER (políticas administradas de AWS).
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
    // los dos valores que se conocen al desplegar: el User Pool y su cliente. La región es literal.
    const despliegues = Object.values(plantilla.findResources('Custom::CDKBucketDeployment'));
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

describe('Seguridad transversal', () => {
  const plantilla = sintetizar();

  it('ninguna política usa Action "*"', () => {
    for (const d of declaraciones(plantilla)) {
      expect(d.acciones).not.toContain('*');
    }
  });

  it('Resource "*" solo aparece en acciones que AWS no permite acotar', () => {
    const permitidas = ['cloudfront:GetInvalidation', 'cloudfront:CreateInvalidation'];
    for (const d of declaraciones(plantilla)) {
      if (d.recursos.includes('*')) {
        expect(d.acciones.every((a) => permitidas.includes(a))).toBe(true);
      }
    }
  });

  it('todos los buckets bloquean el acceso público', () => {
    const buckets = Object.values(plantilla.findResources('AWS::S3::Bucket'));
    for (const b of buckets) {
      expect(b.Properties.PublicAccessBlockConfiguration).toBeDefined();
    }
  });
});
