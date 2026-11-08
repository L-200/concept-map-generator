import { describe, expect, it } from 'vitest';
import type {
  DiagramMode,
  FlowchartNodeShape,
  FlowTransitionKind,
  HandlePosition,
  LayoutAlgorithmType,
  LayoutSettings,
  RelationType,
  SemanticModel,
  VisualModel,
} from '../../../domain/types';
import {
  computeConceptMapLayout,
  DEFAULT_LAYOUT_SETTINGS,
  type LayoutComputationResult,
} from '../layoutEngine';
import {
  DECISION_HEIGHT_FACTOR,
  DECISION_MIN_HEIGHT,
  DECISION_MIN_WIDTH,
  DECISION_WIDTH_FACTOR,
  DEFAULT_NODE_MAX_WIDTH,
  estimateConceptNodeDimensions,
} from '../nodeSizing';

// ============================================================================
// TEST BUILDERS & ORACLE VERIFICATION HELPERS
// ============================================================================

interface ConceptSpec {
  id: string;
  label: string;
  shape?: FlowchartNodeShape;
}

interface RelationSpec {
  id?: string;
  sourceId: string;
  targetId: string;
  linkingPhrase?: string;
  type?: RelationType;
  flowKind?: FlowTransitionKind;
}

function buildSemanticFixture(params: {
  title?: string;
  concepts: ConceptSpec[];
  relations?: RelationSpec[];
  diagramMode?: DiagramMode;
}): SemanticModel {
  const { title = 'Empirical Challenge Diagram', concepts, relations = [], diagramMode = 'flowchart' } = params;

  const conceptsRecord: SemanticModel['concepts'] = {};
  const conceptOrder: string[] = [];

  concepts.forEach((c) => {
    conceptsRecord[c.id] = {
      id: c.id,
      label: c.label,
      normalizedKey: c.label.toLowerCase().trim(),
      nodeShape: c.shape ?? 'concept',
    };
    conceptOrder.push(c.id);
  });

  const relationsRecord: SemanticModel['relations'] = {};
  const relationOrder: string[] = [];

  relations.forEach((r, idx) => {
    const relId = r.id ?? `rel_${r.sourceId}_${r.targetId}_${idx}`;
    relationsRecord[relId] = {
      id: relId,
      orderIndex: idx + 1,
      sourceId: r.sourceId,
      targetId: r.targetId,
      linkingPhrase: r.linkingPhrase ?? '',
      type: r.type ?? (diagramMode === 'flowchart' ? 'sequence' : 'hierarchical'),
      flowKind: r.flowKind,
    };
    relationOrder.push(relId);
  });

  return {
    title,
    concepts: conceptsRecord,
    conceptOrder,
    relations: relationsRecord,
    relationOrder,
    diagramMode,
  };
}

/**
 * Oráculo de Integridade Numérica Estrita:
 * Valida que nenhuma dimensão ou coordenada contenha NaN, Infinity, -Infinity ou valores inválidos.
 */
function assertStrictNumericValidity(layoutResult: LayoutComputationResult): void {
  const { nodes, edges } = layoutResult;

  for (const node of Object.values(nodes)) {
    // Coordenadas
    expect(typeof node.position.x).toBe('number');
    expect(Number.isFinite(node.position.x)).toBe(true);
    expect(Number.isNaN(node.position.x)).toBe(false);

    expect(typeof node.position.y).toBe('number');
    expect(Number.isFinite(node.position.y)).toBe(true);
    expect(Number.isNaN(node.position.y)).toBe(false);

    // Dimensões
    expect(typeof node.dimensions?.width).toBe('number');
    expect(Number.isFinite(node.dimensions!.width)).toBe(true);
    expect(node.dimensions!.width).toBeGreaterThan(0);

    expect(typeof node.dimensions?.height).toBe('number');
    expect(Number.isFinite(node.dimensions!.height)).toBe(true);
    expect(node.dimensions!.height).toBeGreaterThan(0);

    // Camada calculada
    expect(typeof node.computedLayer).toBe('number');
    expect(Number.isFinite(node.computedLayer)).toBe(true);
  }

  for (const edge of Object.values(edges)) {
    // Portas válidas
    const validHandles: HandlePosition[] = ['top', 'right', 'bottom', 'left'];
    expect(validHandles).toContain(edge.sourceHandle);
    expect(validHandles).toContain(edge.targetHandle);

    // Offset de rótulo
    if (edge.labelOffset) {
      expect(typeof edge.labelOffset.t).toBe('number');
      expect(Number.isFinite(edge.labelOffset.t)).toBe(true);
      expect(Number.isNaN(edge.labelOffset.t)).toBe(false);
      expect(edge.labelOffset.t).toBeGreaterThanOrEqual(0);
      expect(edge.labelOffset.t).toBeLessThanOrEqual(1);

      if (edge.labelOffset.x !== undefined) {
        expect(Number.isFinite(edge.labelOffset.x)).toBe(true);
      }
      if (edge.labelOffset.y !== undefined) {
        expect(Number.isFinite(edge.labelOffset.y)).toBe(true);
      }
    }
  }
}

