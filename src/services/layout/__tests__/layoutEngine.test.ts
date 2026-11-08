import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  ConceptNodeVisual,
  LayoutAlgorithmType,
  SemanticModel,
  VisualModel,
} from '../../../domain/types';
import { parseConceptMapMarkdown } from '../../parser/markdownParser';
import {
  computeConceptMapLayout,
  computeSmartEdgeHandles,
  DEFAULT_LAYOUT_SETTINGS,
} from '../layoutEngine';
import {
  DECISION_MIN_HEIGHT,
  DECISION_MIN_WIDTH,
  DOCUMENT_MIN_HEIGHT,
  DOCUMENT_MIN_WIDTH,
  estimateConceptNodeDimensions,
  IO_MIN_HEIGHT,
  IO_MIN_WIDTH,
  PROCESS_MIN_HEIGHT,
  PROCESS_MIN_WIDTH,
  SUBROUTINE_MIN_HEIGHT,
  SUBROUTINE_MIN_WIDTH,
  TERMINAL_MIN_HEIGHT,
  TERMINAL_MIN_WIDTH,
} from '../nodeSizing';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exemploPath = path.resolve(__dirname, '../../../../exemplo.md');
const flowchartPath = path.resolve(__dirname, '../../../../exemplo-fluxograma.md');

describe('LayoutEngine (Etapa 3)', () => {
  const rawMarkdown = fs.readFileSync(exemploPath, 'utf-8');
  const parsed = parseConceptMapMarkdown(rawMarkdown);

  const algorithms: LayoutAlgorithmType[] = [
    'novak-backbone',
    'elk-layered',
    'dagre-hierarchical',
    'force-directed',
    'radial-tree',
  ];

  it.each(algorithms)(
    'calcula coordenadas finitas e sem sobreposição de nós no algoritmo %s para exemplo.md',
    async (algorithm) => {
      const result = await computeConceptMapLayout(parsed.semantic, undefined, {
        algorithm,
        direction: 'TB',
      });

      const nodeIds = Object.keys(result.nodes);
      expect(nodeIds).toHaveLength(32);

      // Verifica que todas as coordenadas são números finitos
      for (const id of nodeIds) {
        const node = result.nodes[id];
        expect(Number.isFinite(node.position.x)).toBe(true);
        expect(Number.isFinite(node.position.y)).toBe(true);
        expect(node.dimensions?.width).toBeGreaterThan(80);
        expect(node.dimensions?.height).toBeGreaterThan(36);
      }

      // Verifica que nenhum par de nós possui colisão de caixa (AABB intersection)
      for (let i = 0; i < nodeIds.length; i++) {
        for (let j = i + 1; j < nodeIds.length; j++) {
          const a = result.nodes[nodeIds[i]];
          const b = result.nodes[nodeIds[j]];

          const aLeft = a.position.x;
          const aRight = a.position.x + (a.dimensions?.width ?? 180);
          const aTop = a.position.y;
          const aBottom = a.position.y + (a.dimensions?.height ?? 50);

          const bLeft = b.position.x;
          const bRight = b.position.x + (b.dimensions?.width ?? 180);
          const bTop = b.position.y;
          const bBottom = b.position.y + (b.dimensions?.height ?? 50);

          const intersects =
            aLeft < bRight - 1 &&
            aRight > bLeft + 1 &&
            aTop < bBottom - 1 &&
            aBottom > bTop + 1;

          expect(intersects).toBe(false);
        }
      }
    }
  );

  it('preserva a hierarquia de Novak (Projeto POP acima de Cinturão de proteção e Reserva Ducke) no modo novak-backbone', async () => {
    const result = await computeConceptMapLayout(parsed.semantic, undefined, {
      algorithm: 'novak-backbone',
      direction: 'TB',
    });

    const popY = result.nodes['concept-projeto-pop'].position.y;
    const cinturaoY = result.nodes['concept-cinturao-de-protecao'].position.y;
    const duckeY = result.nodes['concept-reserva-ducke'].position.y;
    const recursosY = result.nodes['concept-recursos-hidricos'].position.y;

    expect(popY).toBeLessThan(cinturaoY);
    expect(cinturaoY).toBeLessThan(duckeY);
    expect(duckeY).toBeLessThan(recursosY);

    // Mesmo recebendo várias ligações cruzadas de níveis inferiores, "Impactos ambientais" permanece no Nível 1!
    const impactosY = result.nodes['concept-impactos-ambientais'].position.y;
    expect(Math.abs(impactosY - cinturaoY)).toBeLessThan(40);
  });

  it('preserva exatamente a posição de nós com pinned=true durante reorganização automática', async () => {
    const initial = await computeConceptMapLayout(parsed.semantic);

    const visualWithPin: VisualModel = {
      nodes: {
        ...initial.nodes,
        'concept-reserva-ducke': {
          ...initial.nodes['concept-reserva-ducke'],
          position: { x: 1234, y: 567 },
          pinned: true,
        },
      },
      edges: initial.edges,
      viewport: { x: 0, y: 0, zoom: 1 },
      layoutSettings: {
        ...DEFAULT_LAYOUT_SETTINGS,
        respectPinnedNodes: true,
      },
      crossLinkVisibility: 'all',
    };

    const relaidOut = await computeConceptMapLayout(
      parsed.semantic,
      visualWithPin,
      {
        algorithm: 'novak-backbone',
        respectPinnedNodes: true,
      }
    );

    expect(relaidOut.nodes['concept-reserva-ducke'].position).toEqual({
      x: 1234,
      y: 567,
    });
    expect(relaidOut.nodes['concept-reserva-ducke'].position).toEqual({
      x: 1234,
      y: 567,
    });
    expect(relaidOut.nodes['concept-reserva-ducke'].pinned).toBe(true);
  });
});

