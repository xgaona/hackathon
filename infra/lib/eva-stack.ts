// Stack eva-dev. Un método privado por grupo de recursos, en el orden de las tareas del spec infra-y-portal.
// No mover ni renombrar: infra/bin/app.ts lo instancia.
import * as path from 'path';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3vectors from 'aws-cdk-lib/aws-s3vectors';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import { nombre } from './nombres';
import { investigacionActiva, titulosSeccion } from './titulos-seccion';

export interface EvaStackProps extends StackProps {
  ambiente: string;
}

const RAIZ = path.join(__dirname, '..', '..');
const CARPETA_CORPUS_GENERAL = path.join(RAIZ, 'data', 'conocimiento', 'documentos', 'general');
const MODEL_ID = 'amazon.nova-pro-v1:0';
const MODELO_EMBEDDINGS = 'amazon.titan-embed-text-v2:0';
const PREFIJO_CORPUS = 'general/';
const PERFIL_GUARDRAIL = 'us.guardrail.v1:0';
/** Cambiar en cada ajuste del guardrail para publicar una versión nueva (lección 5). */
export const DESCRIPCION_VERSION_GUARDRAIL = 'v1: standard, misconduct LOW en entrada, sin grounding';

export class EvaStack extends Stack {
  readonly ambiente: string;