// ============================================================================
// SUÍTE 1: ESCALONAMENTO E GEOMETRIA DO LOSANGO DE DECISÃO
// ============================================================================
describe('Empirical Challenge — Suíte 1: Escalonamento do Losango de Decisão vs Retângulo', () => {
  it('garante que o losango de decisão é estritamente maior que o nó retangular para rótulo vazio e espaços', () => {
    const emptyLabels = ['', '   ', '\n\t  ', '       '];

    for (const label of emptyLabels) {
      const decisionDim = estimateConceptNodeDimensions(label, undefined, false, 'decision');
      const rectDim = estimateConceptNodeDimensions(label, undefined, false, 'process');
      const conceptDim = estimateConceptNodeDimensions(label, undefined, false, 'concept');

      // Limites mínimos do contrato
      expect(decisionDim.width).toBeGreaterThanOrEqual(DECISION_MIN_WIDTH);
      expect(decisionDim.height).toBeGreaterThanOrEqual(DECISION_MIN_HEIGHT);

      // Ampliação estrita sobre retângulos equivalentes
      expect(decisionDim.width).toBeGreaterThan(rectDim.width);
      expect(decisionDim.height).toBeGreaterThan(rectDim.height);
      expect(decisionDim.width).toBeGreaterThan(conceptDim.width);
      expect(decisionDim.height).toBeGreaterThan(conceptDim.height);

      // Finitude
      expect(Number.isFinite(decisionDim.width)).toBe(true);
      expect(Number.isFinite(decisionDim.height)).toBe(true);
    }
  });

  it('amplia o losango de decisão para palavras curtas e médias (ex: Sim?, Aprovar?, Validar entrada?)', () => {
    const shortLabels = [
      'OK',
      'Sim?',
      'Não?',
      'Válido?',
      'Status OK?',
      'Aprovar crédito do cliente?',
      'Existe estoque disponível para faturamento imediato?',
    ];

    for (const label of shortLabels) {
      const decision = estimateConceptNodeDimensions(label, undefined, false, 'decision');
      const process = estimateConceptNodeDimensions(label, undefined, false, 'process');

      expect(decision.width).toBeGreaterThan(process.width);
      expect(decision.height).toBeGreaterThan(process.height);

      // Verificação dos fatores de ampliação (1.45 e 1.55) ou piso mínimo (160x85)
      expect(decision.width).toBe(Math.max(DECISION_MIN_WIDTH, Math.round(process.width * DECISION_WIDTH_FACTOR)));
      expect(decision.height).toBe(Math.max(DECISION_MIN_HEIGHT, Math.round(process.height * DECISION_HEIGHT_FACTOR)));
    }
  });

  it('escala verticalmente de forma adaptativa para textos com múltiplas quebras explícitas de linha', () => {
    const multilineLabels = [
      'Linha 1\nLinha 2',
      'Critério 1\nCritério 2\nCritério 3',
      'Análise de Risco:\n- Score > 700?\n- Renda comprovada?\n- Sem restrições no BACEN?\n- Aprovação do comitê?',
      Array.from({ length: 12 }, (_, i) => `Condição de validação #${i + 1}`).join('\n'),
    ];

    for (const label of multilineLabels) {
      const decision = estimateConceptNodeDimensions(label, undefined, false, 'decision');
      const process = estimateConceptNodeDimensions(label, undefined, false, 'process');

      expect(decision.width).toBeGreaterThan(process.width);
      expect(decision.height).toBeGreaterThan(process.height);
      expect(decision.height).toBeGreaterThanOrEqual(DECISION_MIN_HEIGHT);
      expect(Number.isFinite(decision.width)).toBe(true);
      expect(Number.isFinite(decision.height)).toBe(true);
    }
  });

  it('comporta-se de maneira robusta diante de parágrafos contínuos extremamente longos (100 a 2000 chars)', () => {
    const longParagraphs = [
      'A'.repeat(100),
      'Texto contínuo sem quebras de linha com caracteres alfa-numéricos repetidos para simular entradas extensas '.repeat(5),
      'X'.repeat(500),
      'Z'.repeat(2000),
    ];

    for (const text of longParagraphs) {
      const decision = estimateConceptNodeDimensions(text, undefined, false, 'decision');
      const process = estimateConceptNodeDimensions(text, undefined, false, 'process');

      // A largura da caixa base satura em DEFAULT_NODE_MAX_WIDTH (220), logo a decisão satura em Math.round(220 * 1.45) = 319
      expect(decision.width).toBe(Math.round(DEFAULT_NODE_MAX_WIDTH * DECISION_WIDTH_FACTOR));
      expect(decision.width).toBeGreaterThan(process.width);
      expect(decision.height).toBeGreaterThan(process.height);
      expect(Number.isFinite(decision.width)).toBe(true);
      expect(Number.isFinite(decision.height)).toBe(true);
    }
  });

  it('preserva dimensões customizadas quando customSize: true e dimensões >= 80x36', () => {
    const customDim = { width: 320, height: 180 };
    const result = estimateConceptNodeDimensions('Pergunta', customDim, true, 'decision');

    expect(result).toEqual(customDim);

    // Se customSize for false, descarta dimensões customizadas e recalcula
    const recalculated = estimateConceptNodeDimensions('Pergunta', customDim, false, 'decision');
    expect(recalculated.width).not.toBe(customDim.width);
  });

  it('avalia uma matriz de 50 textos aleatórios garantindo monotonicidade estrita de tamanho entre decisão e retângulo', () => {
    const seedWords = ['Verificar', 'Validar', 'Decidir', 'Aprovar', 'Status', 'Cliente', 'Saldo', 'Transação', 'Alerta'];
    for (let i = 0; i < 50; i++) {
      const wordCount = (i % 8) + 1;
      const label = Array.from({ length: wordCount }, (_, k) => seedWords[(i + k) % seedWords.length]).join(' ');
      const decision = estimateConceptNodeDimensions(label, undefined, false, 'decision');
      const process = estimateConceptNodeDimensions(label, undefined, false, 'process');

      expect(decision.width).toBeGreaterThan(process.width);
      expect(decision.height).toBeGreaterThan(process.height);
      expect(decision.width).toBeGreaterThanOrEqual(DECISION_MIN_WIDTH);
      expect(decision.height).toBeGreaterThanOrEqual(DECISION_MIN_HEIGHT);
    }
  });

  it('valida que todas as 6 formas geométricas possuem limites mínimos estritos e dimensões positivas', () => {
    const shapes: FlowchartNodeShape[] = [
      'terminal',
      'process',
      'decision',
      'io',
      'subroutine',
      'document',
    ];

    for (const shape of shapes) {
      const dim = estimateConceptNodeDimensions('Teste de Forma', undefined, false, shape);
      expect(dim.width).toBeGreaterThan(0);
      expect(dim.height).toBeGreaterThan(0);
      expect(Number.isInteger(dim.width)).toBe(true);
      expect(Number.isInteger(dim.height)).toBe(true);
    }
  });
});

