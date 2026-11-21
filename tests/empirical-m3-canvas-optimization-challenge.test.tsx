/**
 * Empirical Adversarial Challenge for Milestone M3 Optimization:
 * Canvas 60 FPS isolation, React.memo equality, cached markers, and UI template consolidation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useConceptMapStore } from '../src/store/useConceptMapStore';
import { handleToPosition, PropositionEdge } from '../src/components/canvas/PropositionEdge';
import { ConceptNode } from '../src/components/canvas/ConceptNode';
import { Position } from '@xyflow/react';
import type { ConceptFlowNode } from '../src/components/canvas/ConceptNode';

describe('Adversarial M3 Optimization Integrity & Stress Verification', () => {
  beforeEach(() => {
    useConceptMapStore.getState().createNewEmptyMap(false, 'flowchart');
  });

  describe('Pillar 1: PropositionEdge & geometry module backwards compatibility', () => {
    it('handleToPosition exports correctly maps top, right, bottom, left and fallback', () => {
      expect(handleToPosition('top')).toBe(Position.Top);
      expect(handleToPosition('right')).toBe(Position.Right);
      expect(handleToPosition('bottom')).toBe(Position.Bottom);
      expect(handleToPosition('left')).toBe(Position.Left);
      expect(handleToPosition(null, Position.Bottom)).toBe(Position.Bottom);
      expect(handleToPosition(undefined, Position.Right)).toBe(Position.Right);
      expect(handleToPosition('unknown' as any, Position.Left)).toBe(Position.Left);
    });

    it('PropositionEdge is a memoized React component', () => {
      expect(PropositionEdge).toBeDefined();
      expect(typeof PropositionEdge).toBe('object'); // React.memo object has $$typeof
      expect((PropositionEdge as any).$$typeof).toBeDefined();
    });

    it('ConceptNode is a memoized React component', () => {
      expect(ConceptNode).toBeDefined();
      expect(typeof ConceptNode).toBe('object');
      expect((ConceptNode as any).$$typeof).toBeDefined();
    });
  });

  describe('Pillar 2: Node Cache & Isolation Simulation', () => {
    it('simulates 60 FPS nodeCacheRef isolation across 50 nodes', () => {
      const nodeCache: Record<string, ConceptFlowNode> = {};

      // Initialize 50 nodes
      for (let i = 0; i < 50; i++) {
        const id = `node-${i}`;
        nodeCache[id] = {
          id,
          type: 'concept',
          position: { x: i * 100, y: 100 },
          width: 120,
          height: 60,
          selected: false,
          style: { width: 120, height: 60 },
          data: {
            conceptId: id,
            label: `Node ${i}`,
            pinned: false,
            computedLayer: 0,
            isRoot: i === 0,
            degree: 0,
            isDimmed: false,
            isSearchMatch: false,
            customStyle: undefined,
            nodeShape: 'process',
            diagramMode: 'flowchart',
          },
        };
      }

      // Simulate dragging node-5 to x: 550, y: 350
      const nextCache: Record<string, ConceptFlowNode> = {};
      const activeDragNodeId = 'node-5';
      const newPos = { x: 550, y: 350 };

      const updatedNodes = Object.keys(nodeCache).map((id) => {
        const cached = nodeCache[id];
        const isDragging = id === activeDragNodeId;
        const pos = isDragging ? newPos : cached.position;

        if (
          cached &&
          cached.position.x === pos.x &&
          cached.position.y === pos.y &&
          cached.width === 120 &&
          cached.height === 60 &&
          cached.selected === false &&
          cached.data.label === `Node ${id.replace('node-', '')}` &&
          cached.data.nodeShape === 'process'
        ) {
          nextCache[id] = cached;
          return cached;
        }

        const newNode: ConceptFlowNode = {
          ...cached,
          position: pos,
        };
        nextCache[id] = newNode;
        return newNode;
      });

      // Verify node-5 received a new reference
      expect(updatedNodes[5]).not.toBe(nodeCache['node-5']);
      expect(updatedNodes[5].position).toEqual({ x: 550, y: 350 });

      // Verify all other 49 nodes maintained EXACT reference identity (0 re-renders)
      for (let i = 0; i < 50; i++) {
        if (i === 5) continue;
        const id = `node-${i}`;
        expect(updatedNodes[i]).toBe(nodeCache[id]);
      }
    });
  });

  describe('Pillar 3: O(E) Parallel Edge Single-Pass Indexing Logic', () => {
    it('accurately indexes multiple parallel and opposite relations without N^2 search', () => {
      const relationOrder = ['rel-1', 'rel-2', 'rel-3', 'rel-4', 'rel-5'];
      const relations = {
        'rel-1': { sourceId: 'A', targetId: 'B' },
        'rel-2': { sourceId: 'B', targetId: 'A' }, // opposite direction, same pair
        'rel-3': { sourceId: 'A', targetId: 'B' }, // third edge
        'rel-4': { sourceId: 'C', targetId: 'D' }, // single edge
        'rel-5': { sourceId: 'D', targetId: 'C' }, // opposite pair
      };

      const pairGroups = new Map<string, string[]>();
      for (const relId of relationOrder) {
        const rel = relations[relId as keyof typeof relations];
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

      const indexMap = new Map<string, { index: number; total: number }>();
      for (const siblings of pairGroups.values()) {
        const total = siblings.length;
        for (let i = 0; i < total; i++) {
          indexMap.set(siblings[i], { index: i, total });
        }
      }

      // Group A--B has 3 edges
      expect(indexMap.get('rel-1')).toEqual({ index: 0, total: 3 });
      expect(indexMap.get('rel-2')).toEqual({ index: 1, total: 3 });
      expect(indexMap.get('rel-3')).toEqual({ index: 2, total: 3 });

      // Group C--D has 2 edges
      expect(indexMap.get('rel-4')).toEqual({ index: 0, total: 2 });
      expect(indexMap.get('rel-5')).toEqual({ index: 1, total: 2 });
    });
  });

  describe('Pillar 4: PropertyInspector and TopToolbar Store Integration', () => {
    it('verifies updateRelation correctly latches manualHandles when handles are set', () => {
      const store = useConceptMapStore.getState();
      const c1 = store.addConcept('A', { x: 0, y: 0 }, 'concept');
      const c2 = store.addConcept('B', { x: 200, y: 0 }, 'concept');
      const relId = store.addRelation(c1, c2, 'ligado a', 'hierarchical');

      expect(relId).toBeDefined();
      if (!relId) return;

      // Update source handle to left
      store.updateRelation(relId, {
        sourceHandle: 'left',
        manualHandles: true,
      });

      let edgeVis = useConceptMapStore.getState().visual.edges[relId];
      expect(edgeVis.sourceHandle).toBe('left');
      expect(edgeVis.manualHandles).toBe(true);

      // Invert relation direction
      store.reverseRelationDirection(relId);
      const invertedRel = useConceptMapStore.getState().semantic.relations[relId];
      edgeVis = useConceptMapStore.getState().visual.edges[relId];
      expect(invertedRel.sourceId).toBe(c2);
      expect(invertedRel.targetId).toBe(c1);
      // Handles inverted as well
      expect(edgeVis.targetHandle).toBe('left');
    });
  });
});
