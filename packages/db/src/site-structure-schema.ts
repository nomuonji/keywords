/** Shared Firestore model. Concepts are drafts, never publication approvals. */
export type SiteKeywordRole = 'primary' | 'secondary' | 'supporting' | 'parent' | 'monetization';
export type SiteStructureNode = {
  id: string;
  parentId: string | null;
  title: string;
  path: string;
  kind: 'home' | 'category' | 'article' | 'landing';
  purpose: string;
  keywordIds: string[];
  keywordRoles: Record<string, SiteKeywordRole>;
  notes: string;
};
export type SiteStructureLink = { from: string; to: string; label: string };
export type SiteDataModelEntity = {
  entity: string;
  fields: Array<{ name: string; type: string; description: string; required: boolean }>;
};
export type SiteSourceStrategy = {
  name: string;
  sourceType: 'official_pricing' | 'official_feature' | 'official_faq' | 'official_docs' | 'regulator' | 'other';
  urlPattern: string;
  fields: string[];
  notes: string;
};
export type SitePageTemplate = {
  id: string;
  titlePattern: string;
  kind: 'comparison' | 'detail' | 'directory' | 'landing' | 'other';
  purpose: string;
  dataRequirements: string[];
};
export type SiteRefreshPolicy = {
  scope: string;
  ttlDays: number;
  trigger: string;
  notes: string;
};
export type SiteStructure = {
  id: string;
  title: string;
  concept: string;
  audience: string;
  monetization: string;
  notes: string;
  status: 'draft' | 'active' | 'archived';
  dataModel: SiteDataModelEntity[];
  sourceStrategy: SiteSourceStrategy[];
  pageTemplates: SitePageTemplate[];
  refreshPolicy: SiteRefreshPolicy[];
  nodes: SiteStructureNode[];
  links: SiteStructureLink[];
  revision: number;
  createdAt: string;
  updatedAt: string;
};