describe('Shape-Aware Node Sizing (Milestone 2)', () => {
  it('mantém 100% de compatibilidade retroativa quando a forma é indefinida ou concept', () => {
    const label = 'Gestão Ambiental Integrada';
    const dimsDefault = estimateConceptNodeDimensions(label);
    const dimsExplicit = estimateConceptNodeDimensions(
      label,
      undefined,
      false,
      'concept'
    );
    expect(dimsDefault).toEqual(dimsExplicit);
    expect(dimsDefault.width).toBeGreaterThanOrEqual(140);
    expect(dimsDefault.height).toBeGreaterThanOrEqual(48);
  });

  describe('Losango de Decisão (decision)', () => {
    it('amplia a bounding box (W*1.45, H*1.55, min 160x85) para acomodar texto no losango inscrito', () => {
      const label = 'O código foi revisado por 2 pares?';
      const normalDims = estimateConceptNodeDimensions(label);
      const decisionDims = estimateConceptNodeDimensions(
        label,
        undefined,
        false,
        'decision'
      );

      expect(decisionDims.width).toBeGreaterThanOrEqual(normalDims.width * 1.35);
      expect(decisionDims.height).toBeGreaterThanOrEqual(normalDims.height * 1.45);
      expect(decisionDims.width).toBeGreaterThanOrEqual(DECISION_MIN_WIDTH);
      expect(decisionDims.height).toBeGreaterThanOrEqual(DECISION_MIN_HEIGHT);
    });

    it('respeita os limites mínimos de 160x85 px mesmo com rótulo curto ou vazio', () => {
      const dimsEmpty = estimateConceptNodeDimensions('', undefined, false, 'decision');
      expect(dimsEmpty.width).toBeGreaterThanOrEqual(160);
      expect(dimsEmpty.height).toBeGreaterThanOrEqual(85);

      const dimsSingle = estimateConceptNodeDimensions('?', undefined, false, 'decision');
      expect(dimsSingle.width).toBeGreaterThanOrEqual(160);
      expect(dimsSingle.height).toBeGreaterThanOrEqual(85);
    });

    it('escala dinamicamente com textos longos sem truncar', () => {
      const longQuestion =
        'O projeto atende aos requisitos do Artigo 61 e foi homologado pelos órgãos ambientais competentes?';
      const decisionDims = estimateConceptNodeDimensions(
        longQuestion,
        undefined,
        false,
        'decision'
      );
      expect(decisionDims.width).toBeGreaterThanOrEqual(200);
      expect(decisionDims.height).toBeGreaterThanOrEqual(100);
    });
  });

  describe('Terminal (terminal / pill)', () => {
    it('adiciona folga lateral para rótulos de início e fim mantendo limites mínimos de 130x44 px', () => {
      const normalStart = estimateConceptNodeDimensions('Início');
      const terminalStart = estimateConceptNodeDimensions(
        'Início',
        undefined,
        false,
        'terminal'
      );

      expect(terminalStart.width).toBeGreaterThan(normalStart.width);
      expect(terminalStart.width).toBeGreaterThanOrEqual(TERMINAL_MIN_WIDTH);
      expect(terminalStart.height).toBeGreaterThanOrEqual(TERMINAL_MIN_HEIGHT);
    });
  });

  describe('Entrada/Saída (io / parallelogram)', () => {
    it('adiciona folga horizontal compensando a inclinação de 15 graus', () => {
      const label = 'Entrada de Dados do Usuário';
      const normalDims = estimateConceptNodeDimensions(label);
      const ioDims = estimateConceptNodeDimensions(label, undefined, false, 'io');

      expect(ioDims.width).toBeGreaterThan(normalDims.width);
      expect(ioDims.width).toBeGreaterThanOrEqual(IO_MIN_WIDTH);
      expect(ioDims.height).toBeGreaterThanOrEqual(IO_MIN_HEIGHT);
    });
  });

  describe('Sub-rotina (subroutine)', () => {
    it('adiciona folga horizontal para acomodar as barras verticais duplas', () => {
      const label = 'Processar Pagamento';
      const normalDims = estimateConceptNodeDimensions(label);
      const subDims = estimateConceptNodeDimensions(
        label,
        undefined,
        false,
        'subroutine'
      );

      expect(subDims.width).toBeGreaterThan(normalDims.width);
      expect(subDims.width).toBeGreaterThanOrEqual(SUBROUTINE_MIN_WIDTH);
      expect(subDims.height).toBeGreaterThanOrEqual(SUBROUTINE_MIN_HEIGHT);
    });
  });

  describe('Documento (document)', () => {
    it('adiciona folga vertical para a curva da base ondulada', () => {
      const label = 'Relatório de Auditoria';
      const normalDims = estimateConceptNodeDimensions(label);
      const docDims = estimateConceptNodeDimensions(
        label,
        undefined,
        false,
        'document'
      );

      expect(docDims.height).toBeGreaterThan(normalDims.height);
      expect(docDims.width).toBeGreaterThanOrEqual(DOCUMENT_MIN_WIDTH);
      expect(docDims.height).toBeGreaterThanOrEqual(DOCUMENT_MIN_HEIGHT);
    });
  });

  describe('Processo (process)', () => {
    it('utiliza dimensões padrão com limites mínimos de processo (140x48 px)', () => {
      const label = 'Etapa de Cálculo';
      const processDims = estimateConceptNodeDimensions(
        label,
        undefined,
        false,
        'process'
      );
      expect(processDims.width).toBeGreaterThanOrEqual(PROCESS_MIN_WIDTH);
      expect(processDims.height).toBeGreaterThanOrEqual(PROCESS_MIN_HEIGHT);
    });
  });
});

