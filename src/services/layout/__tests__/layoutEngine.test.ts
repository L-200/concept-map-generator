import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LayoutAlgorithmType, VisualModel } from '../../../domain/types';
import { parseConceptMapMarkdown } from '../../parser/markdownParser';
import {
  computeConceptMapLayout,
  DEFAULT_LAYOUT_SETTINGS,
} from '../layoutEngine';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exemploPath = path.resolve(__dirname, '../../../../exemplo.md');

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
    expect(relaidOut.nodes['concept-reserva-ducke'].pinned).toBe(true);
  });
});
