import * as jose from 'jose';
import { keywordResearchPipeline, keywordScreenBatch } from '../packages/commands/src/keyword-research-pipeline.js';
import { serpUsageStatus } from '../packages/commands/src/remote-keyword-research.js';

const TEAM_SLUG = process.env.KEYWORDS_BRIDGE_ALLOWED_TEAM || 'nomuonjis-projects';
const SOURCE_PROJECT = process.env.KEYWORDS_BRIDGE_ALLOWED_PROJECT || 'analytics-dashboard';
const SOURCE_ENVIRONMENT = process.env.KEYWORDS_BRIDGE_ALLOWED_ENVIRONMENT || 'production';
const ISSUER = `https://oidc.vercel.com/${TEAM_SLUG}`;
const AUDIENCE = `https://vercel.com/${TEAM_SLUG}`;
const SUBJECT = `owner:${TEAM_SLUG}:project:${SOURCE_PROJECT}:environment:${SOURCE_ENVIRONMENT}`;
const JWKS = jose.createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));

async function authorize(authHeader: string) {
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Missing bearer token');
  return jose.jwtVerify(token, JWKS, {
    issuer: ISSUER,
    audience: AUDIENCE,
    subject: SUBJECT
  });
}

function boundedInput(body: any) {
  const keywords = Array.isArray(body?.keywords)
    ? body.keywords.filter((value: unknown) => typeof value === 'string' && value.trim()).slice(0, 50)
    : [];
  if (!keywords.length) throw new Error('1-50 keywords are required');

  const common = {
    keywords,
    criteria: body.criteria,
    languageConstant: body.languageConstant,
    geoTargetConstants: Array.isArray(body.geoTargetConstants) ? body.geoTargetConstants.slice(0, 10) : undefined,
    includeAdultKeywords: Boolean(body.includeAdultKeywords)
  };

  if (body.mode === 'screen') return { mode: 'screen', input: common };
  if (body.mode === 'pipeline') return {
    mode: 'pipeline',
    input: {
      ...common,
      maxSerpChecks: Math.max(0, Math.min(Number(body.maxSerpChecks ?? 3), 5)),
      country: body.country,
      language: body.language,
      location: body.location,
      num: Math.max(1, Math.min(Number(body.num ?? 10), 10)),
      provider: body.provider
    }
  };
  throw new Error('mode must be screen or pipeline');
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { payload } = await authorize(String(req.headers?.authorization || ''));
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    if (body?.mode === 'status') {
      res.setHeader('cache-control', 'no-store');
      return res.status(200).json({
        ok: true,
        source: {
          subject: payload.sub,
          project: SOURCE_PROJECT,
          environment: SOURCE_ENVIRONMENT
        },
        usage: await serpUsageStatus()
      });
    }

    const bounded = boundedInput(body);
    const result = bounded.mode === 'screen'
      ? await keywordScreenBatch(bounded.input)
      : await keywordResearchPipeline(bounded.input);

    res.setHeader('cache-control', 'no-store');
    return res.status(200).json({
      ok: true,
      mode: bounded.mode,
      source: {
        subject: payload.sub,
        project: SOURCE_PROJECT,
        environment: SOURCE_ENVIRONMENT
      },
      result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const authError = /token|jwt|issuer|audience|subject|signature|jwks|bearer/i.test(message);
    res.setHeader('cache-control', 'no-store');
    return res.status(authError ? 401 : 400).json({
      ok: false,
      error: authError ? 'Unauthorized bridge request' : message
    });
  }
}
