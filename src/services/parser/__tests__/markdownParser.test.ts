import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseConceptMapMarkdown,
  splitMarkdownTableRow,
} from '../markdownParser';
import { serializeSemanticModelToMarkdown } from '../markdownSerializer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entradaPath = path.resolve(__dirname, '../../../../entrada.md');

describe('MarkdownParser & MarkdownSerializer (Etapa 2)', () => {
  it('extrai exatamente 32 conceitos únicos e 46 relações (31 hierárquicas e 15 cruzadas) de entrada.md', () => {
    const rawMarkdown = fs.readFileSync(entradaPath, 'utf-8');
    const result = parseConceptMapMarkdown(rawMarkdown);

    expect(result.diagnostics).toHaveLength(0);
    expect(result.detectedColumnCount).toBe(5);
    expect(result.metrics.totalConcepts).toBe(32);
    expect(result.metrics.totalRelations).toBe(46);
    expect(result.metrics.hierarchicalCount).toBe(31);
    expect(result.metrics.crossLinkCount).toBe(15);

    // Verifica que Projeto POP é a única raiz hierárquica (nível 0)
    expect(result.metrics.rootConceptIds).toEqual(['concept-projeto-pop']);
    expect(result.metrics.hierarchicalDepthById['concept-projeto-pop']).toBe(0);
    // Verifica que Iniciativa privativa do Governador está no nível 5
    expect(
      result.metrics.hierarchicalDepthById[
        'concept-iniciativa-privativa-do-governador'
      ]
    ).toBe(5);

    // O grafo é conexo e o subgrafo hierárquico não possui ciclos
    expect(result.metrics.isConnected).toBe(true);
    expect(result.metrics.hasHierarchicalCycles).toBe(false);
    expect(result.metrics.hasDirectedCycles).toBe(false);
  });

  it('realiza round-trip perfeito de entrada.md (parse -> serialize 5 colunas -> re-parse)', () => {
    const rawMarkdown = fs.readFileSync(entradaPath, 'utf-8');
    const firstPass = parseConceptMapMarkdown(rawMarkdown);
    const serialized = serializeSemanticModelToMarkdown(firstPass.semantic, {
      includeIndexColumn: true,
    });

    // O Markdown serializado de 5 colunas deve bater exatamente com o entrada.md original
    expect(serialized).toBe(rawMarkdown);

    const secondPass = parseConceptMapMarkdown(serialized);
    expect(secondPass.metrics).toEqual(firstPass.metrics);
    expect(secondPass.semantic.conceptOrder).toEqual(
      firstPass.semantic.conceptOrder
    );
    expect(secondPass.semantic.relationOrder).toEqual(
      firstPass.semantic.relationOrder
    );
  });

  it('interpreta corretamente tabelas de 4 colunas (formato do exemplo em prompt.md, sem coluna #)', () => {
    const fourColTable = `
| Conceito A | Frase de ligação | Conceito B | Tipo |
|---|---|---|---|
| Projeto POP | propõe | Cinturão de proteção | hierárquica |
| Reserva Ducke | abriga | Recursos hídricos | hierárquica |
| Impactos ambientais | afetam | Recursos hídricos | ligação cruzada |
`;
    const result = parseConceptMapMarkdown(fourColTable);

    expect(result.diagnostics).toHaveLength(0);
    expect(result.detectedColumnCount).toBe(4);
    expect(result.metrics.totalConcepts).toBe(5);
    expect(result.metrics.totalRelations).toBe(3);
    expect(result.metrics.hierarchicalCount).toBe(2);
    expect(result.metrics.crossLinkCount).toBe(1);
  });

  it('trata arquivo vazio e arquivo sem tabelas emitindo diagnósticos sem lançar exceções', () => {
    const emptyResult = parseConceptMapMarkdown('   \n  ');
    expect(emptyResult.metrics.totalConcepts).toBe(0);
    expect(emptyResult.diagnostics[0]?.code).toBe('EMPTY_FILE');

    const noTableResult = parseConceptMapMarkdown(
      '# Título do Documento\n\nTexto corrido sem nenhuma tabela Markdown.'
    );
    expect(noTableResult.semantic.title).toBe('Título do Documento');
    expect(noTableResult.metrics.totalConcepts).toBe(0);
    expect(noTableResult.diagnostics[0]?.code).toBe('NO_TABLE_FOUND');
  });

  it('unifica conceitos duplicados (mesmo com diferenças de caixa ou espaços) e ignora relações duplicadas', () => {
    const md = `
| Conceito A | Frase de ligação | Conceito B | Tipo |
|---|---|---|---|
| Reserva Ducke | abriga | Recursos hídricos | hierárquica |
|   reserva   ducke  | abriga | RECURSOS HÍDRICOS | hierarquica |
| Reserva Ducke | protege | Recursos hídricos | ligação cruzada |
`;
    const result = parseConceptMapMarkdown(md);

    // Apenas 2 conceitos únicos ("Reserva Ducke" e "Recursos hídricos")
    expect(result.metrics.totalConcepts).toBe(2);
    // A 2ª linha é duplicata exata da 1ª e deve ser ignorada; a 3ª linha tem frase diferente (multigrafo permitido)
    expect(result.metrics.totalRelations).toBe(2);
    expect(
      result.diagnostics.some((d) => d.code === 'DUPLICATE_RELATION_SKIPPED')
    ).toBe(true);
    expect(
      result.diagnostics.some((d) => d.code === 'CASE_MISMATCH_CONCEPT')
    ).toBe(true);
  });

  it('tolera linhas malformadas, tipos ausentes/desconhecidos e pipes escapados', () => {
    const md = `
| Conceito A | Frase de ligação | Conceito B | Tipo |
|---|---|---|---|
| Linha incompleta | apenas duas colunas |
| Conceito Válido | conecta \\| especial | Outro Conceito | |
| Origem X | relaciona | Destino Y | tipo_inexistente |
`;
    const result = parseConceptMapMarkdown(md);

    expect(result.metrics.totalRelations).toBe(2);
    expect(
      result.diagnostics.some((d) => d.code === 'MALFORMED_ROW_SKIPPED')
    ).toBe(true);
    expect(
      result.diagnostics.some((d) => d.code === 'MISSING_TYPE_DEFAULTED')
    ).toBe(true);
    expect(
      result.diagnostics.some((d) => d.code === 'UNKNOWN_RELATION_TYPE')
    ).toBe(true);

    const firstRel = result.semantic.relations['rel-1'];
    expect(firstRel?.linkingPhrase).toBe('conecta | especial');
  });

  it('divide células respeitando pipes escapados com splitMarkdownTableRow', () => {
    const cells = splitMarkdownTableRow('| A \\| B | propõe | C | hierárquica |');
    expect(cells).toEqual(['A | B', 'propõe', 'C', 'hierárquica']);
  });
});