// ============================================================================
// SUÍTE 2: FLUXOGRAMAS HIERÁRQUICOS PROFUNDOS (DEEP PIPELINES)
// ============================================================================
describe('Empirical Challenge — Suíte 2: Fluxogramas Hierárquicos Profundos', () => {
  const algorithms: LayoutAlgorithmType[] = [
    'novak-backbone',
    'dagre-hierarchical',
    'elk-layered',
    'force-directed',
    'radial-tree',
  ];

  it('processa cadeia linear profunda de 25 nós sem NaN e com monotonicidade vertical em TB', async () => {
    const depth = 25;
    const concepts: ConceptSpec[] = Array.from({ length: depth }, (_, i) => ({
      id: `step_${i}`,
      label: `Etapa do Fluxo #${i + 1}`,
      shape: i === 0 ? 'terminal' : i === depth - 1 ? 'terminal' : (i % 3 === 0 ? 'decision' : 'process'),
    }));

    const relations: RelationSpec[] = Array.from({ length: depth - 1 }, (_, i) => ({
      sourceId: `step_${i}`,
      targetId: `step_${i + 1}`,
      linkingPhrase: i % 3 === 0 ? 'Sim' : '',
    }));

    const semantic = buildSemanticFixture({ concepts, relations });

    for (const algorithm of algorithms) {
      const result = await computeConceptMapLayout(semantic, undefined, {
        algorithm,
        direction: 'TB',
      });

      assertStrictNumericValidity(result);

      // Em layouts hierárquicos dirigidos para baixo (TB), a posição Y dos nós subsequentes deve avançar
      if (algorithm === 'novak-backbone' || algorithm === 'dagre-hierarchical' || algorithm === 'elk-layered') {
        for (let i = 0; i < depth - 1; i++) {
          const currentY = result.nodes[`step_${i}`].position.y;
          const nextY = result.nodes[`step_${i + 1}`].position.y;
          expect(nextY).toBeGreaterThan(currentY);
        }
      }

      // Todas as arestas devem ter curva default 'smoothstep' em modo flowchart
      for (const edge of Object.values(result.edges)) {
        expect(edge.curveType).toBe('smoothstep');
      }
    }
  });

  it('processa cadeia linear profunda no sentido horizontal (LR) com avanço estrito em X', async () => {
    const depth = 15;
    const concepts: ConceptSpec[] = Array.from({ length: depth }, (_, i) => ({
      id: `h_step_${i}`,
      label: `Fase ${i + 1}`,
      shape: 'process',
    }));

    const relations: RelationSpec[] = Array.from({ length: depth - 1 }, (_, i) => ({
      sourceId: `h_step_${i}`,
      targetId: `h_step_${i + 1}`,
    }));

    const semantic = buildSemanticFixture({ concepts, relations });

    const resultDagre = await computeConceptMapLayout(semantic, undefined, {
      algorithm: 'dagre-hierarchical',
      direction: 'LR',
    });

    assertStrictNumericValidity(resultDagre);

    for (let i = 0; i < depth - 1; i++) {
      const currentX = resultDagre.nodes[`h_step_${i}`].position.x;
      const nextX = resultDagre.nodes[`h_step_${i + 1}`].position.x;
      expect(nextX).toBeGreaterThan(currentX);
    }
  });

  it('suporta cadeia extrema de 60 nós sob Dagre em menos de 1000ms', async () => {
    const depth = 60;
    const concepts: ConceptSpec[] = Array.from({ length: depth }, (_, i) => ({
      id: `deep_${i}`,
      label: `Nó Profundo ${i}`,
      shape: i % 4 === 0 ? 'decision' : 'process',
    }));

    const relations: RelationSpec[] = Array.from({ length: depth - 1 }, (_, i) => ({
      sourceId: `deep_${i}`,
      targetId: `deep_${i + 1}`,
      linkingPhrase: i % 4 === 0 ? 'Avançar' : '',
    }));

    const semantic = buildSemanticFixture({ concepts, relations });

    const startTime = performance.now();
    const result = await computeConceptMapLayout(semantic, undefined, {
      algorithm: 'dagre-hierarchical',
      direction: 'TB',
    });
    const duration = performance.now() - startTime;

    expect(duration).toBeLessThan(1000);
    assertStrictNumericValidity(result);
    expect(Object.keys(result.nodes)).toHaveLength(depth);
    expect(Object.keys(result.edges)).toHaveLength(depth - 1);
  });
});

