import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ConceptId,
  ConceptMapDocument,
  HandlePosition,
  RelationId,
} from '../src/domain/types';
import {
  AUTOSAVE_STORAGE_KEY,
  useConceptMapStore,
} from '../src/store/useConceptMapStore';

describe('Adversarial Stress Test: Store Runtime Optimizations & Handle Preservation', () => {
  // ============================================================================
  // SUITE 1: Edge Reference Stability & Handle Preservation
  // ============================================================================
  describe('Suite 1: Edge Reference Stability (visual.edges ===)', () => {
    beforeEach(() => {
      useConceptMapStore.getState().createNewEmptyMap(false, 'flowchart');
    });

    it('Scenario 1.1: 200 consecutive node moves in Freeform mode strictly preserve visual.edges reference equality (===)', () => {
      const store = useConceptMapStore.getState();
      store.setFreeformCanvas(true);

      // Create a complex mesh: 10 nodes, 15 edges
      const nodeIds: ConceptId[] = [];
      for (let i = 0; i < 10; i++) {
        nodeIds.push(store.addConcept(`FreeNode ${i}`, { x: i * 80, y: i * 60 }));
      }

      const edgeIds: RelationId[] = [];
      for (let i = 0; i < 9; i++) {
        const relId = store.addRelation(nodeIds[i], nodeIds[i + 1], `step ${i}`, 'sequence', {
          sourceHandle: 'right',
          targetHandle: 'left',
          manualHandles: i % 2 === 0,
        });
        if (relId) edgeIds.push(relId);
      }
      for (let i = 0; i < 6; i++) {
        const relId = store.addRelation(nodeIds[i], nodeIds[9 - i], `cross ${i}`, 'conditional', {
          sourceHandle: 'bottom',
          targetHandle: 'top',
          manualHandles: true,
        });
        if (relId) edgeIds.push(relId);
      }

      // Initial visual.edges snapshot
      let currentEdges = useConceptMapStore.getState().visual.edges;
      expect(Object.keys(currentEdges).length).toBe(15);

      // Perform 200 random moves across all 10 nodes
      for (let step = 0; step < 200; step++) {
        const targetNode = nodeIds[step % nodeIds.length];
        const newX = ((step * 37) % 1500) - 500;
        const newY = ((step * 53) % 1500) - 500;

        useConceptMapStore.getState().moveNodes([{ conceptId: targetNode, position: { x: newX, y: newY } }]);

        const nextEdges = useConceptMapStore.getState().visual.edges;
        // In freeform mode, edges object MUST strictly preserve reference equality (===)
        expect(nextEdges).toBe(currentEdges);
        currentEdges = nextEdges;
      }
    });

    it('Scenario 1.2: Standard mode with 16 combinations of manual handle positions strictly preserves visual.edges (===) across moves', () => {
      const store = useConceptMapStore.getState();
      store.setFreeformCanvas(false); // standard mode

      const handles: HandlePosition[] = ['top', 'right', 'bottom', 'left'];

      // Test all 4x4 = 16 combinations of sourceHandle x targetHandle
      for (const sH of handles) {
        for (const tH of handles) {
          useConceptMapStore.getState().createNewEmptyMap(false, 'flowchart');
          const currentStore = useConceptMapStore.getState();

          const nA = currentStore.addConcept(`NodeA_${sH}`, { x: 200, y: 200 });
          const nB = currentStore.addConcept(`NodeB_${tH}`, { x: 200, y: 500 });

          const relId = currentStore.addRelation(nA, nB, 'manual connection', 'sequence', {
            sourceHandle: sH,
            targetHandle: tH,
            manualHandles: true,
          });
          expect(relId).toBeTruthy();

          const edgesSnapshot = useConceptMapStore.getState().visual.edges;
          expect(edgesSnapshot[relId!].manualHandles).toBe(true);
          expect(edgesSnapshot[relId!].sourceHandle).toBe(sH);
          expect(edgesSnapshot[relId!].targetHandle).toBe(tH);

          // Test 1: Move source node to extreme coordinates
          useConceptMapStore.getState().moveNodes([{ conceptId: nA, position: { x: -1000, y: 2000 } }]);
          let state = useConceptMapStore.getState();
          expect(state.visual.edges).toBe(edgesSnapshot);
          expect(state.visual.edges[relId!].sourceHandle).toBe(sH);
          expect(state.visual.edges[relId!].targetHandle).toBe(tH);

          // Test 2: Move target node to invert relative orientation
          useConceptMapStore.getState().moveNodes([{ conceptId: nB, position: { x: -2000, y: -500 } }]);
          state = useConceptMapStore.getState();
          expect(state.visual.edges).toBe(edgesSnapshot);
          expect(state.visual.edges[relId!].sourceHandle).toBe(sH);
          expect(state.visual.edges[relId!].targetHandle).toBe(tH);

          // Test 3: Batch move both nodes together
          useConceptMapStore.getState().moveNodes([
            { conceptId: nA, position: { x: 100, y: 100 } },
            { conceptId: nB, position: { x: 300, y: 300 } },
          ]);
          state = useConceptMapStore.getState();
          expect(state.visual.edges).toBe(edgesSnapshot);
          expect(state.visual.edges[relId!].sourceHandle).toBe(sH);
          expect(state.visual.edges[relId!].targetHandle).toBe(tH);
        }
      }
    });

    it('Scenario 1.3: Novak Concept Map mode preserves visual.edges (===) for manual handles', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'concept-map');
      store.setFreeformCanvas(false);

      const n1 = store.addConcept('Novak A', { x: 100, y: 100 });
      const n2 = store.addConcept('Novak B', { x: 100, y: 400 });

      const relId = store.addRelation(n1, n2, 'causes', 'hierarchical', {
        sourceHandle: 'left',
        targetHandle: 'right',
        manualHandles: true,
      });

      const initialEdges = useConceptMapStore.getState().visual.edges;
      expect(initialEdges[relId!].sourceHandle).toBe('left');
      expect(initialEdges[relId!].targetHandle).toBe('right');

      // Move node in Novak mode
      useConceptMapStore.getState().moveNodes([{ conceptId: n2, position: { x: 600, y: -200 } }]);

      const stateAfter = useConceptMapStore.getState();
      expect(stateAfter.visual.edges).toBe(initialEdges);
      expect(stateAfter.visual.edges[relId!].sourceHandle).toBe('left');
      expect(stateAfter.visual.edges[relId!].targetHandle).toBe('right');
    });

    it('Scenario 1.4: Mixed graph with manual, auto, and disconnected nodes preserves identity where appropriate', () => {
      const store = useConceptMapStore.getState();
      store.setFreeformCanvas(false);

      const nSrc = store.addConcept('SourceNode', { x: 300, y: 100 });
      const nManual = store.addConcept('ManualTarget', { x: 300, y: 300 });
      const nAuto = store.addConcept('AutoTarget', { x: 300, y: 600 });
      const nIsolated = store.addConcept('IsolatedNode', { x: 900, y: 900 });

      const relManual = store.addRelation(nSrc, nManual, 'manual', 'sequence', {
        sourceHandle: 'left',
        targetHandle: 'right',
        manualHandles: true,
      });
      const relAuto = store.addRelation(nSrc, nAuto, 'auto', 'sequence');

      const edgesBefore = useConceptMapStore.getState().visual.edges;

      // 1. Moving isolated node strictly preserves edges object identity
      store.moveNodes([{ conceptId: nIsolated, position: { x: 950, y: 950 } }]);
      expect(useConceptMapStore.getState().visual.edges).toBe(edgesBefore);

      // 2. Moving manual target strictly preserves edges object identity
      store.moveNodes([{ conceptId: nManual, position: { x: 100, y: 800 } }]);
      expect(useConceptMapStore.getState().visual.edges).toBe(edgesBefore);

      // 3. Moving auto target by small displacement that retains smart handles ('bottom' -> 'top')
      store.moveNodes([{ conceptId: nAuto, position: { x: 300, y: 650 } }]);
      expect(useConceptMapStore.getState().visual.edges).toBe(edgesBefore);

      // 4. Moving auto target above source forces smart handle recomputation
      store.moveNodes([{ conceptId: nAuto, position: { x: 300, y: 20 } }]);
      const edgesAfterInvert = useConceptMapStore.getState().visual.edges;
      expect(edgesAfterInvert).not.toBe(edgesBefore);

      // Verify that while relAuto handles adapted, relManual handles remained 100% untouched
      expect(edgesAfterInvert[relManual!].sourceHandle).toBe('left');
      expect(edgesAfterInvert[relManual!].targetHandle).toBe('right');
      expect(edgesAfterInvert[relManual!].manualHandles).toBe(true);
    });

    it('Scenario 1.5: Edge cases in moveNodes (empty moves, unknown conceptId) preserve state safely', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('ExistingNode', { x: 100, y: 100 });
      const edgesBefore = useConceptMapStore.getState().visual.edges;

      // Empty moves array: returns early without mutating
      store.moveNodes([]);
      expect(useConceptMapStore.getState().visual.edges).toBe(edgesBefore);

      // Move with non-existent conceptId: no crash, preserves edges identity
      store.moveNodes([{ conceptId: 'phantom-id' as ConceptId, position: { x: 50, y: 50 } }]);
      expect(useConceptMapStore.getState().visual.edges).toBe(edgesBefore);

      // Move with markPinned = false keeps node pinned status false
      expect(useConceptMapStore.getState().visual.nodes[n1].pinned).toBe(false);
      store.moveNodes([{ conceptId: n1, position: { x: 120, y: 120 } }], false);
      expect(useConceptMapStore.getState().visual.nodes[n1].pinned).toBe(false);

      // Move with default markPinned = true marks node as pinned
      store.moveNodes([{ conceptId: n1, position: { x: 150, y: 150 } }]);
      expect(useConceptMapStore.getState().visual.nodes[n1].pinned).toBe(true);
    });
  });

  // ============================================================================
  // SUITE 2: Debounced localStorage Persistence Stress Testing
  // ============================================================================
  describe('Suite 2: Debounced localStorage Persistence Stress & Flushes', () => {
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

    it('Scenario 2.1: 500 high-frequency mutations with erratic intervals generate ZERO disk writes until debounce quiescence', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('Stress Target', { x: 100, y: 100 });
      setItemSpy.mockClear();

      // 500 rapid mutations at intervals between 2ms and 150ms (< 300ms)
      for (let i = 1; i <= 500; i++) {
        useConceptMapStore.getState().updateConceptLabel(n1, `Label Version ${i}`);
        const advance = (i % 7) * 20; // 0, 20, 40, 60, 80, 100, 120ms
        vi.advanceTimersByTime(advance);
        expect(setItemSpy).not.toHaveBeenCalled();
      }

      // Quiescence period: wait remaining debounce duration (300ms)
      vi.advanceTimersByTime(300);

      // Exactly ONE write occurred for all 500 mutations combined
      expect(setItemSpy).toHaveBeenCalledTimes(1);

      const raw = storageMap[AUTOSAVE_STORAGE_KEY];
      expect(raw).toBeTruthy();
      const doc = JSON.parse(raw!) as ConceptMapDocument;
      expect(doc.semantic.concepts[n1].label).toBe('Label Version 500');

      // Further time passing generates NO ghost/redundant writes
      vi.advanceTimersByTime(2000);
      expect(setItemSpy).toHaveBeenCalledTimes(1);
    });

    it('Scenario 2.2: saveDraftToLocalStorage synchronously flushes immediately and aborts the pending debounce timer', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('Immediate Save Node', { x: 200, y: 200 });
      setItemSpy.mockClear();

      // Perform 10 rapid mutations
      for (let i = 1; i <= 10; i++) {
        useConceptMapStore.getState().updateConceptLabel(n1, `Fast Change ${i}`);
        vi.advanceTimersByTime(15);
      }
      expect(setItemSpy).not.toHaveBeenCalled();

      // User hits Ctrl+S / Save Draft
      useConceptMapStore.getState().saveDraftToLocalStorage();

      // Must be written synchronously on the spot
      expect(setItemSpy).toHaveBeenCalledTimes(1);
      let doc = JSON.parse(storageMap[AUTOSAVE_STORAGE_KEY]!) as ConceptMapDocument;
      expect(doc.semantic.concepts[n1].label).toBe('Fast Change 10');

      // Advance timers across previous debounce deadline: NO second write allowed!
      vi.advanceTimersByTime(500);
      expect(setItemSpy).toHaveBeenCalledTimes(1);
    });

    it('Scenario 2.3: restoreDraftFromLocalStorage flushes pending memory state before reading from storage', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('Unsaved Draft Before Restore', { x: 300, y: 300 });
      setItemSpy.mockClear();

      // Unsaved mutation in memory
      useConceptMapStore.getState().updateConceptLabel(n1, 'Pending Fresh In Memory');
      expect(setItemSpy).not.toHaveBeenCalled();

      // restoreDraftFromLocalStorage must flush pending state first, then load it
      const restored = useConceptMapStore.getState().restoreDraftFromLocalStorage();
      expect(restored).toBe(true);

      // setItem was called immediately during restore flush
      expect(setItemSpy).toHaveBeenCalledTimes(1);

      const stateAfter = useConceptMapStore.getState();
      expect(stateAfter.semantic.concepts[n1].label).toBe('Pending Fresh In Memory');

      // Advancing timer by 300ms allows loadFromDocument's persistence to settle
      vi.advanceTimersByTime(300);
      expect(setItemSpy).toHaveBeenCalledTimes(2);

      // Advancing further produces no more writes
      vi.advanceTimersByTime(500);
      expect(setItemSpy).toHaveBeenCalledTimes(2);
    });

    it('Scenario 2.4: markSaved flushes pending changes immediately, clears hasUnsavedChanges, and prevents trailing timer', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('MarkSaved Node', { x: 50, y: 50 });
      setItemSpy.mockClear();

      useConceptMapStore.getState().updateConceptLabel(n1, 'Saved Version');
      expect(useConceptMapStore.getState().hasUnsavedChanges).toBe(true);
      expect(setItemSpy).not.toHaveBeenCalled();

      useConceptMapStore.getState().markSaved();

      expect(setItemSpy).toHaveBeenCalledTimes(1);
      expect(useConceptMapStore.getState().hasUnsavedChanges).toBe(false);

      // Verify timers do not trigger another write
      vi.advanceTimersByTime(600);
      expect(setItemSpy).toHaveBeenCalledTimes(1);
      expect(useConceptMapStore.getState().hasUnsavedChanges).toBe(false);
    });

    it('Scenario 2.5: Multi-wave mutation interleaving with explicit flushes and debounced saves', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('Wave Concept', { x: 10, y: 10 });
      setItemSpy.mockClear();

      // Wave 1: Debounced save
      for (let i = 0; i < 5; i++) {
        store.updateConceptLabel(n1, `Wave 1 step ${i}`);
        vi.advanceTimersByTime(20);
      }
      expect(setItemSpy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300); // Debounce fires!
      expect(setItemSpy).toHaveBeenCalledTimes(1);

      // Wave 2: Explicit flush via saveDraftToLocalStorage
      for (let i = 0; i < 5; i++) {
        store.updateConceptLabel(n1, `Wave 2 step ${i}`);
        vi.advanceTimersByTime(20);
      }
      expect(setItemSpy).toHaveBeenCalledTimes(1);
      store.saveDraftToLocalStorage(); // Synchronous flush
      expect(setItemSpy).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(400); // No trailing timer
      expect(setItemSpy).toHaveBeenCalledTimes(2);

      // Wave 3: Explicit flush via markSaved
      for (let i = 0; i < 5; i++) {
        store.updateConceptLabel(n1, `Wave 3 step ${i}`);
        vi.advanceTimersByTime(20);
      }
      expect(setItemSpy).toHaveBeenCalledTimes(2);
      store.markSaved(); // Synchronous flush
      expect(setItemSpy).toHaveBeenCalledTimes(3);
      vi.advanceTimersByTime(400);
      expect(setItemSpy).toHaveBeenCalledTimes(3);
    });

    it('Scenario 2.6: Graceful recovery when localStorage throws QuotaExceededError or SecurityError', () => {
      let fail = true;
      const throwStorage = {
        getItem: () => null,
        setItem: () => {
          if (fail) throw new Error('QuotaExceededError: DOM Exception 22');
        },
        removeItem: () => {},
        clear: () => {},
      };
      (globalThis as any).localStorage = throwStorage;
      (globalThis as any).window.localStorage = throwStorage;

      const store = useConceptMapStore.getState();
      expect(() => {
        store.addConcept('Quota Throw Concept', { x: 100, y: 100 });
        store.saveDraftToLocalStorage();
      }).not.toThrow();

      // Now disable failure and verify persistence recovers
      fail = false;
      throwStorage.setItem = (key: string, val: string) => {
        storageMap[key] = val;
      };
      expect(() => {
        store.addConcept('Recovered Concept', { x: 200, y: 200 });
        store.saveDraftToLocalStorage();
      }).not.toThrow();
      expect(storageMap[AUTOSAVE_STORAGE_KEY]).toBeTruthy();
    });
  });
});
