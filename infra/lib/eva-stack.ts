// Boilerplate del kit: stack vacío. Liz agrega aquí los constructs según el spec infra-y-portal.
// No mover ni renombrar: infra/bin/app.ts lo instancia.
import { Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export interface EvaStackProps extends StackProps {
  ambiente: string;
}

export class EvaStack extends Stack {
  readonly ambiente: string;

  constructor(scope: Construct, id: string, props: EvaStackProps) {
    super(scope, id, props);
    this.ambiente = props.ambiente;
  }
}
