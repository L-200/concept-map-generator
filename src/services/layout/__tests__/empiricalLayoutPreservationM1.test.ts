import { describe, expect, it } from 'vitest';
import type {
  ArrowDirection,
  HandlePosition,
  LayoutAlgorithmType,
  SemanticModel,
  VisualModel,
} from '../../../domain/types';
import {
  computeConceptMapLayout,
  DEFAULT_LAYOUT_SETTINGS,
} from '../layoutEngine';

// ============================================================================
// HELPERS TO CONSTRUCT TEST FIXTURES
// ============================================================================

const ALL_ALGORITHMS: LayoutAlgorithmType[] = [
  'novak-backbone',
  'dagre-hierarchical',
  'force-directed',
  'radial-tree',
  'elk-layered',
];

const CARDINAL_HANDLES: HandlePosition[] = ['top', 'right', 'bottom', 'left'];

const ALL_ARROW_DIRECTIONS: ArrowDirection[] = ['forward', 'reverse', 'both', 'none'];

function createBasicSemantic(options?: {
  nodeCount?: number;
  relations?: Array<{
    id: string;
    sourceId: string;
    targetId: string;
    linkingPhrase?: string;
    manualHandles?: boolean;
    arrowDirection?: ArrowDirection;
  }>;
  diagramMode?: 'concept-map' | 'flowchart';
}): SemanticModel {
  const count = options?.nodeCount ?? 4;
  const diagramMode = options?.diagramMode ?? 'flowchart';
  const concepts: SemanticModel['concepts'] = {};
  const conceptOrder: string[] = [];

  for (let i = 1; i <= count; i++) {
    const id = `node-${i}`;
    conceptOrder.push(id);
    concepts[id] = {
      id,
      label: `Node ${i}`,
      normalizedKey: `node ${i}`,
      nodeShape: i === 2 ? 'decision' : 'process',
    };
  }

  const relations: SemanticModel['relations'] = {};
  const relationOrder: string[] = [];

  if (options?.relations) {
    options.relations.forEach((rel, index) => {
      relationOrder.push(rel.id);
      relations[rel.id] = {
        id: rel.id,
        orderIndex: index + 1,
        sourceId: rel.sourceId,
        targetId: rel.targetId,
        linkingPhrase: rel.linkingPhrase ?? `connects ${index + 1}`,
        type: 'sequence',
        manualHandles: rel.manualHandles,
        arrowDirection: rel.arrowDirection,
      };
    });
  } else {
    // Default linear chain: 1 -> 2 -> 3 -> 4
    for (let i = 1; i < count; i++) {
      const relId = `rel-${i}-${i + 1}`;
      relationOrder.push(relId);
      relations[relId] = {
        id: relId,
        orderIndex: i,
        sourceId: `node-${i}`,
        targetId: `node-${i + 1}`,
        linkingPhrase: `leads to`,
        type: diagramMode === 'flowchart' ? 'sequence' : 'hierarchical',
      };
    }
  }

  return {
    title: 'M1 Layout Preservation Test Diagram',
    diagramMode,
    concepts,
    conceptOrder,
    relations,
    relationOrder,
  };
}

// ============================================================================
// EMPIRICAL CHALLENGE SUITE
// ============================================================================