describe('Smart Handles & Orthogonal Routing (Milestone 2)', () => {
  it('atribui portas inteligentes corretas para ramos afirmativos, negativos e retorno de nó de decisão', () => {
    const semantic: SemanticModel = {
      diagramMode: 'flowchart',
      title: 'Teste Decisão',
      concepts: {
        'c-decisao': {
          id: 'c-decisao',
          label: 'Validação OK?',
          normalizedKey: 'validacao ok',
          nodeShape: 'decision',
        },
        'c-sim': {
          id: 'c-sim',
          label: 'Próxima Etapa',
          normalizedKey: 'proxima etapa',
          nodeShape: 'process',
        },
        'c-nao': {
          id: 'c-nao',
          label: 'Corrigir Dados',
          normalizedKey: 'corrigir dados',
          nodeShape: 'process',
        },
        'c-loop': {
          id: 'c-loop',
          label: 'Etapa Anterior',
          normalizedKey: 'etapa anterior',
          nodeShape: 'process',
        },
      },
      conceptOrder: ['c-loop', 'c-decisao', 'c-sim', 'c-nao'],
      relations: {
        'r-sim': {
          id: 'r-sim',
          orderIndex: 1,
          sourceId: 'c-decisao',
          targetId: 'c-sim',
          linkingPhrase: 'Sim',
          type: 'conditional',
        },
        'r-nao': {
          id: 'r-nao',
          orderIndex: 2,
          sourceId: 'c-decisao',
          targetId: 'c-nao',
          linkingPhrase: 'Não',
          type: 'conditional',
        },
        'r-loop': {
          id: 'r-loop',
          orderIndex: 3,
          sourceId: 'c-decisao',
          targetId: 'c-loop',
          linkingPhrase: 'Retorno',
          type: 'loop-back',
        },
      },
      relationOrder: ['r-sim', 'r-nao', 'r-loop'],
    };

    const nodes: Record<string, ConceptNodeVisual> = {
      'c-loop': {
        conceptId: 'c-loop',
        position: { x: 200, y: 50 },
        dimensions: { width: 140, height: 48 },
        pinned: false,
      },
      'c-decisao': {
        conceptId: 'c-decisao',
        position: { x: 200, y: 250 },
        dimensions: { width: 160, height: 85 },
        pinned: false,
      },
      'c-sim': {
        conceptId: 'c-sim',
        position: { x: 200, y: 450 },
        dimensions: { width: 140, height: 48 },
        pinned: false,
      },
      'c-nao': {
        conceptId: 'c-nao',
        position: { x: 450, y: 350 },
        dimensions: { width: 140, height: 48 },
        pinned: false,
      },
    };

    const handles = computeSmartEdgeHandles(semantic, nodes, 'TB');

    // Sim: sai por baixo, entra por cima
    expect(handles['r-sim']).toEqual({ sourceHandle: 'bottom', targetHandle: 'top' });

    // Não: sai pela direita, entra por cima (dy > 30)
    expect(handles['r-nao']).toEqual({ sourceHandle: 'right', targetHandle: 'top' });

    // Retorno: sai pela lateral e entra por lateral/topo
    expect(['left', 'right']).toContain(handles['r-loop']?.sourceHandle);
    expect(['right', 'left', 'top']).toContain(handles['r-loop']?.targetHandle);
  });

  it('direciona laço de repetição ascendente de processo (dy < -20) para sair pela lateral em vez de cruzar verticalmente o nó', () => {
    const semantic: SemanticModel = {
      diagramMode: 'flowchart',
      title: 'Loop em Processo',
      concepts: {
        'proc-1': {
          id: 'proc-1',
          label: 'Etapa 1',
          normalizedKey: 'etapa 1',
          nodeShape: 'process',
        },
        'proc-2': {
          id: 'proc-2',
          label: 'Etapa 2',
          normalizedKey: 'etapa 2',
          nodeShape: 'process',
        },
      },
      conceptOrder: ['proc-1', 'proc-2'],
      relations: {
        'rel-loop': {
          id: 'rel-loop',
          orderIndex: 1,
          sourceId: 'proc-2',
          targetId: 'proc-1',
          linkingPhrase: 'Refazer',
          type: 'loop-back',
        },
      },
      relationOrder: ['rel-loop'],
    };

    const nodes: Record<string, ConceptNodeVisual> = {
      'proc-1': {
        conceptId: 'proc-1',
        position: { x: 200, y: 100 },
        dimensions: { width: 140, height: 48 },
        pinned: false,
      },
      'proc-2': {
        conceptId: 'proc-2',
        position: { x: 200, y: 300 },
        dimensions: { width: 140, height: 48 },
        pinned: false,
      },
    };

    const handles = computeSmartEdgeHandles(semantic, nodes, 'TB');
    expect(['left', 'right']).toContain(handles['rel-loop']?.sourceHandle);
  });
});

