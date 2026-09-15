/** Shared Firestore model. Concepts are drafts, never publication approvals. */
export type SiteStructureNode = {
  id: string;
  parentId: string | null;
  title: string;
  path: string;
  kind: 'home' | 'category' | 'article' | 'landing';
  purpose: string;
  keywordIds: string[];
  notes: string;
};
export type SiteStructureLink = { from: string; to: string; label: string };
export type SiteStructure = {
  id: string;
  title: string;
  concept: string;
  audience: string;
  monetization: string;
  notes: string;
  status: 'draft' | 'active' | 'archived';
  nodes: SiteStructureNode[];
  links: SiteStructureLink[];
  revision: number;
  createdAt: string;
  updatedAt: string;
};
