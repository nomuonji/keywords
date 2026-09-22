import * as jose from 'jose';
import { createHash, timingSafeEqual } from 'node:crypto';
import { keywordResearchPipeline, keywordScreenBatch } from '../packages/commands/src/keyword-research-pipeline.js';
import { serpUsageStatus } from '../packages/commands/src/remote-keyword-research.js';

const TEAM_SLUG = process.env.KEYWORDS_BRIDGE_ALLOWED_TEAM || 'nomuonjis-projects';
const SOURCE_PROJECT = process.env.KEYWORDS_BRIDGE_ALLOWED_PROJECT || 'analytics-dashboard';
const SOURCE_ENVIRONMENT = process.env.KEYWORDS_BRIDGE_ALLOWED_ENVIRONMENT || 'production';
const TEAM_ISSUER = `https://oidc.vercel.com/${TEAM_SLUG}`;
const GLOBAL_ISSUER = 'https://oidc.vercel.com';
const AUDIENCE = `https://vercel.com/${TEAM_SLUG}`;
const SUBJECT = `owner:${TEAM_SLUG}:project:${SOURCE_PROJECT}:environment:${SOURCE_ENVIRONMENT}`;
const JWKS = new Map<string, ReturnType<typeof jose.createRemoteJWKSet>>();
const SCHEDULED_CAPABILITY_SHA256 = process.env.KEYWORDS_SCHEDULED_BRIDGE_CAPABILITY_SHA256 || 'bfbcab35bbc59b4a74cc5d288ee7a6d404720c6ba1d371ddda116f1ab7147d29';

function jwksFor(issuer: string) {
  let value = JWKS.get(issuer);
  if (!value) {
    value = jose.createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`));
    JWKS.set(issuer, value);
  }
  return value;
}

function capabilityOk(value: unknown) {
  if (typeof value !== 'string' || !value) return false;
  const actual = createHash('sha256').update(value).digest();
  const expected = Buffer.from(SCHEDULED_CAPABILITY_SHA256, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function authorizeRequest(req: any) {
  const authHeader = String(req.headers?.authorization || '');
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (token) {
    const issuer = String(jose.decodeJwt(token).iss || '');
    if (![TEAM_ISSUER, GLOBAL_ISSUER].includes(issuer)) {
      throw new Error('Unexpected OIDC issuer');
    }
    const verified = await jose.jwtVerify(token, jwksFor(issuer), {
      issuer,
      audience: AUDIENCE,
      subject: SUBJECT
    });
    return { type: 'vercel_oidc', subject: verified.payload.sub || SUBJECT };
  }

  const capability = Array.isArray(req.query?.cap) ? req.query.cap[0] : req.query?.cap;
  if (capabilityOk(capability)) {
    return { type: 'scheduled_capability', subject: 'site-seo-operations' };
  }

  throw new Error('Missing or invalid bridge authorization');
}

function queryList(value: unknown) {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== 'string') return [];
  return value.split('|').map(item => item.trim()).filter(Boolean).slice(0, 20);
}

function queryNumber(value: unknown) {
  if (Array.isArray(value)) value = value[0];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function queryBoolean(value: unknown) {
  if (Array.isArray(value)) value = value[0];
  return ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
}

function inputFromQuery(query: any = {}) {
  const mode = Array.isArray(query.mode) ? query.mode[0] : query.mode;
  if (mode === 'status') return { mode };

  const keywords = queryList(query.keywords);
  if (!keywords.length) throw new Error('1-20 pipe-separated keywords are required');

  const criteria: Record<string, number> = {};
  const minVolume = queryNumber(query.minVolume);
  const minCpcMicros = queryNumber(query.minCpcMicros);
  const minCompetitionIndex = queryNumber(query.minCompetitionIndex);
  const maxCompetitionIndex = queryNumber(query.maxCompetitionIndex);
  if (minVolume !== undefined) criteria.minVolume = minVolume;
  if (minCpcMicros !== undefined) criteria.minCpcMicros = minCpcMicros;
  if (minCompetitionIndex !== undefined) criteria.minCompetitionIndex = minCompetitionIndex;
  if (maxCompetitionIndex !== undefined) criteria.maxCompetitionIndex = maxCompetitionIndex;

  return {
    mode,
    keywords,
    criteria: Object.keys(criteria).length ? criteria : undefined,
    languageConstant: Array.isArray(query.languageConstant) ? query.languageConstant[0] : query.languageConstant,
    geoTargetConstants: queryList(query.geoTargetConstants),
    includeAdultKeywords: queryBoolean(query.includeAdultKeywords),
    maxSerpChecks: mode === 'pipeline' ? Math.max(0, Math.min(queryNumber(query.maxSerpChecks) ?? 3, 5)) : undefined,
    country: Array.isArray(query.country) ? query.country[0] : query.country,
    language: Array.isArray(query.language) ? query.language[0] : query.language,
    location: Array.isArray(query.location) ? query.location[0] : query.location,
    num: Math.max(1, Math.min(queryNumber(query.num) ?? 10, 10)),
    provider: Array.isArray(query.provider) ? query.provider[0] : query.provider
  };
}

function boundedInput(body: any) {
  if (body?.mode === 'status') return { mode: 'status' };
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
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const auth = await authorizeRequest(req);
    const body = req.method === 'GET'
      ? inputFromQuery(req.query || {})
      : boundedInput(typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}));

    if (body?.mode === 'status') {
      res.setHeader('cache-control', 'no-store');
      return res.status(200).json({
        ok: true,
        source: {
          authType: auth.type,
          subject: auth.subject,
          project: SOURCE_PROJECT,
          environment: SOURCE_ENVIRONMENT
        },
        usage: await serpUsageStatus()
      });
    }

    const bounded = req.method === 'GET' ? boundedInput(body) : body;
    const result = bounded.mode === 'screen'
      ? await keywordScreenBatch(bounded.input)
      : await keywordResearchPipeline(bounded.input);

    res.setHeader('cache-control', 'no-store');
    return res.status(200).json({
      ok: true,
      mode: bounded.mode,
      source: {
        authType: auth.type,
        subject: auth.subject,
        project: SOURCE_PROJECT,
        environment: SOURCE_ENVIRONMENT
      },
      result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const authError = /authorization|capability|token|jwt|issuer|audience|subject|signature|jwks|bearer/i.test(message);
    res.setHeader('cache-control', 'no-store');
    return res.status(authError ? 401 : 400).json({
      ok: false,
      error: authError ? 'Unauthorized bridge request' : message
    });
  }
}