describe('Flowchart Auto-Layout (exemplo-fluxograma.md) (Milestone 2)', () => {
  const rawFlowchartMarkdown = fs.readFileSync(flowchartPath, 'utf-8');
  const parsedFlowchart = parseConceptMapMarkdown(rawFlowchartMarkdown);

  const algorithms: LayoutAlgorithmType[] = ['dagre-hierarchical', 'elk-layered'];

  it.each(algorithms)(
    'calcula coordenadas válidas, sem sobreposição e atribui formas em %s',
    async (algorithm) => {
      const result = await computeConceptMapLayout(
        parsedFlowchart.semantic,
        undefined,
        {
          algorithm,
          direction: 'TB',
        }
      );

      const nodeIds = Object.keys(result.nodes);
      expect(nodeIds.length).toBeGreaterThanOrEqual(14);

      // Valida coordenadas e dimensões
      for (const id of nodeIds) {
        const node = result.nodes[id];
        expect(Number.isFinite(node.position.x)).toBe(true);
        expect(Number.isFinite(node.position.y)).toBe(true);
        expect(node.dimensions?.width).toBeGreaterThan(80);
        expect(node.dimensions?.height).toBeGreaterThan(36);
        expect(node.nodeShape).toBeDefined();
      }

      // Valida ausência de colisão AABB
      for (let i = 0; i < nodeIds.length; i++) {
        for (let j = i + 1; j < nodeIds.length; j++) {
          const a = result.nodes[nodeIds[i]];
          const b = result.nodes[nodeIds[j]];

          const aLeft = a.position.x;
          const aRight = a.position.x + (a.dimensions?.width ?? 180);
          const aTop = a.position.y;
          const aBottom = a.position.y + (a.dimensions?.height ?? 50);

          const bLeft = b.position.x;
          const bRight = b.position.x + (b.dimensions?.width ?? 180);
          const bTop = b.position.y;
          const bBottom = b.position.y + (b.dimensions?.height ?? 50);

          const intersects =
            aLeft < bRight - 1 &&
            aRight > bLeft + 1 &&
            aTop < bBottom - 1 &&
            aBottom > bTop + 1;

          expect(intersects).toBe(false);
        }
      }

      // Valida que Início fica posicionado acima de Fim (direção de fluxo top-to-bottom)
      const startNode = Object.values(result.nodes).find((n) =>
        n.conceptId.includes('abertura-de-pull-request')
      );
      const endNode = Object.values(result.nodes).find((n) =>
        n.conceptId.includes('deploy-realizado-com-sucesso')
      );
      expect(startNode).toBeDefined();
      expect(endNode).toBeDefined();
      expect(startNode!.position.y).toBeLessThan(endNode!.position.y);

      // Todas as arestas em fluxograma assumem curva smoothstep (ortogonal)
      const edgeIds = Object.keys(result.edges);
      expect(edgeIds.length).toBeGreaterThanOrEqual(17);
      for (const edgeId of edgeIds) {
        expect(result.edges[edgeId].curveType).toBe('smoothstep');
      }
    }
  );

  it('preserva retrocompatibilidade de curvas para Novak Concept Map (exemplo.md)', async () => {
    const rawNovak = fs.readFileSync(exemploPath, 'utf-8');
    const parsedNovak = parseConceptMapMarkdown(rawNovak);

    const result = await computeConceptMapLayout(parsedNovak.semantic, undefined, {
      algorithm: 'novak-backbone',
      direction: 'TB',
    });

    const edgeIds = Object.keys(result.edges);
    expect(edgeIds).toHaveLength(46);

    let hierarchicalSmoothstepCount = 0;
    let crossLinkBezierCount = 0;

    for (const relId of edgeIds) {
      const rel = parsedNovak.semantic.relations[relId];
      const edge = result.edges[relId];
      if (rel.type === 'hierarchical') {
        expect(edge.curveType).toBe('smoothstep');
        hierarchicalSmoothstepCount++;
      } else if (rel.type === 'cross-link') {
        expect(edge.curveType).toBe('bezier');
        crossLinkBezierCount++;
      }
    }

    expect(hierarchicalSmoothstepCount).toBe(31);
    expect(crossLinkBezierCount).toBe(15);
  });
});

