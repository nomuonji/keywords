import { randomUUID } from 'node:crypto';
import { getDatabase } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { searchConsoleSites } from '@keywords/research';
import { assertOperationAllowed, reserveOperationBudget, settleOperationBudget } from './guard.js';

export function propertyContains(property: string, origin: string) {
  try {
    const url = new URL(origin);
    if (property.startsWith('sc-domain:')) { const host = property.slice(10).toLowerCase(); return url.hostname === host || url.hostname.endsWith(`.${host}`); }
    const prefix = new URL(property);
    return prefix.origin === url.origin && prefix.pathname === '/';
  } catch { return false; }
}

export function gscCredentialsConfigured() {
  const hasAccess = Boolean(process.env.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_ACCESS_TOKEN || process.env.GOOGLE_APPLICATION_CREDENTIALS);
  const refresh = process.env.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN || process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID || process.env.ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.ADS_CLIENT_SECRET;
  return hasAccess || Boolean(refresh && clientId && clientSecret);
}

function projectOrigin(domain: string | null, bindingOrigin?: string | null) {
  const source = bindingOrigin ?? domain;
  if (!source) return null;
  try { return new URL(source.includes('://') ? source : `https://${source}`).origin; }
  catch { return null; }
}

/** Shared local preflight used by scheduling and readiness. It performs no external request. */
export function gscMeasurementReadiness(projectId: string) {
  const { sqlite } = getDatabase();
  const project = sqlite.prepare('SELECT domain FROM projects WHERE id=?').get(projectId) as { domain: string | null } | undefined;
  if (!project) throw new Error('Project not found');
  const binding = sqlite.prepare('SELECT origin FROM blog_bindings WHERE project_id=?').get(projectId) as { origin: string } | undefined;
  const origin = projectOrigin(project.domain, binding?.origin);
  const configuredProperty = process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL?.trim() || null;
  const credentialsConfigured = gscCredentialsConfigured();
  return {
    credentialsConfigured,
    configuredProperty,
    origin,
    configuredPropertyPresent: Boolean(configuredProperty),
    propertyDiscoveryAvailable: Boolean(credentialsConfigured && origin),
    scopeResolvable: Boolean(configuredProperty || origin)
  };
}

/** Shared property selection for multi-site measurement, with one auditable external read when needed. */
export async function resolveGscProperty(ctx: CommandContext, projectId: string, requested?: string) {
  const { sqlite } = getDatabase();
  const readiness = gscMeasurementReadiness(projectId);
  const origin = readiness.origin;
  if (requested) {
    if (origin && !propertyContains(requested,origin)) throw new Error('Search Console property does not cover the project origin');
    return requested;
  }
  const configured = readiness.configuredProperty;
  if (configured && (!origin || propertyContains(configured,origin))) return configured;
  if (!origin) throw new Error('A project origin is required to discover the Search Console property');
  const cached = sqlite.prepare("SELECT metadata_json FROM sources WHERE project_id=? AND type='gsc_properties' AND created_at>? ORDER BY created_at DESC LIMIT 1").get(projectId,new Date(Date.now()-86400000).toISOString()) as {metadata_json:string}|undefined;
  let properties: Array<{siteUrl:string}> = [];
  if (cached) { try { properties=JSON.parse(cached.metadata_json).properties ?? []; } catch {} }
  if (!cached) {
    assertOperationAllowed(ctx,{projectId,command:'measurement.resolve_property',capability:'measurement.capture'});
    const runId=randomUUID(),t=new Date().toISOString();
    const reservation=reserveOperationBudget(ctx,projectId,'external_request',`properties:${runId}`);
    try {
      properties=await searchConsoleSites();
      settleOperationBudget(reservation?.id,'succeeded');
      const sourceId=randomUUID();
      sqlite.prepare('INSERT INTO sources(id,project_id,type,label,url,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)').run(sourceId,projectId,'gsc_properties','Accessible Search Console properties',origin,JSON.stringify({properties}),t);
      sqlite.prepare('INSERT INTO runs(id,project_id,work_session_id,actor,actor_id,command,status,output_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(runId,projectId,ctx.workSessionId??null,ctx.actor,ctx.actorId??null,'measurement.resolve_property','succeeded',JSON.stringify({sourceId}),t);
    } catch(error) {
      settleOperationBudget(reservation?.id,'failed','property_discovery_failed');
      sqlite.prepare('INSERT INTO runs(id,project_id,work_session_id,actor,actor_id,command,status,error,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(runId,projectId,ctx.workSessionId??null,ctx.actor,ctx.actorId??null,'measurement.resolve_property','failed','Property discovery failed',t);
      throw error;
    }
  }
  const property=properties.map(row=>row.siteUrl).filter(value=>propertyContains(value,origin)).sort((a,b)=>Number(b.startsWith('http'))-Number(a.startsWith('http'))||b.length-a.length)[0];
  if (!property) throw new Error('No accessible Search Console property covers the project origin');
  return property;
}
