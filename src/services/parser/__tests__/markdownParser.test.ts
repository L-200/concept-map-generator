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
const exemploPath = path.resolve(__dirname, '../../../../exemplo.md');
const flowchartExamplePath = path.resolve(
  __dirname,
  '../../../../exemplo-fluxograma.md'
);

describe('MarkdownParser & MarkdownSerializer (Etapa 2)', () => {
  it('extrai exatamente 32 conceitos únicos e 46 relações (31 hierárquicas e 15 cruzadas) de exemplo.md', () => {
    const rawMarkdown = fs.readFileSync(exemploPath, 'utf-8');
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

  it('realiza round-trip perfeito de exemplo.md (parse -> serialize 5 colunas -> re-parse)', () => {
    const rawMarkdown = fs.readFileSync(exemploPath, 'utf-8');
    const firstPass = parseConceptMapMarkdown(rawMarkdown);
    const serialized = serializeSemanticModelToMarkdown(firstPass.semantic, {
      includeIndexColumn: true,
    });

    // O Markdown serializado de 5 colunas deve bater exatamente com o exemplo.md original
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

describe('Flowchart Parsing, Detection & Serialization (Milestone 1)', () => {
  it('detecta explicitamente o modo flowchart via frontmatter YAML com diferentes chaves e extrai título', () => {
    const yaml1 = `---
type: flowchart
title: Fluxo de Atendimento ao Cliente
---

| # | Origem | Transição | Destino | Tipo |
|---|---|---|---|---|
| 1 | Início | | Triagem | processo |
`;
    const res1 = parseConceptMapMarkdown(yaml1);
    expect(res1.semantic.diagramMode).toBe('flowchart');
    expect(res1.semantic.title).toBe('Fluxo de Atendimento ao Cliente');
    expect(res1.diagnostics).toHaveLength(0);

    const yaml2 = `---
diagram: fluxograma
---
| Origem | Condição | Destino |
| Início | | Fim |
`;
    const res2 = parseConceptMapMarkdown(yaml2);
    expect(res2.semantic.diagramMode).toBe('flowchart');

    const yamlConcept = `---
type: concept-map
---
| Conceito A | Frase de ligação | Conceito B | Tipo |
| C1 | conecta | C2 | hierárquica |
`;
    const resConcept = parseConceptMapMarkdown(yamlConcept);
    expect(resConcept.semantic.diagramMode).toBe('concept-map');
  });

  it('detecta modo flowchart via comentários HTML (<!-- type: flowchart -->) e diretivas de metadados (@type: flowchart)', () => {
    const htmlComment = `<!-- type: flowchart -->
# Fluxo Operacional
| Origem | Transição | Destino | Forma |
| Início | | Execução | processo |
`;
    const resComment = parseConceptMapMarkdown(htmlComment);
    expect(resComment.semantic.diagramMode).toBe('flowchart');

    const directiveAt = `@type: flowchart
| Origem | Transição | Destino | Forma |
| Início | | Execução | processo |
`;
    const resAt = parseConceptMapMarkdown(directiveAt);
    expect(resAt.semantic.diagramMode).toBe('flowchart');

    const directiveNamed = `Tipo de Diagrama: Fluxograma
| Origem | Transição | Destino | Forma |
| Início | | Execução | processo |
`;
    const resNamed = parseConceptMapMarkdown(directiveNamed);
    expect(resNamed.semantic.diagramMode).toBe('flowchart');
  });

  it('aplica heurística de fallback: classifica como flowchart por cabeçalhos ou tags, e mantém concept-map para exemplo.md', () => {
    // 1. Tabela com cabeçalhos típicos de fluxograma sem frontmatter
    const headerFlowchart = `
| Origem | Condição | Destino | Forma |
|---|---|---|---|
| Passo A | Sim | Passo B | condicional |
`;
    const resHeader = parseConceptMapMarkdown(headerFlowchart);
    expect(resHeader.semantic.diagramMode).toBe('flowchart');

    // 2. Tabela sem cabeçalho explícito mas com tags inline [Início] / [Fim]
    const tagsFlowchart = `
| [Início] Protocolo | | [Processo] Triagem | |
| [Processo] Triagem | | [Fim] Arquivamento | |
`;
    const resTags = parseConceptMapMarkdown(tagsFlowchart);
    expect(resTags.semantic.diagramMode).toBe('flowchart');

    // 3. Tabela clássica de mapa conceitual permanece 'concept-map'
    const classicMap = `
| Conceito A | Frase de ligação | Conceito B | Tipo |
|---|---|---|---|
| População | demanda | Habitação | hierárquica |
`;
    const resMap = parseConceptMapMarkdown(classicMap);
    expect(resMap.semantic.diagramMode).toBe('concept-map');

    // 4. exemplo.md real permanece 100% concept-map
    const rawExemplo = fs.readFileSync(exemploPath, 'utf-8');
    const resExemplo = parseConceptMapMarkdown(rawExemplo);
    expect(resExemplo.semantic.diagramMode).toBe('concept-map');
  });

  it('extrai corretamente todas as 6 formas canônicas de nós a partir de tags inline no rótulo', () => {
    const md = `---
type: flowchart
---

| # | Origem | Transição | Destino | Tipo |
|---|---|---|---|---|
| 1 | [Início] Iniciar Solicitação | | [Processo] Analisar Dados | |
| 2 | [Processo] Analisar Dados | | [Decisão] Documentação OK? | |
| 3 | [Decisão] Documentação OK? | | [Entrada/Saída] Solicitar Documentos | |
| 4 | [Entrada/Saída] Solicitar Documentos | | [Subprocesso] Auditoria Externa | |
| 5 | [Subprocesso] Auditoria Externa | | [Documento] Emitir Certificado | |
| 6 | [Documento] Emitir Certificado | | [Fim] Concluir Processo | |
`;
    const res = parseConceptMapMarkdown(md);

    expect(res.diagnostics).toHaveLength(0);
    expect(res.semantic.diagramMode).toBe('flowchart');

    const c1 = res.semantic.concepts['concept-iniciar-solicitacao'];
    expect(c1?.label).toBe('Iniciar Solicitação');
    expect(c1?.nodeShape).toBe('terminal');

    const c2 = res.semantic.concepts['concept-analisar-dados'];
    expect(c2?.label).toBe('Analisar Dados');
    expect(c2?.nodeShape).toBe('process');

    const c3 = res.semantic.concepts['concept-documentacao-ok'];
    expect(c3?.label).toBe('Documentação OK?');
    expect(c3?.nodeShape).toBe('decision');

    const c4 = res.semantic.concepts['concept-solicitar-documentos'];
    expect(c4?.label).toBe('Solicitar Documentos');
    expect(c4?.nodeShape).toBe('io');

    const c5 = res.semantic.concepts['concept-auditoria-externa'];
    expect(c5?.label).toBe('Auditoria Externa');
    expect(c5?.nodeShape).toBe('subroutine');

    const c6 = res.semantic.concepts['concept-emitir-certificado'];
    expect(c6?.label).toBe('Emitir Certificado');
    expect(c6?.nodeShape).toBe('document');

    const c7 = res.semantic.concepts['concept-concluir-processo'];
    expect(c7?.label).toBe('Concluir Processo');
    expect(c7?.nodeShape).toBe('terminal');
  });

  it('interpreta sintaxes alternativas de tags inline: chaves {?}, parênteses (), colchetes duplos [[]] e tags no sufixo', () => {
    const md = `---
type: flowchart
---

| # | Origem | Transição | Destino | Tipo |
|---|---|---|---|---|
| 1 | (Início) | | {Aprovado pelo Gestor?} | |
| 2 | {Aprovado pelo Gestor?} | Sim | [[Sub-rotina de Pagamento]] | |
| 3 | [[Sub-rotina de Pagamento]] | | Relatório de Pagamento [documento] | |
| 4 | Relatório de Pagamento [documento] | | Entrada de Nota [entrada/saída] | |
| 5 | Entrada de Nota [entrada/saída] | | (Fim) | |
`;
    const res = parseConceptMapMarkdown(md);

    expect(res.diagnostics).toHaveLength(0);

    const startNode = res.semantic.concepts['concept-inicio'];
    expect(startNode?.nodeShape).toBe('terminal');
    expect(startNode?.label).toBe('Início');

    const decisionNode = res.semantic.concepts['concept-aprovado-pelo-gestor'];
    expect(decisionNode?.nodeShape).toBe('decision');
    expect(decisionNode?.label).toBe('Aprovado pelo Gestor?');

    const subNode = res.semantic.concepts['concept-sub-rotina-de-pagamento'];
    expect(subNode?.nodeShape).toBe('subroutine');
    expect(subNode?.label).toBe('Sub-rotina de Pagamento');

    const docNode = res.semantic.concepts['concept-relatorio-de-pagamento'];
    expect(docNode?.nodeShape).toBe('document');
    expect(docNode?.label).toBe('Relatório de Pagamento');

    const ioNode = res.semantic.concepts['concept-entrada-de-nota'];
    expect(ioNode?.nodeShape).toBe('io');
    expect(ioNode?.label).toBe('Entrada de Nota');

    const endNode = res.semantic.concepts['concept-fim'];
    expect(endNode?.nodeShape).toBe('terminal');
    expect(endNode?.label).toBe('Fim');
  });

  it('extrai formas de nós e tipos de relação (condicional, retorno) a partir de coluna dedicada Tipo / Forma', () => {
    const md = `---
type: flowchart
---

| # | Origem | Transição / Condição | Destino | Tipo / Forma |
|---|---|---|---|---|
| 1 | Protocolo Inicial | | Análise Técnica | início -> processo |
| 2 | Análise Técnica | Aprovado | Homologação Final | condicional |
| 3 | Homologação Final | Rejeitado | Análise Técnica | retorno |
`;
    const res = parseConceptMapMarkdown(md);

    expect(res.diagnostics).toHaveLength(0);

    // Formas extraídas da coluna tipo/forma
    const src = res.semantic.concepts['concept-protocolo-inicial'];
    const tgt = res.semantic.concepts['concept-analise-tecnica'];
    expect(src?.nodeShape).toBe('terminal');
    expect(tgt?.nodeShape).toBe('process');

    // Relação condicional
    const relConditional = res.semantic.relations['rel-2'];
    expect(relConditional?.type).toBe('conditional');

    // Relação de loop / retorno
    const relLoop = res.semantic.relations['rel-3'];
    expect(relLoop?.type).toBe('loop-back');
  });

  it('tolera frases de ligação vazias em modo flowchart sem emitir advertência EMPTY_LINKING_PHRASE', () => {
    const flowchartMd = `---
type: flowchart
---

| # | Origem | Transição | Destino | Tipo |
|---|---|---|---|---|
| 1 | [Início] Iniciar | | [Processo] Executar | |
| 2 | [Processo] Executar | | [Fim] Concluir | |
`;
    const resFlowchart = parseConceptMapMarkdown(flowchartMd);
    const emptyWarningsFlow = resFlowchart.diagnostics.filter(
      (d) => d.code === 'EMPTY_LINKING_PHRASE'
    );
    expect(emptyWarningsFlow).toHaveLength(0);

    const conceptMapMd = `
| Conceito A | Frase de ligação | Conceito B | Tipo |
|---|---|---|---|
| Conceito 1 | | Conceito 2 | hierárquica |
`;
    const resConcept = parseConceptMapMarkdown(conceptMapMd);
    const emptyWarningsConcept = resConcept.diagnostics.filter(
      (d) => d.code === 'EMPTY_LINKING_PHRASE'
    );
    expect(emptyWarningsConcept.length).toBeGreaterThan(0);
  });

  it('realiza round-trip perfeito de fluxograma preservando frontmatter, formas de nós e transições condicionais', () => {
    const originalFlowchart = `---
type: flowchart
title: Processo Seletivo Simplificado
---

| # | Origem | Transição / Condição | Destino | Tipo / Forma |
|---|---|---|---|---|
| 1 | [Início] Inscrição | | [Processo] Avaliação Curricular | início -> processo |
| 2 | [Processo] Avaliação Curricular | Sim | [Decisão] Nota Acima de 7? | processo -> decisão |
| 3 | [Decisão] Nota Acima de 7? | Não | [Fim] Desclassificado | condicional |
| 4 | [Decisão] Nota Acima de 7? | Sim | [Documento] Publicar Lista de Aprovados | condicional |
`;
    const firstPass = parseConceptMapMarkdown(originalFlowchart);
    expect(firstPass.diagnostics).toHaveLength(0);
    expect(firstPass.semantic.diagramMode).toBe('flowchart');

    const serialized = serializeSemanticModelToMarkdown(firstPass.semantic, {
      includeIndexColumn: true,
    });

    expect(serialized).toContain('type: flowchart');
    expect(serialized).toContain('Processo Seletivo Simplificado');
    expect(serialized).toContain('| # | Origem | Transição / Condição | Destino | Tipo / Forma |');

    const secondPass = parseConceptMapMarkdown(serialized);
    expect(secondPass.semantic.diagramMode).toBe('flowchart');
    expect(secondPass.semantic.title).toBe(firstPass.semantic.title);
    expect(secondPass.metrics.totalConcepts).toBe(firstPass.metrics.totalConcepts);
    expect(secondPass.metrics.totalRelations).toBe(firstPass.metrics.totalRelations);

    // Formas preservadas
    expect(secondPass.semantic.concepts['concept-inscricao']?.nodeShape).toBe('terminal');
    expect(secondPass.semantic.concepts['concept-nota-acima-de-7']?.nodeShape).toBe('decision');
    expect(secondPass.semantic.concepts['concept-publicar-lista-de-aprovados']?.nodeShape).toBe('document');
  });

  it('garante comportamento dual do serializer: sem frontmatter para mapa conceitual e com frontmatter para fluxograma', () => {
    const rawMarkdown = fs.readFileSync(exemploPath, 'utf-8');
    const conceptResult = parseConceptMapMarkdown(rawMarkdown);

    // Modo concept-map: sem frontmatter, 100% idêntico a exemplo.md
    const serializedConcept = serializeSemanticModelToMarkdown(conceptResult.semantic, {
      includeIndexColumn: true,
    });
    expect(serializedConcept.startsWith('---')).toBe(false);
    expect(serializedConcept).toBe(rawMarkdown);

    // Modo flowchart forçado ou configurado: inclui frontmatter
    const serializedFlow = serializeSemanticModelToMarkdown(conceptResult.semantic, {
      includeIndexColumn: true,
      diagramMode: 'flowchart',
    });
    expect(serializedFlow.startsWith('---\ntype: flowchart')).toBe(true);
    expect(serializedFlow).toContain('| Origem | Transição / Condição | Destino |');
  });

  it('carrega e valida integralmente o arquivo exemplo-fluxograma.md com zero erros e todas as 6 formas', () => {
    expect(fs.existsSync(flowchartExamplePath)).toBe(true);
    const rawMarkdown = fs.readFileSync(flowchartExamplePath, 'utf-8');
    const result = parseConceptMapMarkdown(rawMarkdown);

    // Zero avisos ou erros
    expect(result.diagnostics).toHaveLength(0);
    expect(result.semantic.diagramMode).toBe('flowchart');
    expect(result.semantic.title).toBe('Pipeline de CI/CD, Code Review e Deploy em Produção');

    // Valida cobertura de conceitos e relações
    expect(result.metrics.totalConcepts).toBeGreaterThanOrEqual(14);
    expect(result.metrics.totalRelations).toBeGreaterThanOrEqual(15);

    // Coleta todas as formas presentes
    const shapes = new Set(
      Object.values(result.semantic.concepts).map((c) => c.nodeShape)
    );
    expect(shapes.has('terminal')).toBe(true);
    expect(shapes.has('process')).toBe(true);
    expect(shapes.has('decision')).toBe(true);
    expect(shapes.has('io')).toBe(true);
    expect(shapes.has('subroutine')).toBe(true);
    expect(shapes.has('document')).toBe(true);

    // Valida presença de transições condicionais com Sim e Não
    const phrases = Object.values(result.semantic.relations).map((r) => r.linkingPhrase);
    expect(phrases).toContain('Sim');
    expect(phrases).toContain('Não');

    // Valida presença de transição direta sem rótulo
    expect(phrases).toContain('');

    // Valida presença de transição de retorno / loop
    const types = Object.values(result.semantic.relations).map((r) => r.type);
    expect(types).toContain('loop-back');
  });
});
