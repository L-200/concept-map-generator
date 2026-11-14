import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { useConceptMapStore } from '../../../store/useConceptMapStore';
import { parseConceptMapMarkdown } from '../../parser/markdownParser';
import {
  escapeXml,
  exportAsPng,
  exportSemanticToMarkdown,
  generateStandaloneVectorSvg,
  parseAndValidateJsonDocument,
  serializeDocumentToJson,
} from '../fileExporter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exemploPath = path.resolve(__dirname, '../../../../exemplo.md');
const rawMarkdown = fs.readFileSync(exemploPath, 'utf-8');

describe('FileExporter & Persistência Completa (Etapas 6 e 7)', () => {
  beforeEach(async () => {
    await useConceptMapStore.getState().loadFromMarkdown(rawMarkdown, 'exemplo.md');
  });

  it('salva e reabre projeto JSON (.cmap.json) preservando 100% dos dados semânticos, posições manuais e pinos', () => {
    const store = useConceptMapStore.getState();

    // Realiza alterações manuais: move nó (marca pinned=true), redimensiona e edita frase
    store.moveNodes([
      { conceptId: 'concept-projeto-pop', position: { x: 777, y: 111 } },
    ]);
    store.resizeNode('concept-projeto-pop', { width: 260, height: 80 });
    store.updateRelation('rel-1', {
      linkingPhrase: 'propõe estrategicamente',
      type: 'cross-link',
    });

    const exportedDoc = useConceptMapStore.getState().exportDocument();
    const jsonString = serializeDocumentToJson(exportedDoc);

    // Valida e reimporta o JSON
    const validatedDoc = parseAndValidateJsonDocument(jsonString);
    useConceptMapStore.getState().loadFromDocument(validatedDoc);

    const restored = useConceptMapStore.getState();
    expect(restored.metrics.totalConcepts).toBe(32);
    expect(restored.metrics.totalRelations).toBe(46);
    expect(restored.visual.nodes['concept-projeto-pop'].position).toEqual({
      x: 777,
      y: 111,
    });
    expect(restored.visual.nodes['concept-projeto-pop'].pinned).toBe(true);
    expect(restored.visual.nodes['concept-projeto-pop'].dimensions).toEqual({
      width: 260,
      height: 80,
    });
    expect(restored.semantic.relations['rel-1'].linkingPhrase).toBe(
      'propõe estrategicamente'
    );
    expect(restored.semantic.relations['rel-1'].type).toBe('cross-link');
  });

  it('gera SVG vetorial autônomo contendo todos os 32 conceitos, 46 conexões e diferenciação hierárquica vs cruzada', () => {
    const state = useConceptMapStore.getState();
    const svg = generateStandaloneVectorSvg(state.semantic, state.visual);

    expect(svg).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('Projeto POP');
    expect(svg).toContain('Reserva Ducke');
    expect(svg).toContain('previsibilidade de');
    // Verifica que existem arestas tracejadas para ligações cruzadas
    expect(svg).toContain('stroke-dasharray="8 5"');

    const nodeMatches = svg.match(/class="concept-node"/g);
    const edgeMatches = svg.match(/id="edge-rel-/g);
    expect(nodeMatches).toHaveLength(32);
    expect(edgeMatches).toHaveLength(46);
  });

  it('escapa caracteres especiais XML (&, <, >, ", \') na exportação SVG sem corromper o documento', () => {
    const store = useConceptMapStore.getState();
    const id = store.addConcept('Fauna & Flora <Amazônica>', { x: 200, y: 200 });
    store.addRelation(id, 'concept-reserva-ducke', 'inclui "espécies" > 100');

    const state = useConceptMapStore.getState();
    const svg = generateStandaloneVectorSvg(state.semantic, state.visual);

    expect(svg).toContain('Fauna &amp; Flora');
    expect(svg).toContain('&lt;Amazônica&gt;');
    expect(svg).toContain('inclui &quot;espécies&quot; &gt;');
    expect(escapeXml(`A & B < C > "D" 'E'`)).toBe(
      'A &amp; B &lt; C &gt; &quot;D&quot; &apos;E&apos;'
    );
  });

  it('exporta tabela Markdown de 5 colunas refletindo edições manuais e mantendo compatibilidade round-trip', () => {
    const store = useConceptMapStore.getState();
    const newConceptId = store.addConcept('Monitoramento Satelital');
    store.addRelation(
      newConceptId,
      'concept-reserva-ducke',
      'vigia',
      'cross-link'
    );

    const md = exportSemanticToMarkdown(useConceptMapStore.getState().semantic);
    expect(md).toContain(
      '| 47 | Monitoramento Satelital | vigia | Reserva Ducke | ligação cruzada |'
    );

    const reparsed = parseConceptMapMarkdown(md);
    expect(reparsed.metrics.totalConcepts).toBe(33);
    expect(reparsed.metrics.totalRelations).toBe(47);
  });

  it('evita sobreposição de rótulos de conexões irmãs ao exportar novo-mapa.cmap.json para SVG', () => {
    const debugJsonPath = path.resolve(
      __dirname,
      './fixtures/novo-mapa.cmap.json'
    );
    const rawJson = fs.readFileSync(debugJsonPath, 'utf-8');
    const doc = parseAndValidateJsonDocument(rawJson);

    const svg = generateStandaloneVectorSvg(doc.semantic, doc.visual);

    // Extrai todas as caixas <rect> dos rótulos de aresta (.edge-label)
    const labelRectRegex =
      /<g class="edge-label"[^>]*>\s*<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g;
    const rects: Array<{ x: number; y: number; width: number; height: number }> =
      [];
    let match: RegExpExecArray | null;
    while ((match = labelRectRegex.exec(svg)) !== null) {
      rects.push({
        x: parseFloat(match[1]),
        y: parseFloat(match[2]),
        width: parseFloat(match[3]),
        height: parseFloat(match[4]),
      });
    }

    expect(rects).toHaveLength(5);

    // Verifica que nenhum par de rótulos de conexão se sobrepõe no SVG exportado
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlapsHorizontally =
          a.x < b.x + b.width && a.x + a.width > b.x;
        const overlapsVertically =
          a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlapsHorizontally && overlapsVertically).toBe(false);
      }
    }
  });

  describe('Milestone 3: Exportação Vetorial SVG & Raster PNG de Fluxogramas', () => {
    it('exporta todos os 6 formatos de nós de fluxograma para SVG com geometrias autênticas', () => {
      const store = useConceptMapStore.getState();
      store.setDiagramMode('flowchart');

      // Adiciona nós com os 6 formatos específicos
      const nTerm = store.addConcept('Início do Processo', { x: 100, y: 100 });
      store.updateNodeShape(nTerm, 'terminal');

      const nProc = store.addConcept('Executar Análise', { x: 100, y: 220 });
      store.updateNodeShape(nProc, 'process');

      const nDec = store.addConcept('Dados Válidos?', { x: 100, y: 340 });
      store.updateNodeShape(nDec, 'decision');

      const nIo = store.addConcept('Entrada de Dados', { x: 100, y: 460 });
      store.updateNodeShape(nIo, 'io');

      const nSub = store.addConcept('Módulo de Autenticação', { x: 100, y: 580 });
      store.updateNodeShape(nSub, 'subroutine');

      const nDoc = store.addConcept('Relatório Mensal', { x: 100, y: 700 });
      store.updateNodeShape(nDoc, 'document');

      const state = useConceptMapStore.getState();
      const svg = generateStandaloneVectorSvg(state.semantic, state.visual);

      // 1. Terminal: <rect rx="..." ry="..."> (estádio com cantos arredondados)
      expect(svg).toContain('data-shape="terminal"');
      expect(svg).toMatch(/<rect[^>]+rx="2[0-9](\.[0-9])?"[^>]+ry="2[0-9](\.[0-9])?"/);

      // 2. Processo: <rect rx="6" ry="6"
      expect(svg).toContain('data-shape="process"');
      expect(svg).toContain('rx="6" ry="6"');

      // 3. Decisão: <polygon points="..." (losango)
      expect(svg).toContain('data-shape="decision"');
      expect(svg).toContain('<polygon');

      // 4. Entrada/Saída: <polygon points="..." (paralelogramo inclinado)
      expect(svg).toContain('data-shape="io"');

      // 5. Subprocesso: <rect> e duas <line> verticais
      expect(svg).toContain('data-shape="subroutine"');
      expect(svg).toContain('<line');

      // 6. Documento: <path d="M... C... Z" (borda inferior ondulada)
      expect(svg).toContain('data-shape="document"');
      expect(svg).toContain('<path');
    });

    it('suprime rótulos vazios de conexões em modo fluxograma e exibe setas contínuas limpas', () => {
      const store = useConceptMapStore.getState();
      store.setDiagramMode('flowchart');

      const n1 = store.addConcept('Passo A', { x: 100, y: 100 });
      const n2 = store.addConcept('Passo B', { x: 100, y: 250 });
      const relId = store.addRelation(n1, n2, '');

      const state = useConceptMapStore.getState();
      const svg = generateStandaloneVectorSvg(state.semantic, state.visual);

      // A aresta deve ser desenhada com seta padrão
      expect(svg).toContain(`id="edge-${relId}"`);
      expect(svg).toContain('marker-end="url(#arrow-hier)"');

      // Rótulos vazios NÃO devem emitir elementos de texto ou retângulos vazios
      expect(svg).not.toContain(`data-relation-id="${relId}"`);
      expect(svg).not.toContain('<text class="edge-label"></text>');
    });

    it('renderiza badges condicionais "Sim" e "Não" com paletas semânticas esmeralda e rosa', () => {
      const store = useConceptMapStore.getState();
      store.setDiagramMode('flowchart');

      const nDec = store.addConcept('Aprovado?', { x: 200, y: 100 });
      store.updateNodeShape(nDec, 'decision');

      const nOk = store.addConcept('Prosseguir', { x: 400, y: 100 });
      const nFail = store.addConcept('Revisar', { x: 200, y: 300 });

      const relYes = store.addRelation(nDec, nOk, 'Sim');
      const relNo = store.addRelation(nDec, nFail, 'Não');

      const state = useConceptMapStore.getState();
      const svg = generateStandaloneVectorSvg(state.semantic, state.visual);

      // Conexão positiva (Sim): verde (#f0fdf4, #22c55e) e seta verde (#arrow-yes)
      expect(svg).toContain(`data-relation-id="${relYes}"`);
      expect(svg).toContain('marker-end="url(#arrow-yes)"');
      expect(svg).toContain('fill="#f0fdf4"');
      expect(svg).toContain('stroke="#22c55e"');

      // Conexão negativa (Não): vermelho (#fef2f2, #ef4444) e seta vermelha (#arrow-no)
      expect(svg).toContain(`data-relation-id="${relNo}"`);
      expect(svg).toContain('marker-end="url(#arrow-no)"');
      expect(svg).toContain('fill="#fef2f2"');
      expect(svg).toContain('stroke="#ef4444"');
    });

    it('preserva diagramMode e nodeShape no ciclo completo de exportação e importação JSON (.cmap.json)', () => {
      const store = useConceptMapStore.getState();
      store.setDiagramMode('flowchart');
      store.updateNodeShape('concept-projeto-pop', 'decision');

      const exportedDoc = store.exportDocument();
      expect(exportedDoc.semantic.diagramMode).toBe('flowchart');
      expect(exportedDoc.visual.nodes['concept-projeto-pop'].nodeShape).toBe('decision');

      const jsonStr = serializeDocumentToJson(exportedDoc);
      const validated = parseAndValidateJsonDocument(jsonStr);

      expect(validated.semantic.diagramMode).toBe('flowchart');
      expect(validated.visual.nodes['concept-projeto-pop'].nodeShape).toBe('decision');

      store.loadFromDocument(validated);
      const restored = useConceptMapStore.getState();
      expect(restored.semantic.diagramMode).toBe('flowchart');
      expect(restored.visual.nodes['concept-projeto-pop'].nodeShape).toBe('decision');
    });

    it('exportAsPng é uma função exportada e acessível', () => {
      expect(typeof exportAsPng).toBe('function');
    });

    it('exporta exemplo-fluxograma.md com todos os 6 formatos e transições sem erros', async () => {
      const fluxoPath = path.resolve(__dirname, '../../../../exemplo-fluxograma.md');
      if (fs.existsSync(fluxoPath)) {
        const fluxoContent = fs.readFileSync(fluxoPath, 'utf-8');
        const parsed = parseConceptMapMarkdown(fluxoContent);
        expect(parsed.semantic.diagramMode).toBe('flowchart');

        const store = useConceptMapStore.getState();
        await store.loadFromMarkdown(fluxoContent, 'exemplo-fluxograma.md');

        const state = useConceptMapStore.getState();
        const svg = generateStandaloneVectorSvg(state.semantic, state.visual);

        expect(svg).toContain('<?xml version="1.0" encoding="UTF-8"?>');
        expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
        expect(svg).toContain('Abertura de Pull Request');
        expect(svg).toContain('Deploy Realizado com');
        expect(svg).toContain('data-shape="terminal"');
        expect(svg).toContain('data-shape="decision"');
        expect(svg).toContain('data-shape="process"');
        expect(svg).toContain('data-shape="io"');
        expect(svg).toContain('data-shape="subroutine"');
        expect(svg).toContain('data-shape="document"');
      }
    });

    describe('Milestone 4: Fidelidade Vetorial de Conexões e Direções de Seta', () => {
      it('renderiza marcadores dinâmicos de seta conforme arrowDirection em exportação SVG', () => {
        const store = useConceptMapStore.getState();
        store.createNewEmptyMap(false, 'flowchart', { freeformCanvas: true });

        const n1 = store.addConcept('Início', { x: 100, y: 100 });
        const n2 = store.addConcept('Fim', { x: 300, y: 100 });

        // Forward
        const r1 = store.addRelation(n1, n2, 'avança', 'sequence', undefined, 'forward');
        // Reverse
        const r2 = store.addRelation(n1, n2, 'recua', 'sequence', undefined, 'reverse');
        // Both
        const r3 = store.addRelation(n1, n2, 'sincroniza', 'sequence', undefined, 'both');
        // None
        const r4 = store.addRelation(n1, n2, 'conecta', 'sequence', undefined, 'none');

        const state = useConceptMapStore.getState();
        const svg = generateStandaloneVectorSvg(state.semantic, state.visual);

        const p1 = svg.match(new RegExp(`<path id="edge-${r1}"[^>]+>`))?.[0] ?? '';
        expect(p1).toContain('marker-end=');
        expect(p1).not.toContain('marker-start=');

        const p2 = svg.match(new RegExp(`<path id="edge-${r2}"[^>]+>`))?.[0] ?? '';
        expect(p2).toContain('marker-start=');
        expect(p2).not.toContain('marker-end=');

        const p3 = svg.match(new RegExp(`<path id="edge-${r3}"[^>]+>`))?.[0] ?? '';
        expect(p3).toContain('marker-start=');
        expect(p3).toContain('marker-end=');

        const p4 = svg.match(new RegExp(`<path id="edge-${r4}"[^>]+>`))?.[0] ?? '';
        expect(p4).not.toContain('marker-start=');
        expect(p4).not.toContain('marker-end=');
      });

      it('utiliza computeSmartEdgeHandles como fallback quando handles são automáticos ou indefinidos', () => {
        const store = useConceptMapStore.getState();
        store.createNewEmptyMap(false, 'flowchart');

        const nA = store.addConcept('A', { x: 200, y: 100 });
        const nB = store.addConcept('B', { x: 200, y: 300 });
        store.resizeNode(nA, { width: 140, height: 50 });
        store.resizeNode(nB, { width: 140, height: 50 });

        const relId = store.addRelation(nA, nB, 'desce', 'sequence');
        store.updateRelation(relId!, { curveType: 'straight' });

        const state = useConceptMapStore.getState();
        const svg = generateStandaloneVectorSvg(state.semantic, state.visual);

        // Origem (nA): (200 + 70, 100 + 50) = (270, 150)
        // Destino (nB): (200 + 70, 300) = (270, 300) [topo, não base]
        const pathRegex = new RegExp(`<path id="edge-${relId}" d="M\\s*([0-9.]+)[,\\s]+([0-9.]+)[^L]*L\\s*([0-9.]+)[,\\s]+([0-9.]+)`);
        const match = pathRegex.exec(svg);
        expect(match).toBeTruthy();

        const startY = parseFloat(match![2]);
        const endY = parseFloat(match![4]);
        expect(startY).toBeCloseTo(150, 0);
        expect(endY).toBeCloseTo(300, 0);
      });

      it('preserva campos do Canvas Livre e direção de seta na validação e serialização JSON', () => {
        const store = useConceptMapStore.getState();
        store.createNewEmptyMap(false, 'flowchart', { freeformCanvas: true });

        const n1 = store.addConcept('Nó 1', { x: 100, y: 100 });
        const n2 = store.addConcept('Nó 2', { x: 300, y: 100 });

        const relId = store.addRelation(n1, n2, 'conecta', 'sequence', {
          sourceHandle: 'right',
          targetHandle: 'left',
          manualHandles: true,
        }, 'both');

        const doc = store.exportDocument();
        const json = serializeDocumentToJson(doc);
        const parsed = parseAndValidateJsonDocument(json);

        expect(parsed.visual.layoutSettings.freeformCanvas).toBe(true);
        expect(parsed.visual.edges[relId!].sourceHandle).toBe('right');
        expect(parsed.visual.edges[relId!].targetHandle).toBe('left');
        expect(parsed.visual.edges[relId!].manualHandles).toBe(true);
        expect(parsed.visual.edges[relId!].arrowDirection).toBe('both');
      });
    });
  });
});

