/**
 * Isolated, read-only projection for Market Shorts.
 * Explicit ID lookup only: never expose the full Idea Memory collection.
 * Requires a dedicated, read-only bearer token (not the MCP write token).
 */
import { timingSafeEqual } from 'node:crypto';
import { ideaReviewDetail } from '../packages/commands/src/idea-memory.js';

function json(value: unknown, status=200) {
  return new Response(JSON.stringify(value), {
    status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
  });
}
function matches(a: string, b: string) {
  if (!a || !b) return false;
  const ab=Buffer.from(a), bb=Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab,bb);
}
export default async function handler(req: Request) {
  if (req.method !== 'GET') return json({error:'Method not allowed'},405);
  const token=process.env.MARKET_SHORTS_FEED_TOKEN?.trim();
  if (!token) return json({error:'Feed not configured'},503);
  const bearer=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'') ?? '';
  if (!matches(bearer,token)) return json({error:'Unauthorized'},401);
  const url=new URL(req.url);
  const id=url.searchParams.get('id') ?? '';
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return json({error:'Valid canonical idea id required'},400);
  try {
    const idea=await ideaReviewDetail(id);
    if (!idea) return json({ideas:[]},200);
    if (idea.status === 'rejected' || idea.status === 'deferred') return json({ideas:[]});
    const review=idea.agentReview;
    const axes=review?.axes;
    const approved=review?.rubricVersion === 'idea-final-judge-v4'
      && review.verdict === 'pass'
      && axes?.appeal === 5
      && ['dbValue','seo','revenue','contentFeasibility','upkeep'].every(k => {
        const score=Number((axes as Record<string,unknown>)[k]);
        return Number.isInteger(score) && score >= 4 && score <= 5;
      });
    const destination=Array.isArray(idea.destinations)
      && idea.destinations.some(v => ['youtube_video','youtube_shorts','short_video'].includes(v));
    const refs=Array.isArray(idea.marketEvidenceRefs)
      ? idea.marketEvidenceRefs.filter(x => typeof x === 'string' && x.length>0).slice(0,12) : [];
    if (!approved || !destination || refs.length===0) return json({ideas:[]});
    // This endpoint does not fabricate a script, alter idea reviews, or publish.
    const projection={
      id:idea.id,title:idea.title,revision:idea.revision,status:idea.status,
      destinations:idea.destinations,agentReview:review,marketEvidenceRefs:refs,
      audience:idea.audience,userTask:idea.userTask,
      entities:idea.entities,informationMechanism:idea.informationMechanism,
      interaction:idea.interaction,unknowns:idea.unknowns || []
    };
    return json({ideas:[projection]});
  } catch {
    return json({error:'Idea projection unavailable'},503);
  }
}
