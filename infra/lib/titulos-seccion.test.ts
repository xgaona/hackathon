import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { investigacionActiva, titulosSeccion } from './titulos-seccion';

describe('titulosSeccion', () => {
  let carpeta: string;

  beforeEach(() => {
    carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'eva-corpus-'));
  });

  afterEach(() => {
    fs.rmSync(carpeta, { recursive: true, force: true });
  });

  it('toma los títulos ##, sin repetidos y del más largo al más corto', () => {
    fs.writeFileSync(path.join(carpeta, 'a.md'), '# Doc\n## Viáticos\ntexto\n## Anticipación de solicitud\n');
    fs.writeFileSync(path.join(carpeta, 'b.md'), '## Viáticos\r\n### Detalle\r\n## Legalización\r\n');
    expect(titulosSeccion(carpeta)).toBe('Anticipación de solicitud|Legalización|Viáticos');
  });

  it('ignora archivos que no son .md', () => {
    fs.writeFileSync(path.join(carpeta, 'a.md.metadata.json'), '## No debe salir');
    expect(titulosSeccion(carpeta)).toBe('');
  });

  it('devuelve cadena vacía si la carpeta no existe', () => {
    expect(titulosSeccion(path.join(carpeta, 'no-existe'))).toBe('');
  });

  it('lee el corpus real del repositorio', () => {
    const real = path.join(__dirname, '../../data/conocimiento/documentos/general');
    expect(titulosSeccion(real)).toContain('|');
  });
});

describe('investigacionActiva', () => {
  it.each([
    [true, 'true'],
    ['true', 'true'],
    [undefined, 'false'],
    ['false', 'false'],
    [false, 'false'],
    ['si', 'false'],
  ])('%p → %s', (entrada, esperado) => {
    expect(investigacionActiva(entrada)).toBe(esperado);
  });
});
