/**
 * E2E Testing Track - Interface Contracts & Types
 * Derived strictly from ORIGINAL_REQUEST.md, PROJECT.md, and prompt-fluxograma-teamwork.md
 */

export type DiagramMode = 'concept-map' | 'flowchart';

export type FlowchartNodeShape =
  | 'concept'
  | 'terminal'
  | 'process'
  | 'decision'
  | 'io'
  | 'subroutine'
  | 'document';

export type FlowTransitionKind = 'sequence' | 'conditional' | 'loop-back';

export type RelationType =
  | 'hierarchical'
  | 'cross-link'
  | 'sequence'
  | 'conditional'
  | 'loop-back';

export interface ConceptNodeSemanticContract {
  id: string;
  label: string;
  normalizedKey?: string;
  notes?: string;
  nodeShape?: FlowchartNodeShape;
}

export interface ConceptRelationSemanticContract {
  id: string;
  orderIndex: number;
  sourceId: string;
  linkingPhrase: string;
  targetId: string;
  type: RelationType;
  flowKind?: FlowTransitionKind;
}

export interface SemanticModelContract {
  title: string;
  diagramMode?: DiagramMode;
  concepts: Record<string, ConceptNodeSemanticContract>;
  conceptOrder: string[];
  relations: Record<string, ConceptRelationSemanticContract>;
  relationOrder: string[];
}

export interface Dimensions2DContract {
  width: number;
  height: number;
}