// ============================================================================
// SUÍTE 3: GRAFOS CÍCLICOS E LAÇOS DE RETORNO (LOOP-BACKS)
// ============================================================================
describe('Empirical Challenge — Suíte 3: Grafos Cíclicos e Laços de Retorno', () => {
  it('executa com segurança diante de laço de retroalimentação 2-ciclo (A -> B -> A)', async () => {
    const semantic = buildSemanticFixture({
      concepts: [
        { id: 'dev', label: 'Desenvolvimento do Código', shape: 'process' },
        { id: 'review', label: 'Revisão por Pares', shape: 'decision' },
      ],
      relations: [
        { id: 'forward', sourceId: 'dev', targetId: 'review', linkingPhrase: 'Submeter PR', type: 'sequence' },
        { id: 'backward', sourceId: 'review', targetId: 'dev', linkingPhrase: 'Solicitar ajustes (retorno)', type: 'loop-back', flowKind: 'loop-back' },
      ],
    });

    const result = await computeConceptMapLayout(semantic, undefined, {
      algorithm: 'novak-backbone',
      direction: 'TB',
    });

    assertStrictNumericValidity(result);

    // O nó de decisão com aresta de retorno para cima deve usar porta lateral (right ou left)
    const backwardEdge = result.edges['backward'];
    expect(['right', 'left']).toContain(backwardEdge.sourceHandle);
  });

  it('gerencia ciclos múltiplos e aninhados sem travamentos ou coordenadas NaN', async () => {
    const semantic = buildSemanticFixture({
      concepts: [
        { id: 'A', label: 'Etapa A (Início)', shape: 'terminal' },
        { id: 'B', label: 'Etapa B (Validação 1)', shape: 'decision' },
        { id: 'C', label: 'Etapa C (Processamento)', shape: 'process' },
        { id: 'D', label: 'Etapa D (Validação 2)', shape: 'decision' },
        { id: 'E', label: 'Etapa E (Ajuste fino)', shape: 'process' },
        { id: 'F', label: 'Etapa F (Homologação)', shape: 'decision' },
        { id: 'G', label: 'Etapa G (Conclusão)', shape: 'terminal' },
      ],
      relations: [
        { sourceId: 'A', targetId: 'B', linkingPhrase: 'iniciar' },
        { sourceId: 'B', targetId: 'C', linkingPhrase: 'Sim' },
        { sourceId: 'C', targetId: 'D', linkingPhrase: 'processado' },
        { sourceId: 'D', targetId: 'E', linkingPhrase: 'Sim' },
        { sourceId: 'E', targetId: 'F', linkingPhrase: 'analisado' },
        { sourceId: 'F', targetId: 'G', linkingPhrase: 'Aprovado' },
        // Laços de feedback:
        { id: 'loop_c_b', sourceId: 'C', targetId: 'B', linkingPhrase: 'repetir', type: 'loop-back' },
        { id: 'loop_e_c', sourceId: 'E', targetId: 'C', linkingPhrase: 'refazer', type: 'loop-back' },
        { id: 'loop_f_a', sourceId: 'F', targetId: 'A', linkingPhrase: 'retorno geral', type: 'loop-back' },
      ],
    });

    const algorithmsToTest: LayoutAlgorithmType[] = ['novak-backbone', 'dagre-hierarchical', 'elk-layered'];

    for (const algorithm of algorithmsToTest) {
      const result = await computeConceptMapLayout(semantic, undefined, {
        algorithm,
        direction: 'TB',
      });

      assertStrictNumericValidity(result);

      // Todos os nós devem ter coordenadas distintas e calculadas
      const positions = Object.values(result.nodes).map((n) => `${n.position.x},${n.position.y}`);
      expect(new Set(positions).size).toBe(7);

      // Laço de F para A deve sair por porta lateral
      expect(['right', 'left']).toContain(result.edges['loop_f_a'].sourceHandle);
    }
  });

  it('lida com auto-laço (self-loop A -> A) sem quebrar o motor de layout', async () => {
    const semantic = buildSemanticFixture({
      concepts: [
        { id: 'retry_task', label: 'Tarefa com Retentativa Automática', shape: 'process' },
      ],
      relations: [
        { id: 'self_edge', sourceId: 'retry_task', targetId: 'retry_task', linkingPhrase: 'retry loop', type: 'loop-back' },
      ],
    });

    const result = await computeConceptMapLayout(semantic, undefined, {
      algorithm: 'dagre-hierarchical',
    });

    assertStrictNumericValidity(result);
    expect(result.nodes['retry_task'].position.x).toBeDefined();
    expect(result.nodes['retry_task'].position.y).toBeDefined();
  });
});

