/**
 * Remote/local MCP drift is the failure mode this file exists for.
 *
 * The chat skill `treasure-keyword-discovery` was written against the remote
 * operator (api/mcp.ts on Vercel). The local stdio operator (apps/mcp/src) does
 * not expose every one of those tools, and the two runtimes use different names
 * for the same job: the skill says `serp_research`, the local server exposes
 * `research_serp`. An agent that follows the skill verbatim in a local session
 * gets "unknown tool", then improvises — which is how a run silently degrades
 * instead of failing loudly.
 *
 * This manifest is the single place that maps a capability to the name it has in
 * each runtime, and says what to do when the runtime lacks it entirely.
 */

export interface KeywordCapability {
  /** What the work needs, in the skill's own words. */
  capability: string;
  /** The skill's (remote-era) tool name, kept so a name in old notes still resolves. */
  skillName: string;
  /** Tools that provide it in the local stdio operator. Empty = unavailable locally. */
  local: string[];
  /** Tool that provides it in the remote operator, when it differs. */
  remote: string | null;
  /** What an agent must do locally when nothing above can answer it. */
  whenMissing: string;
}

export const KEYWORD_CAPABILITIES: KeywordCapability[] = [
  { capability: '名称の検索需要を測る（Google Ads）', skillName: 'keyword_demand_research', local: ['keyword_screen_batch', 'research_google_ads_keywords'], remote: 'keyword_demand_research', whenMissing: '需要は UNKNOWN。0 とも「需要なし」とも書かない。' },
  { capability: '需要→SERPの一括パイプライン', skillName: 'keyword_research_pipeline', local: ['keyword_research_pipeline'], remote: 'keyword_research_pipeline', whenMissing: 'keyword_screen_batch と research_serp を手で順に呼ぶ。' },
  { capability: '名称固有のSERP取得', skillName: 'serp_research', local: ['research_serp'], remote: 'serp_research', whenMissing: 'SERP未取得。競合の弱さを主張せず Hold にする。' },
  { capability: '上位ページ本文との差分確認', skillName: 'search_gap_research', local: [], remote: 'search_gap_research', whenMissing: 'research_web_fetch で上位2〜3件の本文を読み、主張は OBSERVED として引用付きで書く。' },
  { capability: '未知市場のブラインド観測', skillName: 'market_discovery_run', local: [], remote: 'market_discovery_run', whenMissing: 'PR TIMES・Wikipedia閲覧数・サジェスト等を自分で観測し、観測面を3つ以上明記する。' },
  { capability: '商品・買い物市場の観測', skillName: 'market_product_discovery', local: [], remote: 'market_product_discovery', whenMissing: '公開のランキング/商品ページを research_web_fetch で確認。掲載は販売の証拠にしない。' },
  { capability: 'マーケットプレイス内の名称確認', skillName: 'marketplace_research', local: [], remote: 'marketplace_research', whenMissing: '対象サイト内を research_web_fetch。結果件数は市場全体の需要ではない。' },
  { capability: 'SNS投稿と検索語の接続', skillName: 'market_intelligence_research', local: [], remote: 'market_intelligence_research', whenMissing: '投稿が見つからないことを需要ゼロと扱わない。' },
  { capability: 'トレンドの時点確認', skillName: 'market_signal_scan', local: [], remote: 'market_signal_scan', whenMissing: '一般トレンドを個別語の需要と混同しない。' },
  { capability: '候補の台帳照合（重複・棄却の再利用）', skillName: 'keyword_treasury_search', local: ['keyword_treasury_search', 'keyword_treasury_list', 'keyword_treasury_duplicate_check'], remote: 'keyword_treasury_search', whenMissing: '照合できないまま保存しない。未照合として報告する。' },
  { capability: '証拠付き候補の保存', skillName: 'keyword_treasury_save', local: ['keyword_treasury_save'], remote: 'keyword_treasury_save', whenMissing: '保存していないと明記し、保存したふりをしない。' },
  { capability: '調査セッションの記録', skillName: 'research_session_create', local: [], remote: 'research_session_create', whenMissing: 'operation_checkpoint に目的・観測・棄却理由・再開地点を残す。' },
  { capability: '配信面・導線の発掘', skillName: 'traffic_route_discovery', local: [], remote: 'traffic_route_discovery', whenMissing: '配信面が確認できなければ商流は UNKNOWN。案件の存在で補わない。' },
  { capability: 'Web本文の取得', skillName: 'web_fetch', local: ['research_web_fetch'], remote: null, whenMissing: '一次資料が読めない候補は Qualified にしない。' }
];

/** Resolve a name that appears in skill text or old notes to local tool names. */
export function resolveKeywordTool(name: string): KeywordCapability | null {
  const normalized = name.trim().toLocaleLowerCase();
  return KEYWORD_CAPABILITIES.find(item =>
    item.skillName.toLocaleLowerCase() === normalized
    || item.local.some(local => local.toLocaleLowerCase() === normalized)
    || item.remote?.toLocaleLowerCase() === normalized
  ) ?? null;
}

export function keywordCapabilityCatalog() {
  return {
    runtime: 'local-stdio' as const,
    note: 'Skill text names the remote-era tool. Resolve it here first; a capability with empty local[] is unavailable in this runtime and must be reported as unverified, not replaced by a guess.',
    aliases: Object.fromEntries(KEYWORD_CAPABILITIES.filter(item => item.local.length && item.skillName !== item.local[0]).map(item => [item.skillName, item.local[0]])),
    unavailableLocally: KEYWORD_CAPABILITIES.filter(item => !item.local.length).map(item => ({ skillName: item.skillName, capability: item.capability, whenMissing: item.whenMissing })),
    capabilities: KEYWORD_CAPABILITIES
  };
}
