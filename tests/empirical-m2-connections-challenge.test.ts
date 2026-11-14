import { describe, expect, it } from 'vitest';
import {
  Position,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  MarkerType,
  type Connection,
  type Edge,
} from '@xyflow/react';
import {
  handleToPosition,
  getFlowchartConditionType,
} from '../src/components/canvas/PropositionEdge';
import {
  FLOWCHART_SHAPES_CONFIG,
  getShapeMeta,
} from '../src/components/canvas/shapeDefinitions';
import { useConceptMapStore } from '../src/store/useConceptMapStore';
import type {
  ArrowDirection,
  FlowchartNodeShape,
  HandlePosition,
} from '../src/domain/types';

describe('Empirical M2 Challenge: 16 Cardinal Handles, Curve Geometry & Markers', () => {
  const CARDINAL_HANDLES: readonly HandlePosition[] = [
    'top',
    'right',
    'bottom',
    'left',
  ] as const;

  // ==========================================================================
  // CHALLENGE 1: Exit & Entry Tangent Vector Oracle across 16 Combinations x 6 Spatial Orientations (96 Geometries)
  // ==========================================================================
  describe('Challenge 1: Geometric Tangent Oracle across all 16 Cardinal Combinations', () => {
    // 4 spatial quadrants to challenge all 2D relative placements
    const QUADRANT_CONFIGS = [
      { name: 'Bottom-Right (dx>0, dy>0)', s: { x: 100, y: 100 }, t: { x: 500, y: 400 } },
      { name: 'Top-Left (dx<0, dy<0)', s: { x: 500, y: 400 }, t: { x: 100, y: 100 } },
      { name: 'Bottom-Left (dx<0, dy>0)', s: { x: 500, y: 100 }, t: { x: 100, y: 400 } },
      { name: 'Top-Right (dx>0, dy<0)', s: { x: 100, y: 400 }, t: { x: 500, y: 100 } },
    ];

    const COLLINEAR_CONFIGS = [
      { name: 'Collinear Horizontal (dy=0)', s: { x: 100, y: 250 }, t: { x: 600, y: 250 } },
      { name: 'Collinear Vertical (dx=0)', s: { x: 300, y: 100 }, t: { x: 300, y: 600 } },
    ];

    it('empirically verifies exit and entry tangent vectors for getBezierPath across all 4 quadrants (64 combinations)', () => {
      let evaluatedCount = 0;

      for (const config of QUADRANT_CONFIGS) {
        for (const srcHandle of CARDINAL_HANDLES) {
          for (const tgtHandle of CARDINAL_HANDLES) {
            const srcPos = handleToPosition(srcHandle);
            const tgtPos = handleToPosition(tgtHandle);

            const [path, lx, ly] = getBezierPath({
              sourceX: config.s.x,
              sourceY: config.s.y,
              sourcePosition: srcPos,
              targetX: config.t.x,
              targetY: config.t.y,
              targetPosition: tgtPos,
              curvature: 0.25,
            });

            // Path must start at source and contain cubic bezier command C
            expect(path).toMatch(new RegExp(`^M\\s*${config.s.x}[,\\s]+${config.s.y}`));
            expect(Number.isFinite(lx)).toBe(true);
            expect(Number.isFinite(ly)).toBe(true);

            // Extract cubic bezier control points: M sx,sy C c1x,c1y c2x,c2y tx,ty
            const match = path.match(
              /M\s*([\d.-]+)[,\s]+([\d.-]+)\s*C\s*([\d.-]+)[,\s]+([\d.-]+)\s*([\d.-]+)[,\s]+([\d.-]+)\s*([\d.-]+)[,\s]+([\d.-]+)/i
            );
            expect(match).not.toBeNull();
            if (!match) continue;

            const sx = parseFloat(match[1]);
            const sy = parseFloat(match[2]);
            const c1x = parseFloat(match[3]);
            const c1y = parseFloat(match[4]);
            const c2x = parseFloat(match[5]);
            const c2y = parseFloat(match[6]);
            const tx = parseFloat(match[7]);
            const ty = parseFloat(match[8]);

            expect(sx).toBeCloseTo(config.s.x, 1);
            expect(sy).toBeCloseTo(config.s.y, 1);
            expect(tx).toBeCloseTo(config.t.x, 1);
            expect(ty).toBeCloseTo(config.t.y, 1);

            // Initial exit tangent: vExit = (c1x - sx, c1y - sy)
            const exitDx = c1x - sx;
            const exitDy = c1y - sy;

            switch (srcPos) {
              case Position.Top:
                // Exiting top must move upward (dy < 0)
                expect(exitDy).toBeLessThan(0);
                break;
              case Position.Bottom:
                // Exiting bottom must move downward (dy > 0)
                expect(exitDy).toBeGreaterThan(0);
                break;
              case Position.Left:
                // Exiting left must move leftward (dx < 0)
                expect(exitDx).toBeLessThan(0);
                break;
              case Position.Right:
                // Exiting right must move rightward (dx > 0)
                expect(exitDx).toBeGreaterThan(0);
                break;
            }

            // Final entry tangent: vEntry = (tx - c2x, ty - c2y)
            const entryDx = tx - c2x;
            const entryDy = ty - c2y;

            switch (tgtPos) {
              case Position.Top:
                // Entering top handle approaches from above, entering downward (entryDy > 0)
                expect(entryDy).toBeGreaterThan(0);
                break;
              case Position.Bottom:
                // Entering bottom handle approaches from below, entering upward (entryDy < 0)
                expect(entryDy).toBeLessThan(0);
                break;
              case Position.Left:
                // Entering left handle approaches from left, entering rightward (entryDx > 0)
                expect(entryDx).toBeGreaterThan(0);
                break;
              case Position.Right:
                // Entering right handle approaches from right, entering leftward (entryDx < 0)
                expect(entryDx).toBeLessThan(0);
                break;
            }

            evaluatedCount++;
          }
        }
      }

      expect(evaluatedCount).toBe(4 * 16); // 64 combinations verified
    });

    it('empirically verifies getBezierPath survives collinear configurations without NaN or zero-length degeneration', () => {
      for (const config of COLLINEAR_CONFIGS) {
        for (const srcHandle of CARDINAL_HANDLES) {
          for (const tgtHandle of CARDINAL_HANDLES) {
            const srcPos = handleToPosition(srcHandle);
            const tgtPos = handleToPosition(tgtHandle);

            const [path, lx, ly] = getBezierPath({
              sourceX: config.s.x,
              sourceY: config.s.y,
              sourcePosition: srcPos,
              targetX: config.t.x,
              targetY: config.t.y,
              targetPosition: tgtPos,
              curvature: 0.25,
            });

            expect(path).not.toContain('NaN');
            expect(Number.isFinite(lx)).toBe(true);
            expect(Number.isFinite(ly)).toBe(true);
          }
        }
      }
    });

    it('empirically verifies getSmoothStepPath generation and validity across all 96 geometries', () => {
      const ALL_CONFIGS = [...QUADRANT_CONFIGS, ...COLLINEAR_CONFIGS];
      let evaluatedCount = 0;

      for (const config of ALL_CONFIGS) {
        for (const srcHandle of CARDINAL_HANDLES) {
          for (const tgtHandle of CARDINAL_HANDLES) {
            const srcPos = handleToPosition(srcHandle);
            const tgtPos = handleToPosition(tgtHandle);

            const [path, lx, ly] = getSmoothStepPath({
              sourceX: config.s.x,
              sourceY: config.s.y,
              sourcePosition: srcPos,
              targetX: config.t.x,
              targetY: config.t.y,
              targetPosition: tgtPos,
              borderRadius: 12,
            });

            // Path must start at source and contain target coordinates without NaN
            expect(path).not.toContain('NaN');
            expect(path).toMatch(new RegExp(`^M\\s*${config.s.x}[,\\s]+${config.s.y}`));
            expect(path).toContain(`${config.t.x}`);
            expect(path).toContain(`${config.t.y}`);
            expect(Number.isFinite(lx)).toBe(true);
            expect(Number.isFinite(ly)).toBe(true);

            evaluatedCount++;
          }
        }
      }

      expect(evaluatedCount).toBe(96);
    });

    it('empirically verifies getStraightPath produces exact segments without distortion', () => {
      const ALL_CONFIGS = [...QUADRANT_CONFIGS, ...COLLINEAR_CONFIGS];
      for (const config of ALL_CONFIGS) {
        const [path, lx, ly] = getStraightPath({
          sourceX: config.s.x,
          sourceY: config.s.y,
          targetX: config.t.x,
          targetY: config.t.y,
        });

        expect(path).toMatch(new RegExp(`^M\\s*${config.s.x}[,\\s]+${config.s.y}L\\s*${config.t.x}[,\\s]+${config.t.y}`));
        expect(lx).toBe((config.s.x + config.t.x) / 2);
        expect(ly).toBe((config.s.y + config.t.y) / 2);
      }
    });
  });

  // ==========================================================================
  // CHALLENGE 2: handleToPosition Fuzzing, Boundary Conditions & Malicious Inputs
  // ==========================================================================
  describe('Challenge 2: handleToPosition Stress & Fuzzing', () => {
    it('returns exact Position enum for canonical handles', () => {
      expect(handleToPosition('top')).toBe(Position.Top);
      expect(handleToPosition('right')).toBe(Position.Right);
      expect(handleToPosition('bottom')).toBe(Position.Bottom);
      expect(handleToPosition('left')).toBe(Position.Left);
    });

    it('strictly returns specified fallback on invalid or non-canonical inputs', () => {
      const invalidInputs = [
        'TOP',
        'Right',
        'BOTTOM',
        'Left',
        'auto',
        'center',
        'middle',
        'diagonal',
        '',
        '   ',
        'null',
        'undefined',
        'toString',
        'valueOf',
        '__proto__',
        'constructor',
      ];

      for (const input of invalidInputs) {
        // Test with fallback = Position.Left
        expect(handleToPosition(input, Position.Left)).toBe(Position.Left);
        // Test with fallback = Position.Right
        expect(handleToPosition(input, Position.Right)).toBe(Position.Right);
        // Test with fallback = Position.Bottom
        expect(handleToPosition(input, Position.Bottom)).toBe(Position.Bottom);
        // Test with fallback = Position.Top
        expect(handleToPosition(input, Position.Top)).toBe(Position.Top);
      }
    });

    it('strictly returns default fallback Position.Top when no fallback is provided', () => {
      expect(handleToPosition(undefined)).toBe(Position.Top);
      expect(handleToPosition(null)).toBe(Position.Top);
      expect(handleToPosition('')).toBe(Position.Top);
      expect(handleToPosition('auto')).toBe(Position.Top);
    });
  });

  // ==========================================================================
  // CHALLENGE 3: Marker Calculations for Arrow Directions across Flowchart and Novak
  // ==========================================================================
  describe('Challenge 3: Marker Calculation Verification (markerStart / markerEnd)', () => {
    function computeFlowMarkers(
      arrowDirection: ArrowDirection | undefined,
      color: string = '#475569'
    ) {
      const resolvedDirection = arrowDirection ?? 'forward';
      const markerConfig = {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color,
      };

      const markerEnd =
        resolvedDirection === 'forward' || resolvedDirection === 'both'
          ? markerConfig
          : undefined;

      const markerStart =
        resolvedDirection === 'reverse' || resolvedDirection === 'both'
          ? markerConfig
          : undefined;

      return { markerStart, markerEnd };
    }

    it('verifies all 4 arrowDirection values produce mathematically correct markers', () => {
      // 1. Forward
      const fwd = computeFlowMarkers('forward', '#2563eb');
      expect(fwd.markerStart).toBeUndefined();
      expect(fwd.markerEnd).toEqual({
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: '#2563eb',
      });

      // 2. Reverse
      const rev = computeFlowMarkers('reverse', '#e11d48');
      expect(fwd.markerStart).toBeUndefined();
      expect(rev.markerStart).toEqual({
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: '#e11d48',
      });
      expect(rev.markerEnd).toBeUndefined();

      // 3. Both
      const both = computeFlowMarkers('both', '#059669');
      expect(both.markerStart).toEqual({
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: '#059669',
      });
      expect(both.markerEnd).toEqual({
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: '#059669',
      });

      // 4. None
      const none = computeFlowMarkers('none', '#475569');
      expect(none.markerStart).toBeUndefined();
      expect(none.markerEnd).toBeUndefined();

      // 5. Default fallback (undefined direction)
      const def = computeFlowMarkers(undefined, '#475569');
      expect(def.markerStart).toBeUndefined();
      expect(def.markerEnd).toBeDefined();
    });

    it('verifies flowchart condition color matching for markers', () => {
      const positiveLabels = ['Sim', 'sim', ' SIM ', 'true', 'True', 'v', 'V', 's', 'S', 'yes', 'Yes', 'verdadeiro'];
      for (const phrase of positiveLabels) {
        expect(getFlowchartConditionType(phrase)).toBe('positive');
      }

      const negativeLabels = ['Não', 'não', 'nao', 'Nao', 'false', 'False', 'f', 'F', 'n', 'N', 'no', 'No', 'falso'];
      for (const phrase of negativeLabels) {
        expect(getFlowchartConditionType(phrase)).toBe('negative');
      }

      const neutralLabels = ['talvez', 'próximo', 'processo 1', '', '   ', '123'];
      for (const phrase of neutralLabels) {
        expect(getFlowchartConditionType(phrase)).toBe('neutral');
      }
    });
  });

  // ==========================================================================
  // CHALLENGE 4: Connection Validation (isValidConnection) Exhaustive Fuzzing
  // ==========================================================================
  describe('Challenge 4: Canvas isValidConnection Invariant Fuzzing', () => {
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

    it('accepts all 16 cardinal combinations between distinct nodes', () => {
      for (const s of CARDINAL_HANDLES) {
        for (const t of CARDINAL_HANDLES) {
          expect(
            isValidConnection({
              source: 'node-1',
              target: 'node-2',
              sourceHandle: s,
              targetHandle: t,
            })
          ).toBe(true);
        }
      }
    });

    it('rejects self-connection when sourceHandle === targetHandle on same node', () => {
      for (const h of CARDINAL_HANDLES) {
        expect(
          isValidConnection({
            source: 'node-1',
            target: 'node-1',
            sourceHandle: h,
            targetHandle: h,
          })
        ).toBe(false);
      }
    });

    it('accepts self-loops connecting two distinct handles of the same node (12 permutations)', () => {
      let loopCount = 0;
      for (const s of CARDINAL_HANDLES) {
        for (const t of CARDINAL_HANDLES) {
          if (s !== t) {
            expect(
              isValidConnection({
                source: 'node-1',
                target: 'node-1',
                sourceHandle: s,
                targetHandle: t,
              })
            ).toBe(true);
            loopCount++;
          }
        }
      }
      expect(loopCount).toBe(12); // 4 * 3 = 12
    });

    it('rejects connections with missing or empty source / target IDs', () => {
      expect(isValidConnection({ source: '', target: 'node-2' })).toBe(false);
      expect(isValidConnection({ source: 'node-1', target: '' })).toBe(false);
      expect(isValidConnection({ source: null as unknown as string, target: 'node-2' })).toBe(false);
      expect(isValidConnection({ source: 'node-1', target: null as unknown as string })).toBe(false);
      expect(isValidConnection({ source: undefined as unknown as string, target: 'node-2' })).toBe(false);
    });
  });

  // ==========================================================================
  // CHALLENGE 5: Store Reconnection Simulation & Handle Preservation Invariant
  // ==========================================================================
  describe('Challenge 5: Reconnection & Multi-step Interaction Stress', () => {
    it('simulates canvas connection, edge reconnection, and violent moves preserving manual handles', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'flowchart');

      const n1 = store.addConcept('Origin', { x: 50, y: 50 });
      const n2 = store.addConcept('Mid', { x: 250, y: 200 });
      const n3 = store.addConcept('Target', { x: 500, y: 350 });

      // Step 1: Connect n1 (bottom) -> n2 (top) with manual handles
      const relId = store.addRelation(
        n1,
        n2,
        'step 1',
        'sequence',
        { sourceHandle: 'bottom', targetHandle: 'top', manualHandles: true },
        'forward'
      );
      expect(relId).toBeTruthy();
      if (!relId) return;

      let edge = useConceptMapStore.getState().visual.edges[relId];
      expect(edge.sourceHandle).toBe('bottom');
      expect(edge.targetHandle).toBe('top');
      expect(edge.manualHandles).toBe(true);

      // Step 2: Reconnect target endpoint to n3 (left handle), keeping n1 (right handle)
      store.reconnectRelation(relId, n1, n3, {
        sourceHandle: 'right',
        targetHandle: 'left',
        manualHandles: true,
      });

      edge = useConceptMapStore.getState().visual.edges[relId];
      let rel = useConceptMapStore.getState().semantic.relations[relId];
      expect(rel.sourceId).toBe(n1);
      expect(rel.targetId).toBe(n3);
      expect(edge.sourceHandle).toBe('right');
      expect(edge.targetHandle).toBe('left');
      expect(edge.manualHandles).toBe(true);

      // Step 3: Violent move of all 3 nodes
      store.moveNodes([
        { conceptId: n1, position: { x: -500, y: 1000 } },
        { conceptId: n3, position: { x: 2000, y: -800 } },
      ]);

      edge = useConceptMapStore.getState().visual.edges[relId];
      expect(edge.sourceHandle).toBe('right');
      expect(edge.targetHandle).toBe('left');
      expect(edge.manualHandles).toBe(true);

      // Step 4: Invert direction
      store.reverseRelationDirection(relId);
      edge = useConceptMapStore.getState().visual.edges[relId];
      rel = useConceptMapStore.getState().semantic.relations[relId];

      expect(rel.sourceId).toBe(n3);
      expect(rel.targetId).toBe(n1);
      expect(edge.sourceHandle).toBe('left');
      expect(edge.targetHandle).toBe('right');
      expect(edge.manualHandles).toBe(true);
    });
  });

  // ==========================================================================
  // CHALLENGE 6: Geometric Shape Definitions Completeness (7 Shapes)
  // ==========================================================================
  describe('Challenge 6: Canonical 7 Geometric Shape Definitions', () => {
    const EXPECTED_SHAPES: FlowchartNodeShape[] = [
      'terminal',
      'process',
      'decision',
      'io',
      'subroutine',
      'document',
      'concept',
    ];

    it('contains all 7 canonical shapes with active and inactive SVG renderers', () => {
      expect(FLOWCHART_SHAPES_CONFIG).toHaveLength(7);
      const shapesInConfig = FLOWCHART_SHAPES_CONFIG.map((c) => c.shape);

      for (const shape of EXPECTED_SHAPES) {
        expect(shapesInConfig).toContain(shape);
        const meta = getShapeMeta(shape);
        expect(meta.shape).toBe(shape);
        expect(meta.label).toBeTruthy();
        expect(meta.sublabel).toBeTruthy();

        // Verify SVG renderers don't throw
        const iconActive = meta.renderIcon(true);
        const iconInactive = meta.renderIcon(false);
        expect(iconActive).toBeDefined();
        expect(iconInactive).toBeDefined();
      }
    });

    it('gracefully handles non-existent shape fallback to terminal', () => {
      const fallback = getShapeMeta('invalid-shape' as FlowchartNodeShape);
      expect(fallback.shape).toBe('terminal');
      expect(fallback.label).toContain('Início');
    });
  });
});