// ============================================================================
// SUÍTE 4: NÓS DE DECISÃO COM MÚLTIPLOS RAMOS (BRANCHING TOPOLOGIES)
// ============================================================================
describe('Empirical Challenge — Suíte 4: Nós de Decisão e Múltiplos Ramos', () => {
  it('atribui portas inteligentes padrão para ramos Sim (fundo) e Não (lateral) em TB', async () => {
    const semantic = buildSemanticFixture({
      concepts: [
        { id: 'check', label: 'Aprovado pelo Gestor?', shape: 'decision' },
        { id: 'pass', label: 'Emitir Pedido de Compra', shape: 'process' },
        { id: 'fail', label: 'Notificar Rejeição ao Solicitante', shape: 'process' },
      ],
      relations: [
        { id: 'rel_yes', sourceId: 'check', targetId: 'pass', linkingPhrase: 'Sim', type: 'conditional' },
        { id: 'rel_no', sourceId: 'check', targetId: 'fail', linkingPhrase: 'Não', type: 'conditional' },
      ],
    });

    const result = await computeConceptMapLayout(semantic, undefined, {
      algorithm: 'novak-backbone',
      direction: 'TB',
    });

    assertStrictNumericValidity(result);

    const yesEdge = result.edges['rel_yes'];
    const noEdge = result.edges['rel_no'];

    // Ramo Sim deve sair pelo fundo (bottom) e entrar pelo topo (top)
    expect(yesEdge.sourceHandle).toBe('bottom');
    expect(yesEdge.targetHandle).toBe('top');

    // Ramo Não deve sair por uma das laterais (right ou left)
    expect(['right', 'left']).toContain(noEdge.sourceHandle);
  });

  it('gerencia ramificação múltipla (multi-way branch com 4 condições) distribuindo offsets', async () => {
    const semantic = buildSemanticFixture({
      concepts: [
        { id: 'switch_node', label: 'Tipo de Documento Identificado?', shape: 'decision' },
        { id: 'case_cpf', label: 'Processar Fluxo Pessoa Física (CPF)', shape: 'process' },
        { id: 'case_cnpj', label: 'Processar Fluxo Pessoa Jurídica (CNPJ)', shape: 'process' },
        { id: 'case_estrangeiro', label: 'Processar Passaporte / RNE', shape: 'process' },
        { id: 'case_outro', label: 'Encaminhar para Mesa de Exceção', shape: 'process' },
      ],
      relations: [
        { id: 'r1', sourceId: 'switch_node', targetId: 'case_cpf', linkingPhrase: 'Opção CPF' },
        { id: 'r2', sourceId: 'switch_node', targetId: 'case_cnpj', linkingPhrase: 'Opção CNPJ' },
        { id: 'r3', sourceId: 'switch_node', targetId: 'case_estrangeiro', linkingPhrase: 'Passaporte' },
        { id: 'r4', sourceId: 'switch_node', targetId: 'case_outro', linkingPhrase: 'Outros Casos' },
      ],
    });

    const result = await computeConceptMapLayout(semantic, undefined, {
      algorithm: 'dagre-hierarchical',
      direction: 'TB',
    });

    assertStrictNumericValidity(result);

    // Os offsets t calculados não devem ser todos idênticos para evitar sobreposição das 4 pílulas de rótulo
    const tValues = ['r1', 'r2', 'r3', 'r4'].map((rId) => result.edges[rId]?.labelOffset?.t);
    const uniqueTValues = new Set(tValues);
    expect(uniqueTValues.size).toBeGreaterThan(1);
  });

  it('suporta árvore de decisão binária completa de 15 nós (3 níveis de decisões + folhas)', async () => {
    const concepts: ConceptSpec[] = [];
    const relations: RelationSpec[] = [];

    // Nível 0 (raiz)
    concepts.push({ id: 'd0', label: 'Decisão Raiz', shape: 'decision' });

    // Nível 1 (2 decisões)
    concepts.push({ id: 'd1_L', label: 'Decisão 1 L', shape: 'decision' });
    concepts.push({ id: 'd1_R', label: 'Decisão 1 R', shape: 'decision' });
    relations.push({ sourceId: 'd0', targetId: 'd1_L', linkingPhrase: 'Sim' });
    relations.push({ sourceId: 'd0', targetId: 'd1_R', linkingPhrase: 'Não' });

    // Nível 2 (4 decisões)
    for (const parent of ['d1_L', 'd1_R']) {
      for (const branch of ['Sim', 'Não']) {
        const childId = `${parent}_${branch}`;
        concepts.push({ id: childId, label: `Decisão ${childId}`, shape: 'decision' });
        relations.push({ sourceId: parent, targetId: childId, linkingPhrase: branch });
      }
    }

    // Nível 3 (8 terminais)
    for (const parent of ['d1_L_Sim', 'd1_L_Não', 'd1_R_Sim', 'd1_R_Não']) {
      for (const branch of ['Aprovar', 'Reprovar']) {
        const leafId = `leaf_${parent}_${branch}`;
        concepts.push({ id: leafId, label: `Fim: ${branch}`, shape: 'terminal' });
        relations.push({ sourceId: parent, targetId: leafId, linkingPhrase: branch });
      }
    }

    const semantic = buildSemanticFixture({ concepts, relations });

    const result = await computeConceptMapLayout(semantic, undefined, {
      algorithm: 'dagre-hierarchical',
      direction: 'TB',
    });

    assertStrictNumericValidity(result);
    expect(Object.keys(result.nodes)).toHaveLength(15);
    expect(Object.keys(result.edges)).toHaveLength(14);
  });
});