  private userPool!: cognito.UserPool;
  private cliente!: cognito.UserPoolClient;
  private tabla!: dynamodb.Table;
  private funcionNucleo!: NodejsFunction;
  private api!: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: EvaStackProps) {
    super(scope, id, props);
    this.ambiente = props.ambiente;

    this.identidad();
    this.tablaEstado();
    this.nucleo();
    this.crearApi();
    this.portal();
    this.baseConocimiento();
    this.guardrail();
  }

  /** Configuración común de las Lambdas: Node 22, arm64 y SDK empaquetado (lección 9). */
  private lambdaNode(id: string, recurso: string, entrada: string, timeout: Duration): NodejsFunction {
    return new NodejsFunction(this, id, {
      functionName: nombre(this.ambiente, recurso),
      entry: path.join(RAIZ, entrada),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout,
      projectRoot: RAIZ,
      bundling: { target: 'node22', externalModules: [] },
      logGroup: new logs.LogGroup(this, `${id}Logs`, {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
  }

  private identidad(): void {
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: nombre(this.ambiente, 'usuarios'),
      selfSignUpEnabled: false,
      signInAliases: { username: true },
      passwordPolicy: { minLength: 12 },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.cliente = this.userPool.addClient('Cliente', {
      userPoolClientName: nombre(this.ambiente, 'portal'),
      generateSecret: false,
      authFlows: { userPassword: true },
      disableOAuth: true,
    });

    // La contraseña se genera aquí y la fija usuario-prueba.mjs con el AWS CLI: el valor no entra a la plantilla.
    new secretsmanager.Secret(this, 'SecretoUsuarioPrueba', {
      secretName: `eva/${this.ambiente}/usuario-prueba`,
      description: 'Contraseña del usuario de prueba SYN-USR-0001 (datos sintéticos)',
      generateSecretString: { passwordLength: 24, requireEachIncludedType: true, excludeCharacters: '"\'\\`$&|<>^% ' },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    new cognito.CfnUserPoolUser(this, 'UsuarioPrueba', {
      userPoolId: this.userPool.userPoolId,
      username: 'SYN-USR-0001',
      messageAction: 'SUPPRESS',
    });
  }

  private tablaEstado(): void {
    this.tabla = new dynamodb.Table(this, 'Estado', {
      tableName: nombre(this.ambiente, 'estado'),
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }

  private nucleo(): void {
    this.funcionNucleo = this.lambdaNode('Nucleo', 'nucleo', 'src/nucleo/handler.ts', Duration.seconds(28));
    this.funcionNucleo.addEnvironment('TABLA_ESTADO', this.tabla.tableName);
    this.funcionNucleo.addEnvironment('MODEL_ID', MODEL_ID);
    this.funcionNucleo.addEnvironment('TITULOS_SECCION', titulosSeccion(CARPETA_CORPUS_GENERAL));
    this.funcionNucleo.addEnvironment(
      'INVESTIGACION_ACTIVA',
      investigacionActiva(this.node.tryGetContext('investigacion')),
    );
    this.tabla.grantReadWriteData(this.funcionNucleo);
  }

  private crearApi(): void {
    this.api = new apigateway.RestApi(this, 'Api', {
      restApiName: nombre(this.ambiente, 'api'),
      deployOptions: { stageName: 'api' },
      cloudWatchRole: false,
    });

    const autorizador = new apigateway.CognitoUserPoolsAuthorizer(this, 'Autorizador', {
      cognitoUserPools: [this.userPool],
    });
    const integracion = new apigateway.LambdaIntegration(this.funcionNucleo);
    const opciones: apigateway.MethodOptions = {
      authorizer: autorizador,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    const conversaciones = this.api.root.addResource('v1').addResource('conversations');
    conversaciones.addMethod('POST', integracion, opciones);
    conversaciones.addResource('{id}').addResource('confirm').addMethod('POST', integracion, opciones);

    new CfnOutput(this, 'ApiUrl', { value: this.api.url });
  }

  private portal(): void {
    const sitio = new s3.Bucket(this, 'Sitio', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const cabeceras = new cloudfront.ResponseHeadersPolicy(this, 'CabecerasPortal', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          override: true,
          contentSecurityPolicy: [
            "default-src 'self'",
            "img-src 'self' data:",
            "style-src 'self'",
            "script-src 'self'",
            `connect-src 'self' https://cognito-idp.${this.region}.amazonaws.com`,
            "frame-ancestors 'none'",
          ].join('; '),
        },
        strictTransportSecurity: {
          override: true,
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { override: true, frameOption: cloudfront.HeadersFrameOption.DENY },
      },
    });

    const distribucion = new cloudfront.Distribution(this, 'Portal', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(sitio),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: cabeceras,
      },
      additionalBehaviors: {
        'v1/*': {
          origin: new origins.RestApiOrigin(this.api),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    });

    new s3deploy.BucketDeployment(this, 'DespliegueSitio', {
      destinationBucket: sitio,
      sources: [
        s3deploy.Source.asset(path.join(RAIZ, 'src', 'portal')),
        s3deploy.Source.jsonData('config.json', {
          region: this.region,
          userPoolId: this.userPool.userPoolId,
          userPoolClientId: this.cliente.userPoolClientId,
        }),
      ],
      distribution: distribucion,
      distributionPaths: ['/*'],
    });

    new CfnOutput(this, 'PortalUrl', { value: `https://${distribucion.distributionDomainName}` });
    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: this.cliente.userPoolClientId });
  }

  /**
   * Base de conocimiento (tarea 2): solo data/conocimiento/documentos/general llega al bucket, en general/
   * (invariante 6). Vectores en S3 Vectors con los detalles de tecnologia.md.
   */
  private baseConocimiento(): void {
    const origen = new s3.Bucket(this, 'OrigenKb', {
      bucketName: `${nombre(this.ambiente, 'kb')}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new s3deploy.BucketDeployment(this, 'DespliegueCorpus', {
      destinationBucket: origen,
      destinationKeyPrefix: PREFIJO_CORPUS,
      sources: [s3deploy.Source.asset(CARPETA_CORPUS_GENERAL)],
    });

    const vectores = new s3vectors.CfnVectorBucket(this, 'Vectores', {
      vectorBucketName: nombre(this.ambiente, 'vectores'),
    });
    vectores.applyRemovalPolicy(RemovalPolicy.DESTROY);

    const indice = new s3vectors.CfnIndex(this, 'IndiceVectores', {
      vectorBucketArn: vectores.attrVectorBucketArn,
      indexName: 'eva-kb',
      dataType: 'float32',
      dimension: 1024,
      distanceMetric: 'cosine',
      // Sin esto la ingesta falla por el límite de metadatos filtrables (tecnologia.md).
      metadataConfiguration: { nonFilterableMetadataKeys: ['AMAZON_BEDROCK_TEXT', 'AMAZON_BEDROCK_METADATA'] },
    });
    indice.applyRemovalPolicy(RemovalPolicy.DESTROY);

    const modeloEmbeddings = `arn:${this.partition}:bedrock:${this.region}::foundation-model/${MODELO_EMBEDDINGS}`;
    const rolKb = new iam.Role(this, 'RolKb', {
      roleName: nombre(this.ambiente, 'kb-rol'),
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnLike: { 'aws:SourceArn': `arn:${this.partition}:bedrock:${this.region}:${this.account}:knowledge-base/*` },
        },
      }),
      inlinePolicies: {
        kb: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({ actions: ['bedrock:InvokeModel'], resources: [modeloEmbeddings] }),
            new iam.PolicyStatement({
              actions: ['s3:ListBucket'],
              resources: [origen.bucketArn],
              conditions: { StringLike: { 's3:prefix': [`${PREFIJO_CORPUS}*`] } },
            }),
            new iam.PolicyStatement({
              actions: ['s3:GetObject'],
              resources: [origen.arnForObjects(`${PREFIJO_CORPUS}*`)],
            }),
            new iam.PolicyStatement({
              actions: [
                's3vectors:PutVectors',
                's3vectors:GetVectors',
                's3vectors:DeleteVectors',
                's3vectors:QueryVectors',
                's3vectors:GetIndex',
              ],
              resources: [indice.attrIndexArn],
            }),
          ],
        }),
      },
    });

    const kb = new bedrock.CfnKnowledgeBase(this, 'Kb', {
      name: nombre(this.ambiente, 'kb'),
      description: 'Documentos corporativos sintéticos de clasificación GENERAL',
      roleArn: rolKb.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: { embeddingModelArn: modeloEmbeddings },
      },
      storageConfiguration: {
        type: 'S3_VECTORS',
        s3VectorsConfiguration: { vectorBucketArn: vectores.attrVectorBucketArn, indexArn: indice.attrIndexArn },
      },
    });
    kb.node.addDependency(rolKb);

    const fuente = new bedrock.CfnDataSource(this, 'FuenteKb', {
      knowledgeBaseId: kb.attrKnowledgeBaseId,
      name: nombre(this.ambiente, 'kb-general'),
      dataDeletionPolicy: 'RETAIN',
      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: { bucketArn: origen.bucketArn, inclusionPrefixes: [PREFIJO_CORPUS] },
      },
    });

    this.funcionNucleo.addEnvironment('KB_ID', kb.attrKnowledgeBaseId);
    this.funcionNucleo.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['bedrock:Retrieve'], resources: [kb.attrKnowledgeBaseArn] }),
    );

    new CfnOutput(this, 'KbId', { value: kb.attrKnowledgeBaseId });
    new CfnOutput(this, 'DataSourceId', { value: fuente.attrDataSourceId });
  }

  /**
   * Guardrail (tarea 3), según las lecciones 2 a 5 de tecnologia.md: nivel STANDARD con el perfil
   * us.guardrail.v1:0, MISCONDUCT bajo en la entrada y SIN contextual grounding.
   */
  private guardrail(): void {
    const perfilGuardrail = `arn:${this.partition}:bedrock:${this.region}:${this.account}:guardrail-profile/${PERFIL_GUARDRAIL}`;

    const guardrail = new bedrock.CfnGuardrail(this, 'Guardrail', {
      name: nombre(this.ambiente, 'guardrail'),
      description: 'Guardrail de EVA: ataques de prompt, conducta indebida, insultos y datos sensibles',
      blockedInputMessaging:
        'No puedo ayudarte con ese mensaje. Pregúntame por políticas, procesos o reservas de Redeban.',
      blockedOutputsMessaging: 'No encontré una respuesta confiable en las fuentes a las que tengo acceso.',
      crossRegionConfig: { guardrailProfileArn: perfilGuardrail },
      contentPolicyConfig: {
        contentFiltersTierConfig: { tierName: 'STANDARD' },
        filtersConfig: [
          // PROMPT_ATTACK solo admite la entrada: la salida debe ir en NONE.
          { type: 'PROMPT_ATTACK', inputStrength: 'HIGH', outputStrength: 'NONE' },
          // LOW en la entrada para que el Policy Engine pueda negar pedidos como "Borra todos los documentos" (lección 4).
          { type: 'MISCONDUCT', inputStrength: 'LOW', outputStrength: 'MEDIUM' },
          { type: 'INSULTS', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
        ],
      },
      sensitiveInformationPolicyConfig: {
        piiEntitiesConfig: [
          { type: 'CREDIT_DEBIT_CARD_NUMBER', action: 'BLOCK' },
          { type: 'PASSWORD', action: 'BLOCK' },
        ],
      },
      // Sin contextualGroundingPolicyConfig: en español bloqueó respuestas correctas (lección 3).
    });

    // CfnGuardrailVersion no publica una versión nueva sola: cambiar la descripción en cada ajuste (lección 5).
    const version = new bedrock.CfnGuardrailVersion(this, 'GuardrailVersion', {
      guardrailIdentifier: guardrail.attrGuardrailId,
      description: DESCRIPCION_VERSION_GUARDRAIL,
    });

    this.funcionNucleo.addEnvironment('GUARDRAIL_ID', guardrail.attrGuardrailId);
    this.funcionNucleo.addEnvironment('GUARDRAIL_VERSION', version.attrVersion);
    this.funcionNucleo.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:ApplyGuardrail'],
        resources: [
          guardrail.attrGuardrailArn,
          // El perfil entre regiones se evalúa en las regiones de su grupo (us-*): única excepción con comodín.
          `arn:${this.partition}:bedrock:*:${this.account}:guardrail-profile/${PERFIL_GUARDRAIL}`,
        ],
      }),
    );
    this.funcionNucleo.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [`arn:${this.partition}:bedrock:${this.region}::foundation-model/${MODEL_ID}`],
      }),
    );
  }
}