describe('Empirical Challenge: Layout Engine Preservation & Boundary Checks (M1)', () => {
  // --------------------------------------------------------------------------
  // CHALLENGE 1: All 5 Layout Algorithms Preserve Manual Handles
  // --------------------------------------------------------------------------
  describe('Challenge 1: Manual edge locking across all layout algorithms', () => {
    it.each(ALL_ALGORITHMS)(
      'preserves manual handles strictly under %s algorithm',
      async (algorithm) => {
        const semantic = createBasicSemantic({ nodeCount: 3 });
        const relId = semantic.relationOrder[0]; // node-1 -> node-2

        const existingVisual: VisualModel = {
          nodes: {},
          edges: {
            [relId]: {
              relationId: relId,
              curveType: 'bezier',
              sourceHandle: 'left',
              targetHandle: 'right',
              manualHandles: true,
              arrowDirection: 'both',
            },
          },
          viewport: { x: 0, y: 0, zoom: 1 },
          layoutSettings: { ...DEFAULT_LAYOUT_SETTINGS, algorithm },
          crossLinkVisibility: 'all',
        };

        const result = await computeConceptMapLayout(semantic, existingVisual, {
          algorithm,
          direction: 'TB',
        });

        const edge = result.edges[relId];
        expect(edge).toBeDefined();
        // Even though auto-layout might position node-1 above node-2 (which would smart-assign bottom->top),
        // manualHandles: true must keep left->right strictly locked
        expect(edge.sourceHandle).toBe('left');
        expect(edge.targetHandle).toBe('right');
        expect(edge.manualHandles).toBe(true);
        expect(edge.arrowDirection).toBe('both');
      }
    );
  });

  // --------------------------------------------------------------------------
  // CHALLENGE 2: Mixed Edge Sets (Manual vs Automatic)
  // --------------------------------------------------------------------------
  describe('Challenge 2: Mixed manual and automatic edges in the same diagram', () => {
    it.each(ALL_ALGORITHMS)(
      'locks manual edge while recalculating smart handles for automatic edge under %s',
      async (algorithm) => {
        const semantic = createBasicSemantic({
          nodeCount: 4,
          relations: [
            { id: 'rel-manual', sourceId: 'node-1', targetId: 'node-2' },
            { id: 'rel-auto', sourceId: 'node-2', targetId: 'node-3' },
            { id: 'rel-fresh', sourceId: 'node-3', targetId: 'node-4' },
          ],
        });

        const existingVisual: VisualModel = {
          nodes: {},
          edges: {
            'rel-manual': {
              relationId: 'rel-manual',
              curveType: 'straight',
              sourceHandle: 'top',
              targetHandle: 'bottom',
              manualHandles: true,
              arrowDirection: 'reverse',
            },
            'rel-auto': {
              relationId: 'rel-auto',
              curveType: 'smoothstep',
              sourceHandle: 'left', // will be overwritten because manualHandles is false
              targetHandle: 'right',
              manualHandles: false,
              arrowDirection: 'forward',
            },
            // 'rel-fresh' has no entry in existingVisual.edges
          },
          viewport: { x: 0, y: 0, zoom: 1 },
          layoutSettings: { ...DEFAULT_LAYOUT_SETTINGS, algorithm },
          crossLinkVisibility: 'all',
        };

        const result = await computeConceptMapLayout(semantic, existingVisual, {
          algorithm,
          direction: 'TB',
        });

        const manualEdge = result.edges['rel-manual'];
        expect(manualEdge).toBeDefined();
        expect(manualEdge.sourceHandle).toBe('top');
        expect(manualEdge.targetHandle).toBe('bottom');
        expect(manualEdge.manualHandles).toBe(true);
        expect(manualEdge.arrowDirection).toBe('reverse');

        const autoEdge = result.edges['rel-auto'];
        expect(autoEdge).toBeDefined();
        // Since node-2 is a decision and node-3 is below it in TB layout, smart handles will compute
        // either bottom->top or a valid cardinal handle, definitely not locked to left->right
        expect(CARDINAL_HANDLES).toContain(autoEdge.sourceHandle);
        expect(CARDINAL_HANDLES).toContain(autoEdge.targetHandle);
        expect(autoEdge.manualHandles).toBe(false);

        const freshEdge = result.edges['rel-fresh'];
        expect(freshEdge).toBeDefined();
        expect(CARDINAL_HANDLES).toContain(freshEdge.sourceHandle);
        expect(CARDINAL_HANDLES).toContain(freshEdge.targetHandle);
      }
    );
  });

  // --------------------------------------------------------------------------
  // CHALLENGE 3: All 16 Cardinal Combinations ($4 \times 4$) Preserved
  // --------------------------------------------------------------------------
  describe('Challenge 3: Full 16-combination Cartesian product of cardinal ports', () => {
    const combinations: Array<[HandlePosition, HandlePosition]> = [];
    for (const src of CARDINAL_HANDLES) {
      for (const tgt of CARDINAL_HANDLES) {
        combinations.push([src, tgt]);
      }
    }

    it.each(combinations)(
      'strictly preserves port combination %s -> %s through layout computation',
      async (sourceHandle, targetHandle) => {
        const semantic = createBasicSemantic({ nodeCount: 2 });
        const relId = semantic.relationOrder[0];

        const existingVisual: VisualModel = {
          nodes: {},
          edges: {
            [relId]: {
              relationId: relId,
              curveType: 'smoothstep',
              sourceHandle,
              targetHandle,
              manualHandles: true,
              arrowDirection: 'forward',
            },
          },
          viewport: { x: 0, y: 0, zoom: 1 },
          layoutSettings: DEFAULT_LAYOUT_SETTINGS,
          crossLinkVisibility: 'all',
        };

        const result = await computeConceptMapLayout(semantic, existingVisual, {
          algorithm: 'dagre-hierarchical',
          direction: 'TB',
        });

        const edge = result.edges[relId];
        expect(edge.sourceHandle).toBe(sourceHandle);
        expect(edge.targetHandle).toBe(targetHandle);
        expect(edge.manualHandles).toBe(true);
      }
    );
  });

  // --------------------------------------------------------------------------
  // CHALLENGE 4: Multi-Edges between identical nodes
  // --------------------------------------------------------------------------
  describe('Challenge 4: Multiple parallel edges between the same two nodes', () => {
    it('maintains distinct manual handle pairings on parallel edges between node-1 and node-2', async () => {
      const semantic = createBasicSemantic({
        nodeCount: 2,
        relations: [
          { id: 'rel-top', sourceId: 'node-1', targetId: 'node-2', linkingPhrase: 'caminho 1' },
          { id: 'rel-side', sourceId: 'node-1', targetId: 'node-2', linkingPhrase: 'caminho 2' },
          { id: 'rel-bottom', sourceId: 'node-1', targetId: 'node-2', linkingPhrase: 'caminho 3' },
        ],
      });

      const existingVisual: VisualModel = {
        nodes: {},
        edges: {
          'rel-top': {
            relationId: 'rel-top',
            curveType: 'bezier',
            sourceHandle: 'top',
            targetHandle: 'top',
            manualHandles: true,
            arrowDirection: 'forward',
          },
          'rel-side': {
            relationId: 'rel-side',
            curveType: 'smoothstep',
            sourceHandle: 'right',
            targetHandle: 'left',
            manualHandles: true,
            arrowDirection: 'reverse',
          },
          'rel-bottom': {
            relationId: 'rel-bottom',
            curveType: 'smoothstep',
            sourceHandle: 'bottom',
            targetHandle: 'bottom',
            manualHandles: true,
            arrowDirection: 'both',
          },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
        layoutSettings: DEFAULT_LAYOUT_SETTINGS,
        crossLinkVisibility: 'all',
      };

      const result = await computeConceptMapLayout(semantic, existingVisual, {
        algorithm: 'novak-backbone',
      });

      expect(result.edges['rel-top'].sourceHandle).toBe('top');
      expect(result.edges['rel-top'].targetHandle).toBe('top');
      expect(result.edges['rel-top'].arrowDirection).toBe('forward');

      expect(result.edges['rel-side'].sourceHandle).toBe('right');
      expect(result.edges['rel-side'].targetHandle).toBe('left');
      expect(result.edges['rel-side'].arrowDirection).toBe('reverse');

      expect(result.edges['rel-bottom'].sourceHandle).toBe('bottom');
      expect(result.edges['rel-bottom'].targetHandle).toBe('bottom');
      expect(result.edges['rel-bottom'].arrowDirection).toBe('both');
    });
  });

  // --------------------------------------------------------------------------
  // CHALLENGE 5: freeformCanvas Flag Semantics
  // --------------------------------------------------------------------------
  describe('Challenge 5: freeformCanvas behavior in layout computation', () => {
    it('preserves existing handles when freeformCanvas is enabled even if manualHandles is undefined', async () => {
      const semantic = createBasicSemantic({ nodeCount: 3 });
      const relId = semantic.relationOrder[0];

      const existingVisual: VisualModel = {
        nodes: {},
        edges: {
          [relId]: {
            relationId: relId,
            curveType: 'bezier',
            sourceHandle: 'left',
            targetHandle: 'bottom',
            // manualHandles is undefined!
          },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
        layoutSettings: {
          ...DEFAULT_LAYOUT_SETTINGS,
          freeformCanvas: true,
        },
        crossLinkVisibility: 'all',
      };

      const result = await computeConceptMapLayout(semantic, existingVisual, {
        freeformCanvas: true,
        algorithm: 'dagre-hierarchical',
      });

      const edge = result.edges[relId];
      expect(edge.sourceHandle).toBe('left');
      expect(edge.targetHandle).toBe('bottom');
      expect(edge.manualHandles).toBe(true);
    });

    it('recalculates smart handles when freeformCanvas is disabled and manualHandles is undefined/false', async () => {
      const semantic = createBasicSemantic({ nodeCount: 3, diagramMode: 'concept-map' });
      const relId = semantic.relationOrder[0];

      const existingVisual: VisualModel = {
        nodes: {},
        edges: {
          [relId]: {
            relationId: relId,
            curveType: 'bezier',
            sourceHandle: 'left',
            targetHandle: 'bottom',
            manualHandles: false,
          },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
        layoutSettings: {
          ...DEFAULT_LAYOUT_SETTINGS,
          freeformCanvas: false,
        },
        crossLinkVisibility: 'all',
      };

      const result = await computeConceptMapLayout(semantic, existingVisual, {
        freeformCanvas: false,
        algorithm: 'novak-backbone',
        direction: 'TB',
      });

      const edge = result.edges[relId];
      // Novak hierarchical top-to-bottom layout assigns bottom -> top
      expect(edge.sourceHandle).toBe('bottom');
      expect(edge.targetHandle).toBe('top');
      expect(edge.manualHandles).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // CHALLENGE 6: ArrowDirection Preservation & Fallback
  // --------------------------------------------------------------------------
  describe('Challenge 6: ArrowDirection propagation and defaults', () => {
    it.each(ALL_ARROW_DIRECTIONS)(
      'preserves visual arrowDirection "%s" across layout computation',
      async (direction) => {
        const semantic = createBasicSemantic({ nodeCount: 2 });
        const relId = semantic.relationOrder[0];

        const existingVisual: VisualModel = {
          nodes: {},
          edges: {
            [relId]: {
              relationId: relId,
              curveType: 'smoothstep',
              sourceHandle: 'right',
              targetHandle: 'left',
              manualHandles: true,
              arrowDirection: direction,
            },
          },
          viewport: { x: 0, y: 0, zoom: 1 },
          layoutSettings: DEFAULT_LAYOUT_SETTINGS,
          crossLinkVisibility: 'all',
        };

        const result = await computeConceptMapLayout(semantic, existingVisual);
        expect(result.edges[relId].arrowDirection).toBe(direction);
      }
    );

    it('falls back to semantic arrowDirection when visual is absent', async () => {
      const semantic = createBasicSemantic({
        nodeCount: 2,
        relations: [
          {
            id: 'rel-semantic-dir',
            sourceId: 'node-1',
            targetId: 'node-2',
            arrowDirection: 'reverse',
          },
        ],
      });

      const result = await computeConceptMapLayout(semantic, undefined);
      expect(result.edges['rel-semantic-dir'].arrowDirection).toBe('reverse');
    });

    it('defaults to "forward" when neither visual nor semantic arrowDirection is set', async () => {
      const semantic = createBasicSemantic({ nodeCount: 2 });
      const relId = semantic.relationOrder[0];

      const result = await computeConceptMapLayout(semantic, undefined);
      expect(result.edges[relId].arrowDirection).toBe('forward');
    });
  });

  // --------------------------------------------------------------------------
  // CHALLENGE 7: Edge Cases (Self-loops, Isolated Nodes, Empty Graph)
  // --------------------------------------------------------------------------
  describe('Challenge 7: Boundary conditions (self-loops, isolated, empty)', () => {
    it('handles self-loops with manual handles without infinite loops or errors', async () => {
      const semantic = createBasicSemantic({
        nodeCount: 1,
        relations: [
          {
            id: 'rel-loop',
            sourceId: 'node-1',
            targetId: 'node-1',
            linkingPhrase: 'recurse',
          },
        ],
      });

      const existingVisual: VisualModel = {
        nodes: {},
        edges: {
          'rel-loop': {
            relationId: 'rel-loop',
            curveType: 'bezier',
            sourceHandle: 'right',
            targetHandle: 'bottom',
            manualHandles: true,
            arrowDirection: 'forward',
          },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
        layoutSettings: DEFAULT_LAYOUT_SETTINGS,
        crossLinkVisibility: 'all',
      };

      const result = await computeConceptMapLayout(semantic, existingVisual);
      expect(result.edges['rel-loop'].sourceHandle).toBe('right');
      expect(result.edges['rel-loop'].targetHandle).toBe('bottom');
      expect(result.edges['rel-loop'].manualHandles).toBe(true);
    });

    it('handles completely empty graph gracefully', async () => {
      const emptySemantic: SemanticModel = {
        title: 'Empty Map',
        diagramMode: 'flowchart',
        concepts: {},
        conceptOrder: [],
        relations: {},
        relationOrder: [],
      };

      const result = await computeConceptMapLayout(emptySemantic, undefined);
      expect(result.nodes).toEqual({});
      expect(result.edges).toEqual({});
    });
  });

  // --------------------------------------------------------------------------
  // CHALLENGE 8: Semi-manual handles (one auto, one explicit)
  // --------------------------------------------------------------------------
  describe('Challenge 8: Semi-manual edge configuration', () => {
    it('computes smart handle for "auto" port while locking the explicitly chosen port', async () => {
      const semantic = createBasicSemantic({ nodeCount: 2 });
      const relId = semantic.relationOrder[0];

      const existingVisual: VisualModel = {
        nodes: {},
        edges: {
          [relId]: {
            relationId: relId,
            curveType: 'smoothstep',
            sourceHandle: 'auto',
            targetHandle: 'left', // explicitly chosen
            manualHandles: true,
          },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
        layoutSettings: DEFAULT_LAYOUT_SETTINGS,
        crossLinkVisibility: 'all',
      };

      const result = await computeConceptMapLayout(semantic, existingVisual, {
        algorithm: 'dagre-hierarchical',
        direction: 'TB',
      });

      const edge = result.edges[relId];
      // Target handle must remain locked to 'left'
      expect(edge.targetHandle).toBe('left');
      // Source handle must have been resolved to a concrete smart handle (not 'auto')
      expect(CARDINAL_HANDLES).toContain(edge.sourceHandle);
      expect(edge.sourceHandle).not.toBe('auto');
    });
  });

  // --------------------------------------------------------------------------
  // CHALLENGE 9: Pinned nodes alongside manual edges
  // --------------------------------------------------------------------------
  describe('Challenge 9: Pinned nodes layout interaction', () => {
    it('preserves pinned positions and manual handles simultaneously', async () => {
      const semantic = createBasicSemantic({ nodeCount: 3 });
      const relId = semantic.relationOrder[0];

      const existingVisual: VisualModel = {
        nodes: {
          'node-1': {
            conceptId: 'node-1',
            position: { x: 555, y: 777 },
            pinned: true,
          },
        },
        edges: {
          [relId]: {
            relationId: relId,
            curveType: 'smoothstep',
            sourceHandle: 'right',
            targetHandle: 'left',
            manualHandles: true,
          },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
        layoutSettings: {
          ...DEFAULT_LAYOUT_SETTINGS,
          respectPinnedNodes: true,
        },
        crossLinkVisibility: 'all',
      };

      const result = await computeConceptMapLayout(semantic, existingVisual, {
        respectPinnedNodes: true,
        algorithm: 'dagre-hierarchical',
      });

      expect(result.nodes['node-1'].position).toEqual({ x: 555, y: 777 });
      expect(result.edges[relId].sourceHandle).toBe('right');
      expect(result.edges[relId].targetHandle).toBe('left');
      expect(result.edges[relId].manualHandles).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // CHALLENGE 10: Inverted geometric positions (Source below Target)
  // --------------------------------------------------------------------------
  describe('Challenge 10: Inverted spatial orientation stress test', () => {
    it('does not flip manual edge even when spatial orientation would trigger loopBack or reverse smart handles', async () => {
      // In this setup, source is placed at y=500 and target is placed at y=100
      const semantic = createBasicSemantic({
        nodeCount: 2,
        relations: [
          {
            id: 'rel-upward-manual',
            sourceId: 'node-1',
            targetId: 'node-2',
            linkingPhrase: 'flows backward',
          },
          {
            id: 'rel-upward-auto',
            sourceId: 'node-1',
            targetId: 'node-2',
            linkingPhrase: 'auto upward',
          },
        ],
      });

      const existingVisual: VisualModel = {
        nodes: {
          'node-1': {
            conceptId: 'node-1',
            position: { x: 200, y: 500 },
            pinned: true,
          },
          'node-2': {
            conceptId: 'node-2',
            position: { x: 200, y: 100 },
            pinned: true,
          },
        },
        edges: {
          'rel-upward-manual': {
            relationId: 'rel-upward-manual',
            curveType: 'smoothstep',
            sourceHandle: 'bottom', // user specifically wants it out the bottom
            targetHandle: 'bottom', // and in the bottom
            manualHandles: true,
          },
          'rel-upward-auto': {
            relationId: 'rel-upward-auto',
            curveType: 'smoothstep',
            sourceHandle: 'bottom',
            targetHandle: 'top',
            manualHandles: false,
          },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
        layoutSettings: {
          ...DEFAULT_LAYOUT_SETTINGS,
          respectPinnedNodes: true,
        },
        crossLinkVisibility: 'all',
      };

      const result = await computeConceptMapLayout(semantic, existingVisual, {
        respectPinnedNodes: true,
        direction: 'TB',
      });

      // Manual edge MUST stay locked at bottom -> bottom
      const manualEdge = result.edges['rel-upward-manual'];
      expect(manualEdge.sourceHandle).toBe('bottom');
      expect(manualEdge.targetHandle).toBe('bottom');
      expect(manualEdge.manualHandles).toBe(true);

      // Auto edge MUST recompute to upward / geometric return handles (not bottom->top)
      const autoEdge = result.edges['rel-upward-auto'];
      expect(CARDINAL_HANDLES).toContain(autoEdge.sourceHandle);
      expect(CARDINAL_HANDLES).toContain(autoEdge.targetHandle);
      // Since dy = 100 - 500 = -400 (< -20), it is a geometric return!
      // In flowchart TB loopback: sourceHandle is right/left, targetHandle is top/right/left
      expect(['right', 'left', 'top']).toContain(autoEdge.sourceHandle);
    });
  });

  // --------------------------------------------------------------------------
  // CHALLENGE 11: FreeformCanvas with explicit manualHandles: false
  // --------------------------------------------------------------------------
  describe('Challenge 11: freeformCanvas overrides manualHandles: false', () => {
    it('preserves existing handles in freeformCanvas mode even when manualHandles is false', async () => {
      const semantic = createBasicSemantic({ nodeCount: 2 });
      const relId = semantic.relationOrder[0];

      const existingVisual: VisualModel = {
        nodes: {},
        edges: {
          [relId]: {
            relationId: relId,
            curveType: 'straight',
            sourceHandle: 'right',
            targetHandle: 'left',
            manualHandles: false, // explicitly false
          },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
        layoutSettings: {
          ...DEFAULT_LAYOUT_SETTINGS,
          freeformCanvas: true,
        },
        crossLinkVisibility: 'all',
      };

      const result = await computeConceptMapLayout(semantic, existingVisual, {
        freeformCanvas: true,
        algorithm: 'novak-backbone',
      });

      const edge = result.edges[relId];
      expect(edge.sourceHandle).toBe('right');
      expect(edge.targetHandle).toBe('left');
    });
  });

  // --------------------------------------------------------------------------
  // CHALLENGE 12: Large scale stress test (50 nodes, 100 edges)
  // --------------------------------------------------------------------------
  describe('Challenge 12: Large-scale stress test (50 nodes, 100 mixed edges)', () => {
    it('processes dense graph preserving all 50 manual edges while computing valid smart handles for 50 auto edges', async () => {
      const nodeCount = 50;
      const edgeCount = 100;
      const relations: Array<{
        id: string;
        sourceId: string;
        targetId: string;
        linkingPhrase: string;
      }> = [];

      for (let i = 0; i < edgeCount; i++) {
        const srcIdx = (i % nodeCount) + 1;
        const tgtIdx = ((i + 3) % nodeCount) + 1;
        relations.push({
          id: `stress-rel-${i}`,
          sourceId: `node-${srcIdx}`,
          targetId: `node-${tgtIdx}`,
          linkingPhrase: `link ${i}`,
        });
      }

      const semantic = createBasicSemantic({
        nodeCount,
        relations,
      });

      const existingVisual: VisualModel = {
        nodes: {},
        edges: {},
        viewport: { x: 0, y: 0, zoom: 1 },
        layoutSettings: DEFAULT_LAYOUT_SETTINGS,
        crossLinkVisibility: 'all',
      };

      // Half the edges are manual, half are automatic
      for (let i = 0; i < edgeCount; i++) {
        const isManual = i % 2 === 0;
        const srcPort = CARDINAL_HANDLES[i % 4];
        const tgtPort = CARDINAL_HANDLES[(i + 1) % 4];
        existingVisual.edges[`stress-rel-${i}`] = {
          relationId: `stress-rel-${i}`,
          curveType: 'smoothstep',
          sourceHandle: srcPort,
          targetHandle: tgtPort,
          manualHandles: isManual,
          arrowDirection: ALL_ARROW_DIRECTIONS[i % 4],
        };
      }

      const startTime = performance.now();
      const result = await computeConceptMapLayout(semantic, existingVisual, {
        algorithm: 'dagre-hierarchical',
        direction: 'TB',
      });
      const duration = performance.now() - startTime;

      // Check performance
      expect(duration).toBeLessThan(5000); // Must complete within 5 seconds

      // Verify all 100 edges
      for (let i = 0; i < edgeCount; i++) {
        const edge = result.edges[`stress-rel-${i}`];
        expect(edge).toBeDefined();

        if (i % 2 === 0) {
          // Manual edge: MUST preserve exact ports and manualHandles flag
          const expectedSrc = CARDINAL_HANDLES[i % 4];
          const expectedTgt = CARDINAL_HANDLES[(i + 1) % 4];
          expect(edge.sourceHandle).toBe(expectedSrc);
          expect(edge.targetHandle).toBe(expectedTgt);
          expect(edge.manualHandles).toBe(true);
        } else {
          // Automatic edge: MUST have valid cardinal handles
          expect(CARDINAL_HANDLES).toContain(edge.sourceHandle);
          expect(CARDINAL_HANDLES).toContain(edge.targetHandle);
          expect(edge.manualHandles).toBe(false);
        }

        // Arrow direction must always be preserved
        expect(edge.arrowDirection).toBe(ALL_ARROW_DIRECTIONS[i % 4]);
      }
    });
  });
});