// ============================================================================
// SUÍTE 5: LIMITES NUMÉRICOS EXTREMOS, GRAFOS DESCONEXOS E ISOLADOS
// ============================================================================
describe('Empirical Challenge — Suíte 5: Robustez Numérica e Casos Limite', () => {
  it('retorna resultado vazio limpo para modelo sem nós nem relações', async () => {
    const semantic = buildSemanticFixture({ concepts: [], relations: [] });
    const result = await computeConceptMapLayout(semantic);

    expect(result.nodes).toEqual({});
    expect(result.edges).toEqual({});
  });

  it('posiciona adequadamente nó único isolado sem arestas', async () => {
    const semantic = buildSemanticFixture({
      concepts: [{ id: 'solo', label: 'Conceito Único Isolado', shape: 'process' }],
      relations: [],
    });

    const result = await computeConceptMapLayout(semantic);

    assertStrictNumericValidity(result);
    expect(result.nodes['solo'].position.x).toBeDefined();
    expect(result.nodes['solo'].position.y).toBeDefined();
  });

  it('empacota 30 nós isolados em grade organizada sem NaN nem colisão de coordenadas', async () => {
    const count = 30;
    const concepts: ConceptSpec[] = Array.from({ length: count }, (_, i) => ({
      id: `iso_${i}`,
      label: `Nó Avulso #${i + 1}`,
      shape: 'process',
    }));

    const semantic = buildSemanticFixture({ concepts, relations: [] });
    const result = await computeConceptMapLayout(semantic);

    assertStrictNumericValidity(result);
    expect(Object.keys(result.nodes)).toHaveLength(count);

    // As posições devem estar organizadas em colunas/linhas na grade lateral
    const coords = Object.values(result.nodes).map((n) => `${n.position.x},${n.position.y}`);
    expect(new Set(coords).size).toBe(count);
  });

  it('preserva as posições de nós fixados (pinned: true) quando respectPinnedNodes for verdadeiro', async () => {
    const semantic = buildSemanticFixture({
      concepts: [
        { id: 'pin1', label: 'Nó Fixo A', shape: 'process' },
        { id: 'pin2', label: 'Nó Fixo B', shape: 'process' },
        { id: 'free1', label: 'Nó Livre C', shape: 'process' },
      ],
      relations: [
        { sourceId: 'pin1', targetId: 'free1' },
        { sourceId: 'free1', targetId: 'pin2' },
      ],
    });

    const existingVisual: VisualModel = {
      nodes: {
        pin1: {
          conceptId: 'pin1',
          position: { x: 50, y: 75 },
          pinned: true,
          nodeShape: 'process',
        },
        pin2: {
          conceptId: 'pin2',
          position: { x: 800, y: 900 },
          pinned: true,
          nodeShape: 'process',
        },
      },
      edges: {},
      viewport: { x: 0, y: 0, zoom: 1 },
      crossLinkVisibility: 'all',
      layoutSettings: {
        ...DEFAULT_LAYOUT_SETTINGS,
        respectPinnedNodes: true,
      },
    };

    const result = await computeConceptMapLayout(semantic, existingVisual, {
      respectPinnedNodes: true,
      algorithm: 'novak-backbone',
    });

    assertStrictNumericValidity(result);

    // pin1 e pin2 devem manter exatamente suas coordenadas originais
    expect(result.nodes['pin1'].position).toEqual({ x: 50, y: 75 });
    expect(result.nodes['pin2'].position).toEqual({ x: 800, y: 900 });
  });

  it('lida com grafo denso altamente conectado (bipartido completo K4,4 com 16 arestas)', async () => {
    const groupA = ['A1', 'A2', 'A3', 'A4'];
    const groupB = ['B1', 'B2', 'B3', 'B4'];

    const concepts: ConceptSpec[] = [
      ...groupA.map((id) => ({ id, label: `Origem ${id}`, shape: 'process' as FlowchartNodeShape })),
      ...groupB.map((id) => ({ id, label: `Destino ${id}`, shape: 'decision' as FlowchartNodeShape })),
    ];

    const relations: RelationSpec[] = [];
    for (const a of groupA) {
      for (const b of groupB) {
        relations.push({ sourceId: a, targetId: b, linkingPhrase: 'conecta' });
      }
    }

    const semantic = buildSemanticFixture({ concepts, relations });

    const result = await computeConceptMapLayout(semantic, undefined, {
      algorithm: 'dagre-hierarchical',
    });

    assertStrictNumericValidity(result);
    expect(Object.keys(result.nodes)).toHaveLength(8);
    expect(Object.keys(result.edges)).toHaveLength(16);
  });

  it('gerencia múltiplos componentes desconexos cada um com seus próprios ciclos', async () => {
    // Componente 1: A <-> B (ciclo)
    // Componente 2: C -> D -> E -> C (ciclo de 3)
    // Componente 3: F isolado
    const semantic = buildSemanticFixture({
      concepts: [
        { id: 'C1_A', label: 'Comp 1 - Nó A', shape: 'process' },
        { id: 'C1_B', label: 'Comp 1 - Nó B', shape: 'decision' },
        { id: 'C2_C', label: 'Comp 2 - Nó C', shape: 'process' },
        { id: 'C2_D', label: 'Comp 2 - Nó D', shape: 'process' },
        { id: 'C2_E', label: 'Comp 2 - Nó E', shape: 'decision' },
        { id: 'C3_F', label: 'Comp 3 - Nó F (Isolado)', shape: 'terminal' },
      ],
      relations: [
        // Componente 1
        { id: 'r1', sourceId: 'C1_A', targetId: 'C1_B', linkingPhrase: 'avança' },
        { id: 'r2', sourceId: 'C1_B', targetId: 'C1_A', linkingPhrase: 'retorno', type: 'loop-back' },
        // Componente 2
        { id: 'r3', sourceId: 'C2_C', targetId: 'C2_D', linkingPhrase: 'vai' },
        { id: 'r4', sourceId: 'C2_D', targetId: 'C2_E', linkingPhrase: 'valida' },
        { id: 'r5', sourceId: 'C2_E', targetId: 'C2_C', linkingPhrase: 'reprocessa', type: 'loop-back' },
      ],
    });

    const algorithms: LayoutAlgorithmType[] = ['novak-backbone', 'dagre-hierarchical', 'elk-layered'];
    for (const algorithm of algorithms) {
      const result = await computeConceptMapLayout(semantic, undefined, { algorithm });
      assertStrictNumericValidity(result);
      expect(Object.keys(result.nodes)).toHaveLength(6);
      expect(Object.keys(result.edges)).toHaveLength(5);
    }
  });

  it('suporta arestas paralelas entre o mesmo par de nós (multigrafo: A -> B via Ramo 1 e A -> B via Ramo 2)', async () => {
    const semantic = buildSemanticFixture({
      concepts: [
        { id: 'src', label: 'Origem Multigrafo', shape: 'decision' },
        { id: 'tgt', label: 'Destino Multigrafo', shape: 'process' },
      ],
      relations: [
        { id: 'rel_fast', sourceId: 'src', targetId: 'tgt', linkingPhrase: 'Via Expressa', type: 'conditional' },
        { id: 'rel_slow', sourceId: 'src', targetId: 'tgt', linkingPhrase: 'Via Padrão', type: 'conditional' },
      ],
    });

    const result = await computeConceptMapLayout(semantic, undefined, {
      algorithm: 'dagre-hierarchical',
    });

    assertStrictNumericValidity(result);
    expect(result.edges['rel_fast']).toBeDefined();
    expect(result.edges['rel_slow']).toBeDefined();
    // Offsets de rótulo devem ser escalonados para não colidirem
    expect(result.edges['rel_fast'].labelOffset?.t).not.toBe(result.edges['rel_slow'].labelOffset?.t);
  });

  it('tolera relações apontando para nós inexistentes (dangling edges) sem quebrar o layout', async () => {
    const semantic = buildSemanticFixture({
      concepts: [
        { id: 'valid_1', label: 'Nó Válido 1', shape: 'process' },
        { id: 'valid_2', label: 'Nó Válido 2', shape: 'process' },
      ],
      relations: [
        { id: 'valid_rel', sourceId: 'valid_1', targetId: 'valid_2', linkingPhrase: 'ok' },
        { id: 'ghost_source', sourceId: 'nao_existe', targetId: 'valid_2', linkingPhrase: 'invalido' },
        { id: 'ghost_target', sourceId: 'valid_1', targetId: 'fantasma', linkingPhrase: 'invalido' },
      ],
    });

    const result = await computeConceptMapLayout(semantic, undefined, {
      algorithm: 'novak-backbone',
    });

    assertStrictNumericValidity(result);
    expect(result.nodes['valid_1']).toBeDefined();
    expect(result.nodes['valid_2']).toBeDefined();
    expect(result.edges['valid_rel']).toBeDefined();
  });

  it('suporta leque de alta dispersão (fan-out com 15 ramos a partir de decisão)', async () => {
    const branchCount = 15;
    const concepts: ConceptSpec[] = [
      { id: 'hub', label: 'Roteador Central de Eventos', shape: 'decision' },
      ...Array.from({ length: branchCount }, (_, i) => ({
        id: `dest_${i}`,
        label: `Consumidor #${i + 1}`,
        shape: 'process' as FlowchartNodeShape,
      })),
    ];

    const relations: RelationSpec[] = Array.from({ length: branchCount }, (_, i) => ({
      id: `branch_${i}`,
      sourceId: 'hub',
      targetId: `dest_${i}`,
      linkingPhrase: `Evento E${i}`,
    }));

    const semantic = buildSemanticFixture({ concepts, relations });

    const result = await computeConceptMapLayout(semantic, undefined, {
      algorithm: 'dagre-hierarchical',
    });

    assertStrictNumericValidity(result);
    expect(Object.keys(result.nodes)).toHaveLength(branchCount + 1);
    expect(Object.keys(result.edges)).toHaveLength(branchCount);
  });

  it('lida com configurações de espaçamento zero sem divisão por zero ou coordenadas NaN', async () => {
    const semantic = buildSemanticFixture({
      concepts: [
        { id: 'n1', label: 'Nó Compacto 1', shape: 'process' },
        { id: 'n2', label: 'Nó Compacto 2', shape: 'decision' },
        { id: 'n3', label: 'Nó Compacto 3', shape: 'terminal' },
      ],
      relations: [
        { sourceId: 'n1', targetId: 'n2', linkingPhrase: 'vai' },
        { sourceId: 'n2', targetId: 'n3', linkingPhrase: 'fim' },
      ],
    });

    const tightSettings: Partial<LayoutSettings> = {
      nodeSpacingX: 0,
      nodeSpacingY: 0,
      layerSpacing: 0,
    };

    const result = await computeConceptMapLayout(semantic, undefined, tightSettings);
    assertStrictNumericValidity(result);
  });
});
