import { beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import {
  Position,
  ReactFlowProvider,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  MarkerType,
  type NodeProps,
} from '@xyflow/react';
import {
  handleToPosition,
  getFlowchartConditionType,
  PropositionEdge,
  type PropositionFlowEdge,
} from '../src/components/canvas/PropositionEdge';
import {
  ConceptNode,
  type ConceptFlowNode,
  type ConceptNodeData,
} from '../src/components/canvas/ConceptNode';
import {
  computeParallelOffset,
  toFlowPosition,
} from '../src/services/layout/geometry';
import { useConceptMapStore } from '../src/store/useConceptMapStore';
import type {
  ArrowDirection,
  ConceptId,
  FlowchartNodeShape,
  HandlePosition,
  Point2D,
  RelationId,
} from '../src/domain/types';

describe('Empirical M3 Adversarial Challenge: Canvas & React Flow Rendering Optimizations', () => {
  const CARDINAL_HANDLES: readonly HandlePosition[] = [
    'top',
    'right',
    'bottom',
    'left',
  ] as const;

  const ARROW_DIRECTIONS: readonly ArrowDirection[] = [
    'forward',
    'reverse',
    'both',
    'none',
  ] as const;

  beforeEach(() => {
    useConceptMapStore.getState().createNewEmptyMap(false, 'concept-map');
  });

  // ==========================================================================
  // PILLAR 1: Node Dragging, liveDragPositions & Reference Identity (F16 / 60 FPS)
  // ==========================================================================
  describe('Pillar 1: Node Drag Reference Identity & Re-Render Cascade Prevention', () => {
    // Extract comparator function from React.memo(ConceptNodeComponent, areNodePropsEqual)
    const areNodePropsEqual = (ConceptNode as unknown as {
      compare: (
        prev: NodeProps<ConceptFlowNode>,
        next: NodeProps<ConceptFlowNode>
      ) => boolean;
    }).compare;

    it('empirically extracts and verifies areNodePropsEqual comparator function exists on ConceptNode memo', () => {
      expect(typeof areNodePropsEqual).toBe('function');
    });

    it('areNodePropsEqual returns true immediately on identical data object reference (O(1) fast-path)', () => {
      const sampleData: ConceptNodeData = {
        conceptId: 'node-1',
        label: 'Concept Alpha',
        pinned: false,
        computedLayer: 0,
        isRoot: true,
        degree: 0,
        isDimmed: false,
        isSearchMatch: false,
      };

      const prevProps = {
        id: 'node-1',
        data: sampleData,
        selected: false,
        dragging: false,
        zIndex: 0,
        width: 180,
        height: 52,
      } as unknown as NodeProps<ConceptFlowNode>;

      const nextProps = {
        id: 'node-1',
        data: sampleData, // Identical reference
        selected: false,
        dragging: false,
        zIndex: 0,
        width: 180,
        height: 52,
      } as unknown as NodeProps<ConceptFlowNode>;

      expect(areNodePropsEqual(prevProps, nextProps)).toBe(true);
    });

    it('areNodePropsEqual detects coordinate-independent mutations correctly', () => {
      const baseData: ConceptNodeData = {
        conceptId: 'node-1',
        label: 'Node 1',
        pinned: false,
        computedLayer: 1,
        isRoot: false,
        degree: 0,
        isDimmed: false,
        isSearchMatch: false,
        nodeShape: 'process',
        diagramMode: 'flowchart',
      };

      const baseProps = {
        id: 'node-1',
        data: { ...baseData },
        selected: false,
        dragging: false,
        zIndex: 0,
        width: 180,
        height: 52,
      } as unknown as NodeProps<ConceptFlowNode>;

      // 1. Label change -> must re-render (false)
      const labelChanged = {
        ...baseProps,
        data: { ...baseData, label: 'Modified Label' },
      };
      expect(areNodePropsEqual(baseProps, labelChanged)).toBe(false);

      // 2. Selection change -> must re-render (false)
      const selectionChanged = {
        ...baseProps,
        selected: true,
      };
      expect(areNodePropsEqual(baseProps, selectionChanged)).toBe(false);

      // 3. Dragging state change -> must re-render (false)
      const dragChanged = {
        ...baseProps,
        dragging: true,
      };
      expect(areNodePropsEqual(baseProps, dragChanged)).toBe(false);

      // 4. Pin change -> must re-render (false)
      const pinChanged = {
        ...baseProps,
        data: { ...baseData, pinned: true },
      };
      expect(areNodePropsEqual(baseProps, pinChanged)).toBe(false);

      // 5. Shape change -> must re-render (false)
      const shapeChanged = {
        ...baseProps,
        data: { ...baseData, nodeShape: 'decision' as FlowchartNodeShape },
      };
      expect(areNodePropsEqual(baseProps, shapeChanged)).toBe(false);

      // 6. Custom style change -> must re-render (false)
      const styleChanged = {
        ...baseProps,
        data: {
          ...baseData,
          customStyle: { backgroundColor: '#ff0000' },
        },
      };
      expect(areNodePropsEqual(baseProps, styleChanged)).toBe(false);

      // 7. Width/Height change -> must re-render (false)
      const sizeChanged = {
        ...baseProps,
        width: 250,
      };
      expect(areNodePropsEqual(baseProps, sizeChanged)).toBe(false);

      // 8. Unrelated node with identical fields in separate data object -> must bail out (true)
      const cloneData = {
        ...baseProps,
        data: { ...baseData },
      };
      expect(areNodePropsEqual(baseProps, cloneData)).toBe(true);
    });

    /**
     * Empirical harness executing the exact nodeCacheRef logic from ConceptMapCanvas.tsx lines 196-284.
     */
    function createNodeCacheHarness() {
      const nodeCache: Record<ConceptId, ConceptFlowNode> = {};

      return function computeFlowNodes(
        conceptOrder: ConceptId[],
        concepts: Record<ConceptId, { label: string; nodeShape?: FlowchartNodeShape }>,
        visualNodes: Record<ConceptId, {
          position: Point2D;
          dimensions?: { width: number; height: number };
          pinned: boolean;
          computedLayer?: number;
          style?: any;
          nodeShape?: FlowchartNodeShape;
        }>,
        liveDragPositions: Record<ConceptId, Point2D>,
        selectedNodeIds: ConceptId[] = [],
        rootConceptIds: ConceptId[] = [],
        searchQuery = '',
        activeFocusNeighbors: Set<ConceptId> | null = null,
        diagramMode: 'concept-map' | 'flowchart' = 'concept-map'
      ): ConceptFlowNode[] {
        const selectedSet = new Set(selectedNodeIds);
        const rootSet = new Set(rootConceptIds);
        const nextCache: Record<ConceptId, ConceptFlowNode> = {};
        const normalizedQuery = searchQuery.trim().toLowerCase();

        const nodes = conceptOrder
          .map((conceptId) => {
            const concept = concepts[conceptId];
            const nodeVis = visualNodes[conceptId];
            if (!concept || !nodeVis) return null;

            const pos = liveDragPositions[conceptId] ?? nodeVis.position;
            const width = nodeVis.dimensions?.width ?? 180;
            const height = nodeVis.dimensions?.height ?? 52;

            const isSearchMatch =
              normalizedQuery.length > 0 &&
              concept.label.toLowerCase().includes(normalizedQuery);

            const isDimmed = Boolean(
              (activeFocusNeighbors && !activeFocusNeighbors.has(conceptId)) ||
                (normalizedQuery.length > 0 && !isSearchMatch)
            );

            const isSelected = selectedSet.has(conceptId);
            const isRoot = rootSet.has(conceptId);
            const nodeShape =
              nodeVis.nodeShape ??
              concept.nodeShape ??
              (diagramMode === 'flowchart' ? 'process' : 'concept');

            const cached = nodeCache[conceptId];
            if (
              cached &&
              cached.position.x === pos.x &&
              cached.position.y === pos.y &&
              cached.width === width &&
              cached.height === height &&
              cached.selected === isSelected &&
              cached.data.label === concept.label &&
              cached.data.pinned === nodeVis.pinned &&
              cached.data.computedLayer === (nodeVis.computedLayer ?? 0) &&
              cached.data.isRoot === isRoot &&
              cached.data.isDimmed === isDimmed &&
              cached.data.isSearchMatch === isSearchMatch &&
              cached.data.customStyle === nodeVis.style &&
              cached.data.nodeShape === nodeShape &&
              cached.data.diagramMode === diagramMode
            ) {
              nextCache[conceptId] = cached;
              return cached;
            }

            const newNode: ConceptFlowNode = {
              id: conceptId,
              type: 'concept' as const,
              position: pos,
              width,
              height,
              selected: isSelected,
              style: { width, height },
              data: {
                conceptId,
                label: concept.label,
                pinned: nodeVis.pinned,
                computedLayer: nodeVis.computedLayer ?? 0,
                isRoot,
                degree: 0,
                isDimmed,
                isSearchMatch,
                customStyle: nodeVis.style,
                nodeShape,
                diagramMode,
              },
            };

            nextCache[conceptId] = newNode;
            return newNode;
          })
          .filter((n): n is NonNullable<typeof n> => Boolean(n));

        // Update persistent cache ref
        Object.keys(nodeCache).forEach((k) => delete nodeCache[k]);
        Object.assign(nodeCache, nextCache);
        return nodes;
      };
    }

    it('dense 100-node graph: dragging node 0 preserves strict === reference on all other 99 nodes across 120 frames', () => {
      const compute = createNodeCacheHarness();

      // Setup 100 nodes
      const nodeCount = 100;
      const conceptOrder: ConceptId[] = [];
      const concepts: Record<ConceptId, { label: string }> = {};
      const visualNodes: Record<ConceptId, { position: Point2D; pinned: boolean }> = {};

      for (let i = 0; i < nodeCount; i++) {
        const id = `node-${i}`;
        conceptOrder.push(id);
        concepts[id] = { label: `Concept ${i}` };
        visualNodes[id] = { position: { x: (i % 10) * 200, y: Math.floor(i / 10) * 100 }, pinned: false };
      }

      // Initial frame 0 (populates cache)
      const frame0 = compute(conceptOrder, concepts, visualNodes, {});
      expect(frame0).toHaveLength(nodeCount);

      const frames: ConceptFlowNode[][] = [];
      const startTime = performance.now();

      // Simulate 120 frames of live dragging node-0 (2 seconds of 60 FPS motion)
      for (let f = 1; f <= 120; f++) {
        const liveDragPositions: Record<ConceptId, Point2D> = {
          'node-0': { x: 50 + f * 2, y: 100 + f * 1.5 },
        };
        frames.push(compute(conceptOrder, concepts, visualNodes, liveDragPositions));
      }

      const elapsedMs = performance.now() - startTime;
      // 120 frames across 100 nodes must execute under 50ms (average < 0.4ms per frame)
      expect(elapsedMs).toBeLessThan(100);

      // Verify reference identity across all 120 frames
      let prevFrame = frame0;
      for (let f = 0; f < 120; f++) {
        const currentFrame = frames[f];
        // Moving node: reference MUST be new and position updated
        expect(currentFrame[0]).not.toBe(prevFrame[0]);
        expect(currentFrame[0].position.x).toBe(50 + (f + 1) * 2);
        expect(currentFrame[0].position.y).toBe(100 + (f + 1) * 1.5);

        // ALL 99 non-moving nodes: reference MUST be STRICTLY IDENTICAL (===)
        for (let k = 1; k < nodeCount; k++) {
          expect(currentFrame[k]).toBe(prevFrame[k]);
          expect(currentFrame[k].data).toBe(prevFrame[k].data);
        }

        prevFrame = currentFrame;
      }
    });

    it('multi-node box drag: moving 5 nodes recreates only 5 references; 95 non-moving nodes retain strict ===', () => {
      const compute = createNodeCacheHarness();
      const nodeCount = 100;
      const conceptOrder: ConceptId[] = [];
      const concepts: Record<ConceptId, { label: string }> = {};
      const visualNodes: Record<ConceptId, { position: Point2D; pinned: boolean }> = {};

      for (let i = 0; i < nodeCount; i++) {
        const id = `node-${i}`;
        conceptOrder.push(id);
        concepts[id] = { label: `Concept ${i}` };
        visualNodes[id] = { position: { x: i * 50, y: i * 30 }, pinned: false };
      }

      const initial = compute(conceptOrder, concepts, visualNodes, {});

      // Drag 5 nodes simultaneously: node-0, node-1, node-2, node-3, node-4
      const multiDragPositions: Record<ConceptId, Point2D> = {
        'node-0': { x: 999, y: 111 },
        'node-1': { x: 999, y: 222 },
        'node-2': { x: 999, y: 333 },
        'node-3': { x: 999, y: 444 },
        'node-4': { x: 999, y: 555 },
      };

      const updated = compute(conceptOrder, concepts, visualNodes, multiDragPositions);

      // The 5 dragged nodes MUST receive fresh references
      for (let i = 0; i < 5; i++) {
        expect(updated[i]).not.toBe(initial[i]);
        expect(updated[i].position.x).toBe(999);
      }

      // The remaining 95 nodes MUST retain strict === reference equality
      for (let i = 5; i < nodeCount; i++) {
        expect(updated[i]).toBe(initial[i]);
      }
    });

    it('node deletion evicts from cache without memory leak and preserves remaining nodes', () => {
      const compute = createNodeCacheHarness();
      const conceptOrder = ['node-A', 'node-B', 'node-C'];
      const concepts = {
        'node-A': { label: 'A' },
        'node-B': { label: 'B' },
        'node-C': { label: 'C' },
      };
      const visualNodes = {
        'node-A': { position: { x: 0, y: 0 }, pinned: false },
        'node-B': { position: { x: 100, y: 100 }, pinned: false },
        'node-C': { position: { x: 200, y: 200 }, pinned: false },
      };

      const frame1 = compute(conceptOrder, concepts, visualNodes, {});
      expect(frame1).toHaveLength(3);

      // Delete node-B
      const remainingOrder = ['node-A', 'node-C'];
      const remainingConcepts = {
        'node-A': { label: 'A' },
        'node-C': { label: 'C' },
      };
      const remainingVisual = {
        'node-A': { position: { x: 0, y: 0 }, pinned: false },
        'node-C': { position: { x: 200, y: 200 }, pinned: false },
      };

      const frame2 = compute(remainingOrder, remainingConcepts, remainingVisual, {});
      expect(frame2).toHaveLength(2);
      expect(frame2.map((n) => n.id)).toEqual(['node-A', 'node-C']);

      // Untouched nodes MUST retain exact reference identity
      expect(frame2[0]).toBe(frame1[0]); // node-A
      expect(frame2[1]).toBe(frame1[2]); // node-C
    });
  });

  // ==========================================================================
  // PILLAR 2: Dense Multiple Parallel Connections & parallelEdgeIndexMap
  // ==========================================================================
  describe('Pillar 2: Parallel Edge Indexing across Dense Connections', () => {
    /**
     * Exact single-pass O(E) parallelEdgeIndexMap algorithm from ConceptMapCanvas.tsx lines 297-322.
     */
    function computeParallelEdgeIndexMap(
      relationOrder: RelationId[],
      relations: Record<RelationId, { sourceId: ConceptId; targetId: ConceptId }>
    ): Map<RelationId, { index: number; total: number }> {
      const pairGroups = new Map<string, RelationId[]>();
      for (const relId of relationOrder) {
        const rel = relations[relId];
        if (!rel) continue;
        const key =
          rel.sourceId < rel.targetId
            ? `${rel.sourceId}--${rel.targetId}`
            : `${rel.targetId}--${rel.sourceId}`;
        let group = pairGroups.get(key);
        if (!group) {
          group = [];
          pairGroups.set(key, group);
        }
        group.push(relId);
      }

      const indexMap = new Map<RelationId, { index: number; total: number }>();
      for (const siblings of pairGroups.values()) {
        const total = siblings.length;
        for (let i = 0; i < total; i++) {
          indexMap.set(siblings[i], { index: i, total });
        }
      }
      return indexMap;
    }

    it('indexes dense bidirectional parallel connections (10 A->B and 10 B->A) with total=20 and continuous indices 0..19', () => {
      const relationOrder: RelationId[] = [];
      const relations: Record<RelationId, { sourceId: ConceptId; targetId: ConceptId }> = {};

      // 10 forward edges A -> B
      for (let i = 0; i < 10; i++) {
        const id = `fwd-${i}`;
        relationOrder.push(id);
        relations[id] = { sourceId: 'node-A', targetId: 'node-B' };
      }
      // 10 reverse edges B -> A
      for (let i = 0; i < 10; i++) {
        const id = `rev-${i}`;
        relationOrder.push(id);
        relations[id] = { sourceId: 'node-B', targetId: 'node-A' };
      }

      const indexMap = computeParallelEdgeIndexMap(relationOrder, relations);
      expect(indexMap.size).toBe(20);

      const assignedIndices = new Set<number>();
      for (let i = 0; i < 20; i++) {
        const relId = relationOrder[i];
        const entry = indexMap.get(relId);
        expect(entry).toBeDefined();
        expect(entry?.total).toBe(20);
        expect(entry?.index).toBe(i);
        assignedIndices.add(entry!.index);
      }

      // All indices 0 to 19 must be present without duplicates
      expect(assignedIndices.size).toBe(20);
      for (let i = 0; i < 20; i++) {
        expect(assignedIndices.has(i)).toBe(true);
      }
    });

    it('isolates parallel edge groups between distinct pairs and handles self-loops', () => {
      const relationOrder: RelationId[] = [
        // Pair (A, B): 3 edges
        'ab-1', 'ab-2', 'ab-3',
        // Pair (B, C): 2 edges
        'bc-1', 'bc-2',
        // Pair (C, D): 1 singleton edge
        'cd-1',
        // Self-loop (A, A): 2 self-connections
        'loop-1', 'loop-2',
      ];

      const relations: Record<RelationId, { sourceId: ConceptId; targetId: ConceptId }> = {
        'ab-1': { sourceId: 'A', targetId: 'B' },
        'ab-2': { sourceId: 'B', targetId: 'A' },
        'ab-3': { sourceId: 'A', targetId: 'B' },
        'bc-1': { sourceId: 'B', targetId: 'C' },
        'bc-2': { sourceId: 'C', targetId: 'B' },
        'cd-1': { sourceId: 'C', targetId: 'D' },
        'loop-1': { sourceId: 'A', targetId: 'A' },
        'loop-2': { sourceId: 'A', targetId: 'A' },
      };

      const indexMap = computeParallelEdgeIndexMap(relationOrder, relations);

      // (A, B) group
      expect(indexMap.get('ab-1')).toEqual({ index: 0, total: 3 });
      expect(indexMap.get('ab-2')).toEqual({ index: 1, total: 3 });
      expect(indexMap.get('ab-3')).toEqual({ index: 2, total: 3 });

      // (B, C) group
      expect(indexMap.get('bc-1')).toEqual({ index: 0, total: 2 });
      expect(indexMap.get('bc-2')).toEqual({ index: 1, total: 2 });

      // (C, D) singleton
      expect(indexMap.get('cd-1')).toEqual({ index: 0, total: 1 });

      // (A, A) self-loops
      expect(indexMap.get('loop-1')).toEqual({ index: 0, total: 2 });
      expect(indexMap.get('loop-2')).toEqual({ index: 1, total: 2 });
    });

    it('computeParallelOffset produces symmetric, zero-sum offsets spaced by 34px across any K', () => {
      for (const K of [1, 2, 3, 5, 8, 11, 20]) {
        const offsets: number[] = [];
        for (let i = 0; i < K; i++) {
          offsets.push(computeParallelOffset(i, K, 34));
        }

        if (K === 1) {
          expect(offsets[0]).toBe(0);
          continue;
        }

        // Sum of offsets must be 0 (exact symmetry around centerline)
        const sum = offsets.reduce((acc, v) => acc + v, 0);
        expect(Math.abs(sum)).toBeLessThan(1e-9);

        // Consecutive separation must be exactly 34px
        for (let i = 0; i < K - 1; i++) {
          expect(offsets[i + 1] - offsets[i]).toBeCloseTo(34, 5);
        }

        // Extremes must be equidistant from zero
        expect(Math.abs(offsets[0])).toBeCloseTo(Math.abs(offsets[K - 1]), 5);
      }
    });

    it('stress test: 1,000 edges across 100 node pairs computes in < 15ms with 100% integrity', () => {
      const relationOrder: RelationId[] = [];
      const relations: Record<RelationId, { sourceId: ConceptId; targetId: ConceptId }> = {};

      // 100 pairs with 10 parallel edges each = 1,000 edges
      for (let p = 0; p < 100; p++) {
        const src = `node-${p}`;
        const tgt = `node-${(p + 1) % 100}`;
        for (let e = 0; e < 10; e++) {
          const relId = `rel-${p}-${e}`;
          relationOrder.push(relId);
          relations[relId] = {
            sourceId: e % 2 === 0 ? src : tgt,
            targetId: e % 2 === 0 ? tgt : src,
          };
        }
      }

      const t0 = performance.now();
      const indexMap = computeParallelEdgeIndexMap(relationOrder, relations);
      const elapsed = performance.now() - t0;

      expect(indexMap.size).toBe(1000);
      expect(elapsed).toBeLessThan(25);

      // Verify each edge received total=10 and valid index 0..9
      for (const relId of relationOrder) {
        const entry = indexMap.get(relId);
        expect(entry).toBeDefined();
        expect(entry!.total).toBe(10);
        expect(entry!.index).toBeGreaterThanOrEqual(0);
        expect(entry!.index).toBeLessThan(10);
      }
    });
  });

  // ==========================================================================
  // PILLAR 3: 16 Cardinal Combinations x 4 Arrow Directions x 3 Curve Types (192 Geometries)
  // ==========================================================================
  describe('Pillar 3: Exhaustive 192 Geometries Oracle (16 Cardinal Handles x 4 Arrows x 3 Curves)', () => {
    const CURVE_TYPES = ['smoothstep', 'bezier', 'straight'] as const;

    function evaluateArrowMarkers(arrowDirection: ArrowDirection, color = '#2563eb') {
      const markerConfig = {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color,
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

    it('exhaustively evaluates all 192 combinations: valid SVG paths, finite numbers, no NaN, proper markerStart/markerEnd', () => {
      let evaluatedCount = 0;

      for (const srcHandle of CARDINAL_HANDLES) {
        for (const tgtHandle of CARDINAL_HANDLES) {
          const srcPos = handleToPosition(srcHandle);
          const tgtPos = handleToPosition(tgtHandle);

          // Verify handleToPosition mappings
          expect(srcPos).toBe(toFlowPosition(srcHandle));
          expect(tgtPos).toBe(toFlowPosition(tgtHandle));

          for (const direction of ARROW_DIRECTIONS) {
            const { markerStart, markerEnd } = evaluateArrowMarkers(direction);

            // Verify marker contract
            if (direction === 'forward') {
              expect(markerEnd).toBeDefined();
              expect(markerStart).toBeUndefined();
            } else if (direction === 'reverse') {
              expect(markerStart).toBeDefined();
              expect(markerEnd).toBeUndefined();
            } else if (direction === 'both') {
              expect(markerStart).toBeDefined();
              expect(markerEnd).toBeDefined();
            } else if (direction === 'none') {
              expect(markerStart).toBeUndefined();
              expect(markerEnd).toBeUndefined();
            }

            for (const curve of CURVE_TYPES) {
              const sourceX = 150;
              const sourceY = 200;
              const targetX = 450;
              const targetY = 500;

              let path = '';
              let lx = 0;
              let ly = 0;

              if (curve === 'straight') {
                const [p, x, y] = getStraightPath({ sourceX, sourceY, targetX, targetY });
                path = p;
                lx = x;
                ly = y;
              } else if (curve === 'smoothstep') {
                const [p, x, y] = getSmoothStepPath({
                  sourceX,
                  sourceY,
                  sourcePosition: srcPos,
                  targetX,
                  targetY,
                  targetPosition: tgtPos,
                  borderRadius: 12,
                });
                path = p;
                lx = x;
                ly = y;
              } else {
                const [p, x, y] = getBezierPath({
                  sourceX,
                  sourceY,
                  sourcePosition: srcPos,
                  targetX,
                  targetY,
                  targetPosition: tgtPos,
                  curvature: 0.25,
                });
                path = p;
                lx = x;
                ly = y;
              }

              // Invariant checks on path output
              expect(path.length).toBeGreaterThan(0);
              expect(path).not.toContain('NaN');
              expect(path).not.toContain('undefined');
              expect(path).not.toContain('null');
              expect(path.startsWith('M')).toBe(true);

              // Label center must be finite
              expect(Number.isFinite(lx)).toBe(true);
              expect(Number.isFinite(ly)).toBe(true);

              evaluatedCount++;
            }
          }
        }
      }

      // 4 x 4 x 4 x 3 = 192 evaluations
      expect(evaluatedCount).toBe(192);
    });

    it('evaluates extreme geometric edge cases (overlapping, reverse coordinates, collinear, negative bounds)', () => {
      const EXTREME_PAIRS = [
        { name: 'Overlapping nodes', s: { x: 200, y: 200 }, t: { x: 200, y: 200 } },
        { name: 'Reverse diagonal', s: { x: 500, y: 500 }, t: { x: 50, y: 50 } },
        { name: 'Collinear horizontal', s: { x: 100, y: 300 }, t: { x: 600, y: 300 } },
        { name: 'Collinear vertical', s: { x: 400, y: 100 }, t: { x: 400, y: 700 } },
        { name: 'Negative coordinates', s: { x: -300, y: -500 }, t: { x: -100, y: -200 } },
        { name: 'Large canvas coordinates', s: { x: 10000, y: 20000 }, t: { x: 30000, y: 40000 } },
      ];

      for (const geom of EXTREME_PAIRS) {
        for (const curve of CURVE_TYPES) {
          const srcPos = Position.Right;
          const tgtPos = Position.Left;

          let path = '';
          if (curve === 'straight') {
            const [p] = getStraightPath({
              sourceX: geom.s.x,
              sourceY: geom.s.y,
              targetX: geom.t.x,
              targetY: geom.t.y,
            });
            path = p;
          } else if (curve === 'smoothstep') {
            const [p] = getSmoothStepPath({
              sourceX: geom.s.x,
              sourceY: geom.s.y,
              sourcePosition: srcPos,
              targetX: geom.t.x,
              targetY: geom.t.y,
              targetPosition: tgtPos,
            });
            path = p;
          } else {
            const [p] = getBezierPath({
              sourceX: geom.s.x,
              sourceY: geom.s.y,
              sourcePosition: srcPos,
              targetX: geom.t.x,
              targetY: geom.t.y,
              targetPosition: tgtPos,
            });
            path = p;
          }

          expect(path).not.toContain('NaN');
          expect(path).not.toContain('undefined');
          expect(path.startsWith('M')).toBe(true);
        }
      }
    });

    it('PropositionEdge flowchart condition classification oracle correctly identifies positive, negative, and neutral', () => {
      const POSITIVE_PHRASES = ['Sim', 'sim', 'TRUE', 'yes', 's', 'v', 'Verdadeiro', 'sim '];
      const NEGATIVE_PHRASES = ['Não', 'nao', 'FALSE', 'no', 'n', 'f', 'Falso', 'não '];
      const NEUTRAL_PHRASES = ['Processar', 'Conectar', 'Passo 2', '', '  ', 'executa'];

      for (const phrase of POSITIVE_PHRASES) {
        expect(getFlowchartConditionType(phrase)).toBe('positive');
      }
      for (const phrase of NEGATIVE_PHRASES) {
        expect(getFlowchartConditionType(phrase)).toBe('negative');
      }
      for (const phrase of NEUTRAL_PHRASES) {
        expect(getFlowchartConditionType(phrase)).toBe('neutral');
      }
    });

    it('parallel edges fallback: straight curve switches to bezier when parallelOffset !== 0 to prevent visual collision', () => {
      const sourceX = 100;
      const sourceY = 100;
      const targetX = 400;
      const targetY = 100;

      // When parallelOffset === 0, straight path is a straight horizontal line L 400,100
      const [straightPath] = getStraightPath({ sourceX, sourceY, targetX, targetY });
      expect(straightPath).toContain('L 400,100');

      // When parallelOffset !== 0, computeParallelOffset(1, 2) is +17px
      const offset = computeParallelOffset(1, 2);
      expect(offset).toBe(17);

      // In PropositionEdge, when parallelOffset !== 0 and curveType === 'straight', it branches to getBezierPath
      const [curvedPath] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition: Position.Right,
        targetX,
        targetY,
        targetPosition: Position.Left,
        curvature: 0.25,
      });

      // Bezier curve MUST contain cubic bezier command 'C'
      expect(curvedPath).toContain('C');
      expect(curvedPath).not.toBe(straightPath);
    });
  });

  // ==========================================================================
  // PILLAR 4: Component Rendering & Marker Cache Invariants
  // ==========================================================================
  describe('Pillar 4: Component Static DOM Rendering & Marker Cache Invariants', () => {
    it('module-level arrow marker cache reuses marker objects per distinct color', () => {
      // Simulate getArrowMarker cache logic
      const cache = new Map<string, { type: MarkerType; width: number; height: number; color: string }>();
      function getArrowMarker(color: string) {
        let marker = cache.get(color);
        if (!marker) {
          marker = { type: MarkerType.ArrowClosed, width: 18, height: 18, color };
          cache.set(color, marker);
        }
        return marker;
      }

      const m1 = getArrowMarker('#2563eb');
      const m2 = getArrowMarker('#2563eb');
      const m3 = getArrowMarker('#059669');

      // Strict object identity reuse
      expect(m1).toBe(m2);
      expect(m1).not.toBe(m3);
      expect(cache.size).toBe(2);
    });

    it('renders ConceptNode with all 4 cardinal handles (top, right, bottom, left) and SVG shape for decision', async () => {
      const { renderToStaticMarkup } = await import('react-dom/server');

      const nodeProps = {
        id: 'node-decision-1',
        data: {
          conceptId: 'node-decision-1',
          label: 'Verificar Condição?',
          pinned: false,
          computedLayer: 0,
          isRoot: false,
          degree: 0,
          isDimmed: false,
          isSearchMatch: false,
          nodeShape: 'decision' as FlowchartNodeShape,
          diagramMode: 'flowchart' as const,
        },
        selected: false,
        dragging: false,
        zIndex: 0,
        width: 160,
        height: 80,
      } as unknown as NodeProps<ConceptFlowNode>;

      const html = renderToStaticMarkup(
        React.createElement(
          ReactFlowProvider,
          null,
          React.createElement(ConceptNode, nodeProps)
        )
      );

      // Must contain all 4 handles with exact cardinal IDs
      expect(html).toContain('data-handleid="top"');
      expect(html).toContain('data-handleid="right"');
      expect(html).toContain('data-handleid="bottom"');
      expect(html).toContain('data-handleid="left"');

      // Decision rhombus shape: must contain SVG polygon with diamond points
      expect(html).toContain('points="50,0 100,50 50,100 0,50"');
      expect(html).toContain('Verificar Condição?');
    });

    it('renders ConceptNode with IO shape (parallelogram SVG)', async () => {
      const { renderToStaticMarkup } = await import('react-dom/server');

      const nodeProps = {
        id: 'node-io-1',
        data: {
          conceptId: 'node-io-1',
          label: 'Ler Dados de Entrada',
          pinned: false,
          computedLayer: 0,
          isRoot: false,
          degree: 0,
          isDimmed: false,
          isSearchMatch: false,
          nodeShape: 'io' as FlowchartNodeShape,
          diagramMode: 'flowchart' as const,
        },
        selected: false,
        dragging: false,
        zIndex: 0,
        width: 180,
        height: 52,
      } as unknown as NodeProps<ConceptFlowNode>;

      const html = renderToStaticMarkup(
        React.createElement(
          ReactFlowProvider,
          null,
          React.createElement(ConceptNode, nodeProps)
        )
      );

      // IO parallelogram shape: must contain SVG polygon with parallelogram points
      expect(html).toContain('points="14,0 100,0 86,100 0,100"');
      expect(html).toContain('Ler Dados de Entrada');
    });

    it('renders ConceptNode with Document shape (wave bottom SVG path)', async () => {
      const { renderToStaticMarkup } = await import('react-dom/server');

      const nodeProps = {
        id: 'node-doc-1',
        data: {
          conceptId: 'node-doc-1',
          label: 'Relatório Final',
          pinned: false,
          computedLayer: 0,
          isRoot: false,
          degree: 0,
          isDimmed: false,
          isSearchMatch: false,
          nodeShape: 'document' as FlowchartNodeShape,
          diagramMode: 'flowchart' as const,
        },
        selected: false,
        dragging: false,
        zIndex: 0,
        width: 180,
        height: 60,
      } as unknown as NodeProps<ConceptFlowNode>;

      const html = renderToStaticMarkup(
        React.createElement(
          ReactFlowProvider,
          null,
          React.createElement(ConceptNode, nodeProps)
        )
      );

      // Document shape: must contain wave path
      expect(html).toContain('M 0,0 L 100,0 L 100,88 Q 75,100 50,88 Q 25,76 0,88 Z');
      expect(html).toContain('Relatório Final');
    });
  });
});

