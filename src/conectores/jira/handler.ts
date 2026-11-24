import type { EstadoInvocacion, InvokeRequest, InvokeResult } from '../../comun/contrato';

type EstadoTarea = 'En curso' | 'En revisión' | 'Por hacer' | 'Hecho';
type PrioridadTarea = 'alta' | 'media' | 'baja';

interface TareaJira {
  key: string;
  summary: string;
  status: EstadoTarea;
  priority: PrioridadTarea;
  due: string;
}

interface ParametrosBusqueda extends Record<string, unknown> {
  status?: 'OPEN' | 'ALL';
  project?: string;
}

const CAPACIDAD_BUSCAR = 'jira:issue.search';
const SOURCE_REF = 'jira:mock';

const TAREAS: readonly TareaJira[] = [
  {
    key: 'EVA-SYN-101',
    summary: 'Ajustar flujo de confirmación de EVA',
    status: 'En curso',
    priority: 'alta',
    due: '2026-11-26',
  },
  {
    key: 'EVA-SYN-104',
    summary: 'Revisar citas de la base de conocimiento',
    status: 'En revisión',
    priority: 'media',
    due: '2026-11-27',
  },
  {
    key: 'TI-SYN-220',
    summary: 'Actualizar guía sintética de soporte',
    status: 'Por hacer',
    priority: 'media',
    due: '2026-12-01',
  },
  {
    key: 'EVA-SYN-099',
    summary: 'Preparar datos sintéticos iniciales',
    status: 'Hecho',
    priority: 'baja',
    due: '2026-11-20',
  },
];

const MENSAJES = {
  UNKNOWN_CAPABILITY: 'La capacidad solicitada no está disponible',
  INVALID_PARAMETER: 'Los parámetros de la solicitud no son válidos',
} as const;

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function parametrosValidos(params: unknown): params is ParametrosBusqueda {
  if (!esObjeto(params)) return false;
  if (!Object.keys(params).every((clave) => clave === 'status' || clave === 'project')) return false;

  const statusValido =
    params.status === undefined || params.status === 'OPEN' || params.status === 'ALL';
  const proyectoValido = params.project === undefined || typeof params.project === 'string';

  return statusValido && proyectoValido;
}

function resultadoError(
  solicitud: InvokeRequest,
  status: EstadoInvocacion,
  code: keyof typeof MENSAJES,
): InvokeResult {
  return {
    correlationId: solicitud.correlationId,
    status,
    origin: 'mock',
    error: {
      code,
      message: MENSAJES[code],
      correlationId: solicitud.correlationId,
    },
  };
}

function proyectoDe(tarea: TareaJira): string {
  return tarea.key.split('-SYN-', 1)[0];
}

export async function handler(solicitud: InvokeRequest): Promise<InvokeResult> {
  if (solicitud.capabilityId !== CAPACIDAD_BUSCAR) {
    return resultadoError(solicitud, 'DENIED', 'UNKNOWN_CAPABILITY');
  }

  const params = solicitud.params;
  if (!parametrosValidos(params)) {
    return resultadoError(solicitud, 'FAILED', 'INVALID_PARAMETER');
  }

  const soloAbiertas = params.status !== 'ALL';
  const proyecto = params.project?.toUpperCase();
  const items = TAREAS.filter(
    (tarea) =>
      (!soloAbiertas || tarea.status !== 'Hecho') &&
      (proyecto === undefined || proyectoDe(tarea) === proyecto),
  );

  return {
    correlationId: solicitud.correlationId,
    status: 'OK',
    origin: 'mock',
    sourceRef: SOURCE_REF,
    data: { items, soloAbiertas },
  };
}
