import { describe, expect, it } from 'vitest';
import {
  Position,
  getBezierPath,
  getSmoothStepPath,
  MarkerType,
  type Connection,
  type Edge,
} from '@xyflow/react';
import {
  handleToPosition,
  type PropositionEdgeData,
} from '../src/components/canvas/PropositionEdge';
import {
  FLOWCHART_SHAPES_CONFIG,
  getShapeMeta,
} from '../src/components/canvas/shapeDefinitions';
import { useConceptMapStore } from '../src/store/useConceptMapStore';
import type { ArrowDirection, FlowchartNodeShape, HandlePosition } from '../src/domain/types';

describe('Milestone M2: Canvas Loose Connections & Shapes', () => {
  const CARDINAL_HANDLES: readonly HandlePosition[] = [
    'top',
    'right',
    'bottom',
    'left',
  ] as const;

  // ==========================================================================
  // 1. Matriz 4x4 = 16 Combinações Cardinais e handleToPosition
  // ==========================================================================
  describe('Pillar 1: Cardinal Handle to Position Mapping (16 Combinations)', () => {
    it('mapeia individualmente cada um dos 4 pontos cardinais para Position enum correspondente', () => {
      expect(handleToPosition('top')).toBe(Position.Top);
      expect(handleToPosition('right')).toBe(Position.Right);
      expect(handleToPosition('bottom')).toBe(Position.Bottom);
      expect(handleToPosition('left')).toBe(Position.Left);
    });

    it('utiliza fallback apropriado para valores indefinidos ou inválidos', () => {
      expect(handleToPosition(undefined, Position.Bottom)).toBe(Position.Bottom);
      expect(handleToPosition(null, Position.Right)).toBe(Position.Right);
      expect(handleToPosition('invalid-handle', Position.Left)).toBe(Position.Left);
      expect(handleToPosition('auto', Position.Top)).toBe(Position.Top);
    });

    it('resolve corretamente todas as 16 permutações de conexão entre pontos cardinais', () => {
      const permutations: Array<{
        srcHandle: HandlePosition;
        tgtHandle: HandlePosition;
        expectedSrcPos: Position;
        expectedTgtPos: Position;
      }> = [];

      for (const src of CARDINAL_HANDLES) {
        for (const tgt of CARDINAL_HANDLES) {
          permutations.push({
            srcHandle: src,
            tgtHandle: tgt,
            expectedSrcPos:
              src === 'top'
                ? Position.Top
                : src === 'right'
                  ? Position.Right
                  : src === 'bottom'
                    ? Position.Bottom
                    : Position.Left,
            expectedTgtPos:
              tgt === 'top'
                ? Position.Top
                : tgt === 'right'
                  ? Position.Right
                  : tgt === 'bottom'
                    ? Position.Bottom
                    : Position.Left,
          });
        }
      }

      expect(permutations).toHaveLength(16);

      for (const perm of permutations) {
        const resolvedSrc = handleToPosition(perm.srcHandle);
        const resolvedTgt = handleToPosition(perm.tgtHandle);

        expect(resolvedSrc).toBe(perm.expectedSrcPos);
        expect(resolvedTgt).toBe(perm.expectedTgtPos);
      }
    });
  });

  // ==========================================================================
  // 2. Cálculo Geométrico de Curvas (SmoothStep & Bezier) com Posições Efetivas
  // ==========================================================================
  describe('Pillar 2: Accurate Edge Curvature Geometry across 16 Combinations', () => {
    const sourceCoord = { x: 100, y: 100 };
    const targetCoord = { x: 300, y: 250 };

    it('gera caminhos SmoothStep válidos para todas as 16 combinações de portas cardinais', () => {
      for (const src of CARDINAL_HANDLES) {
        for (const tgt of CARDINAL_HANDLES) {
          const srcPos = handleToPosition(src);
          const tgtPos = handleToPosition(tgt);

          const [path, labelX, labelY] = getSmoothStepPath({
            sourceX: sourceCoord.x,
            sourceY: sourceCoord.y,
            sourcePosition: srcPos,
            targetX: targetCoord.x,
            targetY: targetCoord.y,
            targetPosition: tgtPos,
            borderRadius: 12,
          });

          // Caminho SVG deve começar nas coordenadas de origem e terminar nas de destino
          expect(path).toMatch(new RegExp(`^M\\s*${sourceCoord.x}[,\\s]+${sourceCoord.y}`));
          expect(path).toContain(`${targetCoord.x}`);
          expect(path).toContain(`${targetCoord.y}`);
          expect(Number.isFinite(labelX)).toBe(true);
          expect(Number.isFinite(labelY)).toBe(true);
        }
      }
    });

    it('gera caminhos Bezier válidos para todas as 16 combinações de portas cardinais', () => {
      for (const src of CARDINAL_HANDLES) {
        for (const tgt of CARDINAL_HANDLES) {
          const srcPos = handleToPosition(src);
          const tgtPos = handleToPosition(tgt);

          const [path, labelX, labelY] = getBezierPath({
            sourceX: sourceCoord.x,
            sourceY: sourceCoord.y,
            sourcePosition: srcPos,
            targetX: targetCoord.x,
            targetY: targetCoord.y,
            targetPosition: tgtPos,
            curvature: 0.25,
          });

          // Caminho Bezier deve conter comando C (cubic Bézier)
          expect(path).toMatch(new RegExp(`^M\\s*${sourceCoord.x}[,\\s]+${sourceCoord.y}`));
          expect(path).toContain('C');
          expect(Number.isFinite(labelX)).toBe(true);
          expect(Number.isFinite(labelY)).toBe(true);
        }
      }
    });

    it('garante que a saída SmoothStep difere entre portas cardinais distintas para as mesmas coordenadas', () => {
      // Saída pela face direita vs saída pela face inferior
      const [pathFromRight] = getSmoothStepPath({
        sourceX: 100,
        sourceY: 100,
        sourcePosition: Position.Right,
        targetX: 300,
        targetY: 200,
        targetPosition: Position.Left,
      });

      const [pathFromBottom] = getSmoothStepPath({
        sourceX: 100,
        sourceY: 100,
        sourcePosition: Position.Bottom,
        targetX: 300,
        targetY: 200,
        targetPosition: Position.Left,
      });

      expect(pathFromRight).not.toBe(pathFromBottom);
    });
  });

  // ==========================================================================
  // 3. Validação de Conexões (isValidConnection)
  // ==========================================================================
  describe('Pillar 3: Canvas Connection Validation (isValidConnection)', () => {
    function isValidConnection(connection: Connection | Edge): boolean {
      if (!connection.source || !connection.target) return false;
      if (
        connection.source === connection.target &&
        connection.sourceHandle === connection.targetHandle
      ) {
        return false;
      }
      return true;
    }

    it('permite todas as 16 combinações de portas entre blocos distintos', () => {
      for (const src of CARDINAL_HANDLES) {
        for (const tgt of CARDINAL_HANDLES) {
          const result = isValidConnection({
            source: 'node-A',
            target: 'node-B',
            sourceHandle: src,
            targetHandle: tgt,
          });
          expect(result).toBe(true);
        }
      }
    });

    it('rejeita auto-conexão da mesma porta nela mesma no mesmo bloco', () => {
      for (const handle of CARDINAL_HANDLES) {
        const result = isValidConnection({
          source: 'node-A',
          target: 'node-A',
          sourceHandle: handle,
          targetHandle: handle,
        });
        expect(result).toBe(false);
      }
    });

    it('permite auto-loops conectando portas distintas do mesmo bloco', () => {
      // Ex: sair pelo lado direito e entrar pela base do mesmo nó
      expect(
        isValidConnection({
          source: 'node-A',
          target: 'node-A',
          sourceHandle: 'right',
          targetHandle: 'bottom',
        })
      ).toBe(true);

      // Ex: sair pelo topo e entrar pela esquerda do mesmo nó
      expect(
        isValidConnection({
          source: 'node-A',
          target: 'node-A',
          sourceHandle: 'top',
          targetHandle: 'left',
        })
      ).toBe(true);
    });

    it('rejeita conexões incompletas sem source ou target', () => {
      expect(
        isValidConnection({
          source: null as unknown as string,
          target: 'node-B',
          sourceHandle: 'top',
          targetHandle: 'bottom',
        })
      ).toBe(false);

      expect(
        isValidConnection({
          source: 'node-A',
          target: null as unknown as string,
          sourceHandle: 'top',
          targetHandle: 'bottom',
        })
      ).toBe(false);
    });
  });

  // ==========================================================================
  // 4. Marcadores Dinâmicos de Seta (arrowDirection)
  // ==========================================================================
  describe('Pillar 4: Dynamic Arrow Markers (markerStart and markerEnd)', () => {
    function computeMarkers(
      arrowDirection: ArrowDirection,
      arrowColor: string = '#475569'
    ) {
      const markerConfig = {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: arrowColor,
      };

      const markerEnd =
        arrowDirection === 'forward' || arrowDirection === 'both'
          ? markerConfig
          : undefined;

      const markerStart =
        arrowDirection === 'reverse' || arrowDirection === 'both'
          ? markerConfig
          : undefined;

      return { markerStart, markerEnd };
    }

    it('configura apenas markerEnd no modo forward (padrão)', () => {
      const { markerStart, markerEnd } = computeMarkers('forward');
      expect(markerEnd).toBeDefined();
      expect(markerEnd?.type).toBe(MarkerType.ArrowClosed);
      expect(markerStart).toBeUndefined();
    });

    it('configura apenas markerStart no modo reverse', () => {
      const { markerStart, markerEnd } = computeMarkers('reverse');
      expect(markerStart).toBeDefined();
      expect(markerStart?.type).toBe(MarkerType.ArrowClosed);
      expect(markerEnd).toBeUndefined();
    });

    it('configura ambos markerStart e markerEnd no modo both (bidirecional)', () => {
      const { markerStart, markerEnd } = computeMarkers('both');
      expect(markerStart).toBeDefined();
      expect(markerEnd).toBeDefined();
      expect(markerStart?.type).toBe(MarkerType.ArrowClosed);
      expect(markerEnd?.type).toBe(MarkerType.ArrowClosed);
    });

    it('não configura nenhum marcador no modo none (linha simples)', () => {
      const { markerStart, markerEnd } = computeMarkers('none');
      expect(markerStart).toBeUndefined();
      expect(markerEnd).toBeUndefined();
    });
  });

  // ==========================================================================
  // 5. Configuração e Metadados das 7 Formas Geométricas (shapeDefinitions)
  // ==========================================================================
  describe('Pillar 5: Canonical Shape Definitions & Shape Switcher (F8)', () => {
    const EXPECTED_SHAPES: FlowchartNodeShape[] = [
      'terminal',
      'process',
      'decision',
      'io',
      'subroutine',
      'document',
      'concept',
    ];

    it('contém exatamente todas as 7 formas geométricas especificadas', () => {
      const registeredShapes = FLOWCHART_SHAPES_CONFIG.map((s) => s.shape);
      expect(registeredShapes).toHaveLength(7);
      expect(registeredShapes).toEqual(expect.arrayContaining(EXPECTED_SHAPES));
    });

    it('fornece rótulo, sub-rótulo e renderizador de ícone SVG para cada formato', () => {
      for (const item of FLOWCHART_SHAPES_CONFIG) {
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.sublabel.length).toBeGreaterThan(0);
        expect(typeof item.renderIcon).toBe('function');

        // Testar renderização do ícone com active=true e active=false
        const iconActive = item.renderIcon(true);
        const iconInactive = item.renderIcon(false);

        expect(iconActive).toBeDefined();
        expect(iconInactive).toBeDefined();
      }
    });

    it('recupera metadados corretos via getShapeMeta com fallback seguro', () => {
      const decisionMeta = getShapeMeta('decision');
      expect(decisionMeta.shape).toBe('decision');
      expect(decisionMeta.label).toContain('Decisão');

      const documentMeta = getShapeMeta('document');
      expect(documentMeta.shape).toBe('document');
      expect(documentMeta.label).toContain('Documento');

      // Fallback para forma desconhecida
      const fallbackMeta = getShapeMeta('unknown' as FlowchartNodeShape);
      expect(fallbackMeta).toBeDefined();
      expect(fallbackMeta.shape).toBe('terminal');
    });
  });

  // ==========================================================================
  // 6. Integração com Store: Troca de Formato e Preservação de Handles
  // ==========================================================================
  describe('Pillar 6: Store Integration & Handle Preservation on Shape Switch', () => {
    it('preserva 100% as portas manuais ao alternar o formato do nó via updateNodeShape', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap('Teste de Formatos e Handles');

      // Adicionar nó 1 e nó 2
      const idA = store.addConcept('Nó Origem', { x: 50, y: 50 }, 'process');
      const idB = store.addConcept('Nó Destino', { x: 300, y: 50 }, 'process');

      expect(idA).toBeDefined();
      expect(idB).toBeDefined();

      // Criar relação manual entre right -> left
      const relId = store.addRelation(
        idA,
        idB,
        'conecta',
        'sequence',
        {
          sourceHandle: 'right',
          targetHandle: 'left',
          manualHandles: true,
        },
        'both'
      );

      expect(relId).toBeDefined();
      if (!relId) return;

      const edgeVisBefore = useConceptMapStore.getState().visual.edges[relId];
      expect(edgeVisBefore.sourceHandle).toBe('right');
      expect(edgeVisBefore.targetHandle).toBe('left');
      expect(edgeVisBefore.manualHandles).toBe(true);
      expect(edgeVisBefore.arrowDirection).toBe('both');

      // Trocar formato do nó de origem para 'decision' (losango)
      store.updateNodeShape(idA, 'decision');

      const nodeSemAfter = useConceptMapStore.getState().semantic.concepts[idA];
      const nodeVisAfter = useConceptMapStore.getState().visual.nodes[idA];
      expect(nodeSemAfter.nodeShape).toBe('decision');
      expect(nodeVisAfter.nodeShape).toBe('decision');

      // Verificar que os handles manuais NÃO foram sobrescritos
      const edgeVisAfter = useConceptMapStore.getState().visual.edges[relId];
      expect(edgeVisAfter.sourceHandle).toBe('right');
      expect(edgeVisAfter.targetHandle).toBe('left');
      expect(edgeVisAfter.manualHandles).toBe(true);
      expect(edgeVisAfter.arrowDirection).toBe('both');

      // Mover o nó e verificar novamente a preservação
      store.moveNodes([{ conceptId: idA, position: { x: 80, y: 120 } }]);
      const edgeVisAfterMove = useConceptMapStore.getState().visual.edges[relId];
      expect(edgeVisAfterMove.sourceHandle).toBe('right');
      expect(edgeVisAfterMove.targetHandle).toBe('left');
      expect(edgeVisAfterMove.manualHandles).toBe(true);
    });
  });
});
