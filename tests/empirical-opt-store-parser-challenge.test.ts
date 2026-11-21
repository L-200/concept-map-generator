import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ConceptId,
  ConceptMapDocument,
  FlowchartNodeShape,
  HandlePosition,
  SemanticModel,
  VisualModel,
} from '../src/domain/types';
import {
  AUTOSAVE_STORAGE_KEY,
  useConceptMapStore,
} from '../src/store/useConceptMapStore';
import {
  computeSemanticGraphMetrics,
  extractShapeFromLabel,
  isTableSeparatorLine,
  normalizeNodeShapeString,
  parseConceptMapMarkdown,
  splitMarkdownTableRow,
} from '../src/services/parser/markdownParser';

describe('Empirical M2 Optimization Challenge: Store & Parser Stress Tests', () => {
  // ============================================================================
  // SUITE 1: Store Debounced Autosave Stress Testing
  // ============================================================================
  describe('Suite 1: Store Debounced Autosave & Persistence Queue', () => {
    let storageMap: Record<string, string> = {};
    let setItemSpy: ReturnType<typeof vi.fn>;

    const mockStorage = {
      getItem: (key: string) => storageMap[key] ?? null,
      setItem: (key: string, value: string) => {
        storageMap[key] = String(value);
      },
      removeItem: (key: string) => {
        delete storageMap[key];
      },
      clear: () => {
        storageMap = {};
      },
    };

    beforeEach(() => {
      vi.useFakeTimers();
      storageMap = {};
      setItemSpy = vi.fn(mockStorage.setItem);
      const activeStorage = { ...mockStorage, setItem: setItemSpy };

      (globalThis as any).localStorage = activeStorage;
      if (typeof (globalThis as any).window === 'undefined') {
        (globalThis as any).window = globalThis;
      }
      (globalThis as any).window.localStorage = activeStorage;

      useConceptMapStore.getState().createNewEmptyMap(false, 'flowchart');
      setItemSpy.mockClear();
    });

    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
    });

    it('Scenario 1.1: Coalesces 50 rapid keystrokes/mutations into a single debounced localStorage write', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('Start', { x: 100, y: 100 });
      setItemSpy.mockClear();

      // Simulate 50 rapid label modifications (keystrokes)
      for (let i = 1; i <= 50; i++) {
        useConceptMapStore.getState().updateConceptLabel(nodeA, `Processing step ${i}`);
        // Advance timer partially (10ms), less than 300ms debounce
        vi.advanceTimersByTime(10);
      }

      // During rapid typing, localStorage should NOT be bombarded 50 times
      expect(setItemSpy).not.toHaveBeenCalled();

      // Advance timers by the remaining debounce time (300ms)
      vi.advanceTimersByTime(300);

      // Verify localStorage was written exactly once with the coalesced 50th state
      expect(setItemSpy).toHaveBeenCalledTimes(1);
      const raw = storageMap[AUTOSAVE_STORAGE_KEY];
      expect(raw).toBeTruthy();
      const savedDoc = JSON.parse(raw) as ConceptMapDocument;
      expect(savedDoc.semantic.concepts[nodeA].label).toBe('Processing step 50');
    });

    it('Scenario 1.2: saveDraftToLocalStorage immediately flushes pending changes without waiting 300ms', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('Draft Node', { x: 200, y: 200 });
      setItemSpy.mockClear();

      // Mutate state
      useConceptMapStore.getState().updateConceptLabel(nodeA, 'Immediate Flush Test');
      expect(setItemSpy).not.toHaveBeenCalled();

      // Trigger explicit save
      useConceptMapStore.getState().saveDraftToLocalStorage();

      // Must be called immediately synchronously
      expect(setItemSpy).toHaveBeenCalledTimes(1);
      const raw = storageMap[AUTOSAVE_STORAGE_KEY];
      const savedDoc = JSON.parse(raw!) as ConceptMapDocument;
      expect(savedDoc.semantic.concepts[nodeA].label).toBe('Immediate Flush Test');

      // Advancing timers past 300ms should NOT write again because queue was flushed
      vi.advanceTimersByTime(500);
      expect(setItemSpy).toHaveBeenCalledTimes(1);
    });

    it('Scenario 1.3: markSaved immediately flushes pending snapshot and updates hasUnsavedChanges', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('Save Node', { x: 100, y: 100 });
      setItemSpy.mockClear();

      expect(useConceptMapStore.getState().hasUnsavedChanges).toBe(true);
      useConceptMapStore.getState().markSaved();

      // Synchronous write occurred
      expect(setItemSpy).toHaveBeenCalledTimes(1);
      expect(useConceptMapStore.getState().hasUnsavedChanges).toBe(false);

      // Advance timers to verify no trailing redundant write
      vi.advanceTimersByTime(400);
      expect(setItemSpy).toHaveBeenCalledTimes(1);
    });

    it('Scenario 1.4: restoreDraftFromLocalStorage flushes any pending draft before reading storage', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('Draft Before Restore', { x: 50, y: 50 });
      setItemSpy.mockClear();

      // Mutate node
      useConceptMapStore.getState().updateConceptLabel(nodeA, 'Latest Unflushed Edit');
      expect(setItemSpy).not.toHaveBeenCalled();

      // Calling restore flushes pending draft then restores it
      const restored = useConceptMapStore.getState().restoreDraftFromLocalStorage();
      expect(restored).toBe(true);

      const stateAfter = useConceptMapStore.getState();
      expect(stateAfter.semantic.concepts[nodeA].label).toBe('Latest Unflushed Edit');
    });

    it('Scenario 1.5: Window beforeunload event simulation flushes pending snapshot', async () => {
      class MockWindow extends EventTarget {
        localStorage = mockStorage;
      }
      const testWin = new MockWindow();
      const origWin = (globalThis as any).window;
      (globalThis as any).window = testWin;
      (globalThis as any).localStorage = mockStorage;

      vi.resetModules();
      const isolatedStore = await import('../src/store/useConceptMapStore');
      const store = isolatedStore.useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'flowchart');
      const nodeId = store.addConcept('Unload Node', { x: 100, y: 100 });

      // Edit without advancing debounce timer
      isolatedStore.useConceptMapStore.getState().updateConceptLabel(nodeId, 'Edited Before Unload');

      // Dispatch beforeunload event on window
      testWin.dispatchEvent(new Event('beforeunload'));

      // Storage must have been updated synchronously without waiting for debounce timeout
      const raw = storageMap[isolatedStore.AUTOSAVE_STORAGE_KEY];
      expect(raw).toBeTruthy();
      const doc = JSON.parse(raw!) as ConceptMapDocument;
      expect(doc.semantic.concepts[nodeId].label).toBe('Edited Before Unload');

      (globalThis as any).window = origWin;
    });

    it('Scenario 1.6: QuotaExceededError or storage error is handled gracefully without throwing', () => {
      const quotaStorage = {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError: DOM Exception 22');
        },
        removeItem: () => {},
        clear: () => {},
      };
      (globalThis as any).localStorage = quotaStorage;
      (globalThis as any).window.localStorage = quotaStorage;

      const store = useConceptMapStore.getState();
      expect(() => {
        store.addConcept('Will exceed quota', { x: 10, y: 10 });
        store.saveDraftToLocalStorage();
      }).not.toThrow();
    });

    it('Scenario 1.7: createNewEmptyMap(false) while debounce timer is active', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('Old Map Concept', { x: 100, y: 100 });
      setItemSpy.mockClear();

      // Mutate node (triggers debounced save in 300ms)
      useConceptMapStore.getState().updateConceptLabel(nodeA, 'Pending Edit in Old Map');

      // 100ms later (timer still pending), user creates an empty map
      vi.advanceTimersByTime(100);
      useConceptMapStore.getState().createNewEmptyMap(false, 'concept-map');

      // 300ms later, timer fires and persists recovery snapshot safely
      vi.advanceTimersByTime(300);
      const raw = storageMap[AUTOSAVE_STORAGE_KEY];
      expect(raw).toBeTruthy();
      const doc = JSON.parse(raw!);
      expect(doc.semantic.concepts[nodeA].label).toBe('Pending Edit in Old Map');
    });

    it('Scenario 1.8: restoreDraftFromLocalStorage returns false gracefully on corrupted JSON or missing draft', () => {
      // 1. Missing draft
      delete storageMap[AUTOSAVE_STORAGE_KEY];
      expect(useConceptMapStore.getState().restoreDraftFromLocalStorage()).toBe(false);

      // 2. Corrupted JSON string
      storageMap[AUTOSAVE_STORAGE_KEY] = '{"invalidJson: [unclosed';
      expect(useConceptMapStore.getState().restoreDraftFromLocalStorage()).toBe(false);
    });
  });

  // ============================================================================
  // SUITE 2: moveNodes Reference Stability & Handle Preservation
  // ============================================================================
  describe('Suite 2: moveNodes Reference Stability & Handle Preservation', () => {
    beforeEach(() => {
      useConceptMapStore.getState().createNewEmptyMap(false, 'flowchart');
    });

    it('Scenario 2.1: Freeform mode maintains strict state.visual.edges object identity (===) on node move', () => {
      const store = useConceptMapStore.getState();
      store.setFreeformCanvas(true);

      const n1 = store.addConcept('Node 1', { x: 100, y: 100 });
      const n2 = store.addConcept('Node 2', { x: 100, y: 300 });
      const n3 = store.addConcept('Node 3', { x: 300, y: 300 });

      const rel1 = store.addRelation(n1, n2, 'to 2', 'sequence', {
        sourceHandle: 'bottom',
        targetHandle: 'top',
        manualHandles: true,
      });
      const rel2 = store.addRelation(n2, n3, 'to 3', 'sequence', {
        sourceHandle: 'right',
        targetHandle: 'left',
        manualHandles: false,
      });

      const initialEdges = useConceptMapStore.getState().visual.edges;

      // Move Node 2 violent movements
      store.moveNodes([
        { conceptId: n2, position: { x: 900, y: -400 } },
      ]);

      const stateAfter = useConceptMapStore.getState();
      // Identity MUST be identical (no re-allocation of edges object)
      expect(stateAfter.visual.edges).toBe(initialEdges);
      expect(stateAfter.visual.edges[rel1!].sourceHandle).toBe('bottom');
      expect(stateAfter.visual.edges[rel1!].targetHandle).toBe('top');
      expect(stateAfter.visual.edges[rel2!].sourceHandle).toBe('right');
      expect(stateAfter.visual.edges[rel2!].targetHandle).toBe('left');
    });

    it('Scenario 2.2: Standard mode maintains edges object identity (===) when all incident edges are manual', () => {
      const store = useConceptMapStore.getState();
      store.setFreeformCanvas(false);

      const n1 = store.addConcept('A', { x: 100, y: 100 });
      const n2 = store.addConcept('B', { x: 100, y: 300 });

      const rel1 = store.addRelation(n1, n2, 'manual link', 'sequence', {
        sourceHandle: 'left',
        targetHandle: 'right',
        manualHandles: true,
      });

      const edgesBefore = useConceptMapStore.getState().visual.edges;

      // Move Node B
      store.moveNodes([{ conceptId: n2, position: { x: 500, y: 500 } }]);

      const edgesAfter = useConceptMapStore.getState().visual.edges;
      expect(edgesAfter).toBe(edgesBefore);
      expect(edgesAfter[rel1!].sourceHandle).toBe('left');
      expect(edgesAfter[rel1!].targetHandle).toBe('right');
    });

    it('Scenario 2.3: Standard mode maintains edges object identity (===) when moving a disconnected node', () => {
      const store = useConceptMapStore.getState();
      store.setFreeformCanvas(false);

      const n1 = store.addConcept('Connected 1', { x: 100, y: 100 });
      const n2 = store.addConcept('Connected 2', { x: 100, y: 300 });
      store.addRelation(n1, n2, 'rel', 'sequence'); // auto handles

      const isolatedNode = store.addConcept('Isolated', { x: 600, y: 600 });
      const edgesBefore = useConceptMapStore.getState().visual.edges;

      // Move isolated node
      store.moveNodes([{ conceptId: isolatedNode, position: { x: 800, y: 800 } }]);

      const edgesAfter = useConceptMapStore.getState().visual.edges;
      expect(edgesAfter).toBe(edgesBefore);
    });

    it('Scenario 2.4: Standard mode maintains edges object identity (===) when move produces identical smart handles', () => {
      const store = useConceptMapStore.getState();
      store.setFreeformCanvas(false);

      const n1 = store.addConcept('Top Node', { x: 200, y: 100 });
      const n2 = store.addConcept('Bottom Node', { x: 200, y: 400 });
      const relId = store.addRelation(n1, n2, 'downwards', 'sequence'); // auto: top->bottom produces sourceHandle='bottom', targetHandle='top'

      const edgesBefore = useConceptMapStore.getState().visual.edges;
      expect(edgesBefore[relId!].sourceHandle).toBe('bottom');
      expect(edgesBefore[relId!].targetHandle).toBe('top');

      // Move Bottom Node slightly down (e.g. y: 400 -> y: 450), keeping same vertical orientation
      store.moveNodes([{ conceptId: n2, position: { x: 200, y: 450 } }]);

      const edgesAfter = useConceptMapStore.getState().visual.edges;
      // Smart handles did not change ('bottom' and 'top' still optimal), so edges reference is preserved
      expect(edgesAfter).toBe(edgesBefore);
    });

    it('Scenario 2.5: Standard mode updates handles and allocates new edges object when orientation inverts', () => {
      const store = useConceptMapStore.getState();
      store.setFreeformCanvas(false);

      const n1 = store.addConcept('Source', { x: 200, y: 200 });
      const n2 = store.addConcept('Target', { x: 200, y: 500 });
      const relId = store.addRelation(n1, n2, 'link', 'sequence');

      const edgesBefore = useConceptMapStore.getState().visual.edges;
      expect(edgesBefore[relId!].sourceHandle).toBe('bottom');
      expect(edgesBefore[relId!].targetHandle).toBe('top');

      // Move Target ABOVE Source (y: 500 -> y: 50)
      store.moveNodes([{ conceptId: n2, position: { x: 200, y: 50 } }]);

      const edgesAfter = useConceptMapStore.getState().visual.edges;
      expect(edgesAfter).not.toBe(edgesBefore);
      // Source is now below target, so smart handle re-routes via flowchart return path
      expect(edgesAfter[relId!].sourceHandle).toBe('right');
      expect(edgesAfter[relId!].targetHandle).toBe('right');
    });
  });

  // ============================================================================
  // SUITE 3: computeSemanticGraphMetrics BFS Stress & Algorithmic Correctness
  // ============================================================================
  describe('Suite 3: computeSemanticGraphMetrics BFS Performance & Correctness', () => {
    it('Scenario 3.1: Large linear chain (N=1,000 concepts) executes in < 20ms with exact depth progression', () => {
      const N = 1000;
      const conceptOrder: ConceptId[] = [];
      const concepts: Record<ConceptId, any> = {};
      const relationOrder: string[] = [];
      const relations: Record<string, any> = {};

      for (let i = 0; i < N; i++) {
        const id = `node-${i}`;
        conceptOrder.push(id);
        concepts[id] = { id, label: `Node ${i}`, key: `node-${i}` };
      }

      for (let i = 0; i < N - 1; i++) {
        const relId = `rel-${i}`;
        relationOrder.push(relId);
        relations[relId] = {
          id: relId,
          sourceId: `node-${i}`,
          targetId: `node-${i + 1}`,
          type: 'hierarchical',
          label: 'leads to',
        };
      }

      const model: SemanticModel = {
        title: 'Linear 1000 Chain',
        diagramMode: 'concept-map',
        concepts,
        relations,
        conceptOrder,
        relationOrder,
      };

      const t0 = performance.now();
      const metrics = computeSemanticGraphMetrics(model);
      const elapsed = performance.now() - t0;

      expect(elapsed).toBeLessThan(50); // fast pointer BFS execution
      expect(metrics.totalConcepts).toBe(1000);
      expect(metrics.totalRelations).toBe(999);
      expect(metrics.rootConceptIds).toEqual(['node-0']);
      expect(metrics.leafConceptIds).toEqual(['node-999']);
      expect(metrics.isConnected).toBe(true);
      expect(metrics.hasDirectedCycles).toBe(false);
      expect(metrics.hasHierarchicalCycles).toBe(false);

      // Verify depths progression: node-0 -> 0, node-1 -> 1, ..., node-999 -> 999
      expect(metrics.hierarchicalDepthById['node-0']).toBe(0);
      expect(metrics.hierarchicalDepthById['node-500']).toBe(500);
      expect(metrics.hierarchicalDepthById['node-999']).toBe(999);
    });

    it('Scenario 3.2: Dense cyclic graph terminates safely without infinite loops or stack overflow', () => {
      const N = 100;
      const conceptOrder: ConceptId[] = [];
      const concepts: Record<ConceptId, any> = {};
      const relationOrder: string[] = [];
      const relations: Record<string, any> = {};

      for (let i = 0; i < N; i++) {
        const id = `cycle-node-${i}`;
        conceptOrder.push(id);
        concepts[id] = { id, label: `Node ${i}` };
      }

      // Create a cycle with cross connections and feedback loops
      let rCount = 0;
      for (let i = 0; i < N; i++) {
        const next = (i + 1) % N;
        const relId = `rel-${rCount++}`;
        relationOrder.push(relId);
        relations[relId] = {
          id: relId,
          sourceId: `cycle-node-${i}`,
          targetId: `cycle-node-${next}`,
          type: 'hierarchical',
        };

        // Add feedback skip-connection every 5 nodes
        if (i % 5 === 0 && i > 0) {
          const skipId = `rel-${rCount++}`;
          relationOrder.push(skipId);
          relations[skipId] = {
            id: skipId,
            sourceId: `cycle-node-${i}`,
            targetId: `cycle-node-0`,
            type: 'hierarchical',
          };
        }
      }

      const model: SemanticModel = {
        title: 'Tangled Cyclic Graph',
        diagramMode: 'flowchart',
        concepts,
        relations,
        conceptOrder,
        relationOrder,
      };

      const t0 = performance.now();
      const metrics = computeSemanticGraphMetrics(model);
      const elapsed = performance.now() - t0;

      expect(elapsed).toBeLessThan(50);
      expect(metrics.hasDirectedCycles).toBe(true);
      expect(metrics.hasHierarchicalCycles).toBe(true);
      // Depths must all be finite and <= N
      for (const id of conceptOrder) {
        expect(metrics.hierarchicalDepthById[id]).toBeDefined();
        expect(metrics.hierarchicalDepthById[id]).toBeLessThanOrEqual(N);
      }
    });

    it('Scenario 3.3: Wide branching tree (1 root, 1,000 children) computes in < 15ms', () => {
      const N = 1000;
      const rootId = 'root-node';
      const conceptOrder: ConceptId[] = [rootId];
      const concepts: Record<ConceptId, any> = { [rootId]: { id: rootId, label: 'Root' } };
      const relationOrder: string[] = [];
      const relations: Record<string, any> = {};

      for (let i = 1; i <= N; i++) {
        const childId = `child-${i}`;
        conceptOrder.push(childId);
        concepts[childId] = { id: childId, label: `Child ${i}` };

        const relId = `rel-root-${i}`;
        relationOrder.push(relId);
        relations[relId] = {
          id: relId,
          sourceId: rootId,
          targetId: childId,
          type: 'hierarchical',
        };
      }

      const model: SemanticModel = {
        title: 'Wide Branching',
        diagramMode: 'concept-map',
        concepts,
        relations,
        conceptOrder,
        relationOrder,
      };

      const t0 = performance.now();
      const metrics = computeSemanticGraphMetrics(model);
      const elapsed = performance.now() - t0;

      expect(elapsed).toBeLessThan(30);
      expect(metrics.rootConceptIds).toEqual([rootId]);
      expect(metrics.leafConceptIds.length).toBe(N);
      expect(metrics.hierarchicalDepthById[rootId]).toBe(0);
      for (let i = 1; i <= 20; i++) {
        expect(metrics.hierarchicalDepthById[`child-${i}`]).toBe(1);
      }
    });

    it('Scenario 3.4: Disconnected components correctly reports isConnected === false', () => {
      const conceptOrder: ConceptId[] = ['a1', 'a2', 'b1', 'b2'];
      const concepts: Record<ConceptId, any> = {
        a1: { id: 'a1', label: 'A1' },
        a2: { id: 'a2', label: 'A2' },
        b1: { id: 'b1', label: 'B1' },
        b2: { id: 'b2', label: 'B2' },
      };
      const relationOrder = ['rel-a', 'rel-b'];
      const relations: Record<string, any> = {
        'rel-a': { id: 'rel-a', sourceId: 'a1', targetId: 'a2', type: 'hierarchical' },
        'rel-b': { id: 'rel-b', sourceId: 'b1', targetId: 'b2', type: 'hierarchical' },
      };

      const model: SemanticModel = {
        title: 'Disconnected',
        diagramMode: 'concept-map',
        concepts,
        relations,
        conceptOrder,
        relationOrder,
      };

      const metrics = computeSemanticGraphMetrics(model);
      expect(metrics.isConnected).toBe(false);
      expect(metrics.rootConceptIds).toEqual(['a1', 'b1']);
      expect(metrics.leafConceptIds).toEqual(['a2', 'b2']);
    });

    it('Scenario 3.5: Degenerate graphs (0 nodes, 1 node, self loops) compute cleanly', () => {
      const emptyModel: SemanticModel = {
        title: 'Empty',
        diagramMode: 'concept-map',
        concepts: {},
        relations: {},
        conceptOrder: [],
        relationOrder: [],
      };
      const mEmpty = computeSemanticGraphMetrics(emptyModel);
      expect(mEmpty.totalConcepts).toBe(0);
      expect(mEmpty.isConnected).toBe(true);

      const singleNodeModel: SemanticModel = {
        title: 'Single Node',
        diagramMode: 'concept-map',
        concepts: { solo: { id: 'solo', label: 'Solo' } },
        relations: {},
        conceptOrder: ['solo'],
        relationOrder: [],
      };
      const mSingle = computeSemanticGraphMetrics(singleNodeModel);
      expect(mSingle.totalConcepts).toBe(1);
      expect(mSingle.isConnected).toBe(true);
      expect(mSingle.rootConceptIds).toEqual(['solo']);
      expect(mSingle.leafConceptIds).toEqual(['solo']);

      const selfLoopModel: SemanticModel = {
        title: 'Self Loop',
        diagramMode: 'flowchart',
        concepts: { loop: { id: 'loop', label: 'Loop' } },
        relations: {
          'rel-self': { id: 'rel-self', sourceId: 'loop', targetId: 'loop', type: 'loop-back' },
        },
        conceptOrder: ['loop'],
        relationOrder: ['rel-self'],
      };
      const mLoop = computeSemanticGraphMetrics(selfLoopModel);
      expect(mLoop.hasDirectedCycles).toBe(true);
      expect(mLoop.loopBackCount).toBe(1);
    });
  });

  // ============================================================================
  // SUITE 4: markdownParser.ts Table Parsing & Shape Mappings Stress Testing
  // ============================================================================
  describe('Suite 4: Markdown Parser Table Splitting & Shape Normalization', () => {
    it('Scenario 4.1: splitMarkdownTableRow handles escaped pipes \\| inside labels without breaking columns', () => {
      const line = '| Conceito Principal \\| Detalhe A | se divide em | Subconceito B \\| Tipo 2 |';
      const cells = splitMarkdownTableRow(line);

      expect(cells).toHaveLength(3);
      expect(cells[0]).toBe('Conceito Principal | Detalhe A');
      expect(cells[1]).toBe('se divide em');
      expect(cells[2]).toBe('Subconceito B | Tipo 2');
    });

    it('Scenario 4.2: splitMarkdownTableRow handles missing outer pipes and uneven whitespace', () => {
      const line = '  Origem Sem Pipe  |   Verbo de Ligacao   | Destino Sem Pipe   ';
      const cells = splitMarkdownTableRow(line);

      expect(cells).toHaveLength(3);
      expect(cells[0]).toBe('Origem Sem Pipe');
      expect(cells[1]).toBe('Verbo de Ligacao');
      expect(cells[2]).toBe('Destino Sem Pipe');
    });

    it('Scenario 4.3: isTableSeparatorLine recognizes diverse valid markdown separators and rejects non-separators', () => {
      // Valid table separators
      expect(isTableSeparatorLine('|---|---|---|')).toBe(true);
      expect(isTableSeparatorLine('|:---|:---:|---:|')).toBe(true);
      expect(isTableSeparatorLine('| :-- | :--: | --: |')).toBe(true);
      expect(isTableSeparatorLine('---|---|---')).toBe(true);
      expect(isTableSeparatorLine('| ------ | ---- | ---------- |')).toBe(true);

      // Invalid / non-table separators
      expect(isTableSeparatorLine('---')).toBe(false); // Frontmatter delimiter or HR
      expect(isTableSeparatorLine('-----------------')).toBe(false); // HR
      expect(isTableSeparatorLine('| Conceito A | Conceito B |')).toBe(false);
      expect(isTableSeparatorLine('Texto com hifen - e outro - hifen')).toBe(false);
      expect(isTableSeparatorLine('| - | - |')).toBe(false); // Less than 2 hyphens
    });

    it('Scenario 4.4: normalizeNodeShapeString resolves all canonical shapes with Portuguese accents, case variations and delimiters', () => {
      const tests: Array<{ input: string; expected: FlowchartNodeShape | null }> = [
        { input: 'início', expected: 'terminal' },
        { input: 'TÉRMINO', expected: 'terminal' },
        { input: 'Start', expected: 'terminal' },
        { input: 'Fim', expected: 'terminal' },
        { input: 'processo', expected: 'process' },
        { input: 'Etapa', expected: 'process' },
        { input: 'AÇÃO', expected: 'process' },
        { input: 'decisão', expected: 'decision' },
        { input: 'DECISAO', expected: 'decision' },
        { input: 'desvio', expected: 'decision' },
        { input: 'teste', expected: 'decision' },
        { input: 'escolha', expected: 'decision' },
        { input: 'entrada/saida', expected: 'io' },
        { input: 'ENTRADA E SAIDA', expected: 'io' },
        { input: 'i/o', expected: 'io' },
        { input: 'E/S', expected: 'io' },
        { input: 'Input/Output', expected: 'io' },
        { input: 'sub-rotina', expected: 'subroutine' },
        { input: 'subrotina', expected: 'subroutine' },
        { input: 'Subprocesso', expected: 'subroutine' },
        { input: 'Procedimento', expected: 'subroutine' },
        { input: 'documento', expected: 'document' },
        { input: 'RELATÓRIO', expected: 'document' },
        { input: 'Comprovante', expected: 'document' },
        { input: 'conceito', expected: 'concept' },
        { input: 'Desconhecido Totalmente Invalido', expected: null },
      ];

      for (const { input, expected } of tests) {
        const result = normalizeNodeShapeString(input);
        expect(result).toBe(expected);
      }
    });

    it('Scenario 4.5: extractShapeFromLabel extracts Mermaid syntax delimiters and prefix/suffix tags', () => {
      // Mermaid delimiters
      expect(extractShapeFromLabel('[[Subprocesso de Auditoria]]')).toEqual({
        cleanLabel: 'Subprocesso de Auditoria',
        shape: 'subroutine',
        rawShapeTag: '[[...]]',
      });

      expect(extractShapeFromLabel('{Aprovar Financiamento?}')).toEqual({
        cleanLabel: 'Aprovar Financiamento?',
        shape: 'decision',
        rawShapeTag: '{...}',
      });

      expect(extractShapeFromLabel('([Ponto de Partida])')).toEqual({
        cleanLabel: 'Ponto de Partida',
        shape: 'terminal',
        rawShapeTag: '([...])',
      });

      expect(extractShapeFromLabel('[/Entrada de Dados/]' )).toEqual({
        cleanLabel: 'Entrada de Dados',
        shape: 'io',
        rawShapeTag: '[/.../]',
      });

      expect(extractShapeFromLabel('[\\Saída de Nota\\]')).toEqual({
        cleanLabel: 'Saída de Nota',
        shape: 'io',
        rawShapeTag: '[/.../]',
      });

      // Prefix inline tags (rawShapeTag extracts the matched tag token)
      expect(extractShapeFromLabel('[Decisão] Verificar Estoque')).toEqual({
        cleanLabel: 'Verificar Estoque',
        shape: 'decision',
        rawShapeTag: 'Decisão',
      });

      expect(extractShapeFromLabel('(Processo): Executar Transação')).toEqual({
        cleanLabel: 'Executar Transação',
        shape: 'process',
        rawShapeTag: 'Processo',
      });

      // Suffix inline tags
      expect(extractShapeFromLabel('Emitir Relatório Fiscal [Documento]')).toEqual({
        cleanLabel: 'Emitir Relatório Fiscal',
        shape: 'document',
        rawShapeTag: 'Documento',
      });

      // Standard label without shape tag
      expect(extractShapeFromLabel('Conceito Comum Sem Tag')).toEqual({
        cleanLabel: 'Conceito Comum Sem Tag',
      });

      // Unclosed bracket or normal brackets
      expect(extractShapeFromLabel('[Texto Comum')).toEqual({
        cleanLabel: '[Texto Comum',
      });
    });

    it('Scenario 4.6: parseConceptMapMarkdown parses complete complex markdown with table, escaped pipes, and shape tags', () => {
      const md = `---
title: Teste Completo de Parser
modo: flowchart
---

# Fluxograma com Casos de Borda

| Origem | Relação | Destino | Tipo |
| :--- | :--- | :--- | :--- |
| ([Início do Fluxo]) | inicia | [Processo] Coletar Dados \\| Etapa 1 | sequencial |
| [Processo] Coletar Dados \\| Etapa 1 | envia | {Validar Dados?} | sequencial |
| {Validar Dados?} | se válido | [[Subprocesso de Gravação]] | condicional |
| {Validar Dados?} | se inválido | [/Notificar Usuário/] | condicional |
| [[Subprocesso de Gravação]] | gera | Emitir Recibo [Documento] | sequencial |
| [/Notificar Usuário/] | retorna | ([Início do Fluxo]) | retorno |
`;

      const res = parseConceptMapMarkdown(md);
      expect(res.semantic.diagramMode).toBe('flowchart');
      expect(res.semantic.title).toBe('Teste Completo de Parser');
      expect(res.semantic.conceptOrder.length).toBe(6);
      expect(res.semantic.relationOrder.length).toBe(6);

      // Check extracted shapes
      const concepts = Object.values(res.semantic.concepts);
      const shapesByLabel: Record<string, string | undefined> = {};
      for (const c of concepts) {
        shapesByLabel[c.label] = c.nodeShape;
      }

      expect(shapesByLabel['Início do Fluxo']).toBe('terminal');
      expect(shapesByLabel['Coletar Dados | Etapa 1']).toBe('process');
      expect(shapesByLabel['Validar Dados?']).toBe('decision');
      expect(shapesByLabel['Subprocesso de Gravação']).toBe('subroutine');
      expect(shapesByLabel['Notificar Usuário']).toBe('io');
      expect(shapesByLabel['Emitir Recibo']).toBe('document');

      // Check graph metrics
      expect(res.metrics.hasDirectedCycles).toBe(true); // Return relation creates a cycle
      expect(res.metrics.totalRelations).toBe(6);
      expect(res.metrics.totalConcepts).toBe(6);
    });
  });
});
