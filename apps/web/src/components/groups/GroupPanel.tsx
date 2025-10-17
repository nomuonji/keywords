import { useEffect, useMemo, useState } from 'react';
import {
  MdArticle,
  MdCheckBox,
  MdCheckBoxOutlineBlank,
  MdDelete,
  MdOutlineCalendarToday,
  MdOutlineCheckCircle,
  MdOutlineClear,
  MdOutlineInfo,
  MdOutlineKeyboardArrowDown,
  MdOutlineKeyboardArrowRight,
  MdOutlineLink,
  MdOutlineListAlt,
  MdOutlineQuestionAnswer,
  MdOutlineRadioButtonUnchecked,
  MdOutlineStackedBarChart,
  MdSelectAll
} from 'react-icons/md';
import type { IconType } from 'react-icons';
import type { GroupSummary } from '../../types';

interface GroupPanelProps {
  groups: GroupSummary[];
  selectedGroupIds: Set<string>;
  onToggleGroupSelection: (groupId: string) => void;
  onSelectAllGroups: () => void;
  onClearSelection: () => void;
  onDeleteSelectedGroups: () => void;
  deletingGroups?: boolean;
}

export function GroupPanel({
  groups,
  selectedGroupIds,
  onToggleGroupSelection,
  onSelectAllGroups,
  onClearSelection,
  onDeleteSelectedGroups,
  deletingGroups
}: GroupPanelProps) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const totalKeywords = groups.reduce((sum, group) => sum + group.keywords.length, 0);
    const avgPriority =
      groups.length === 0
        ? 0
        : groups.reduce((sum, group) => sum + group.priorityScore, 0) / groups.length;
    return {
      totalKeywords,
      avgPriority: Number(avgPriority.toFixed(1)),
      count: groups.length
    };
  }, [groups]);

  useEffect(() => {
    if (!groups.length) {
      setSelectedGroupId(null);
    } else if (!groups.find((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(groups[0].id);
    }
  }, [groups, selectedGroupId]);

  if (!groups.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
        まだクラスタが生成されていません。パイプラインを実行して最新状態を取得してください。
      </div>
    );
  }

  const selectedGroup =
    groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? undefined;
  const selectedCount = selectedGroupIds.size;

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">クラスタ管理</h3>
          <p className="text-sm text-slate-500">
            クラスタリストから対象を選ぶと右側に詳細が表示されます。優先度やアウトラインの有無を一覧で把握できます。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="rounded-full bg-primary/10 px-3 py-1 text-primary">
            クラスタ数: {stats.count}
          </span>
          <span className="rounded-full bg-secondary/10 px-3 py-1 text-secondary">
            平均 priorityScore: {stats.avgPriority}
          </span>
          <span className="rounded-full bg-slate-200 px-3 py-1 text-slate-700">
            キーワード総数: {stats.totalKeywords}
          </span>
          {selectedCount > 0 ? (
            <span className="rounded-full bg-rose-100 px-3 py-1 text-rose-600">
              選択中: {selectedCount}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSelectAllGroups}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 transition hover:border-primary hover:text-primary disabled:opacity-50"
            disabled={!groups.length}
          >
            <MdSelectAll size={16} />
            全選択
          </button>
          <button
            type="button"
            onClick={onClearSelection}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 transition hover:border-primary hover:text-primary disabled:opacity-50"
            disabled={!selectedCount}
          >
            <MdOutlineClear size={16} />
            選択解除
          </button>
          <button
            type="button"
            onClick={onDeleteSelectedGroups}
            className="inline-flex items-center gap-1 rounded-md bg-rose-500 px-3 py-1 text-xs font-semibold text-white shadow hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-rose-300"
            disabled={!selectedCount || deletingGroups}
          >
            <MdDelete size={16} />
            {deletingGroups ? '削除中…' : '選択を削除'}
          </button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_1fr]">
        <aside className="space-y-2">
          {groups.map((group) => {
            const isMarked = selectedGroupIds.has(group.id);
            const isActive = group.id === selectedGroup?.id;
            return (
              <div key={group.id} className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => onToggleGroupSelection(group.id)}
                  className={`mt-2 text-slate-500 transition hover:text-primary ${isMarked ? 'text-primary' : ''}`}
                  aria-label={isMarked ? '選択解除' : '選択'}
                >
                  {isMarked ? <MdCheckBox size={20} /> : <MdCheckBoxOutlineBlank size={20} />}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedGroupId(group.id)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-left transition ${
                    isActive
                      ? 'border-primary bg-primary/10 text-primary shadow'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-primary/40'
                  } ${isMarked && !isActive ? 'ring-2 ring-rose-200' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">{group.title}</p>
                    <span className="inline-flex items-center gap-1 rounded-full bg-secondary/10 px-2 py-0.5 text-xs text-secondary">
                      <MdOutlineStackedBarChart />
                      {group.priorityScore.toFixed(1)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-slate-600">
                      {translateIntent(group.intent)}
                    </span>
                    <StatusBadge
                      icon={group.outline ? MdOutlineCheckCircle : MdOutlineRadioButtonUnchecked}
                      label={group.outline ? 'アウトライン生成済' : 'アウトライン未生成'}
                      tone={group.outline ? 'success' : 'muted'}
                    />
                    <StatusBadge
                      icon={MdOutlineLink}
                      label={`リンク ${group.links.length}`}
                      tone={group.links.length ? 'info' : 'muted'}
                    />
                    <StatusBadge
                      icon={MdOutlineListAlt}
                      label={`KW ${group.keywords.length}`}
                      tone="info"
                    />
                  </div>
                </button>
              </div>
            );
          })}
        </aside>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          {selectedGroup ? (
            <GroupDetail group={selectedGroup} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-slate-500">
              <MdOutlineInfo size={28} />
              <p>クラスタを選択すると詳細が表示されます。</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function StatusBadge({
  icon: Icon,
  label,
  tone
}: {
  icon: IconType;
  label: string;
  tone: 'success' | 'info' | 'muted';
}) {
  const palette = {
    success: 'bg-success/10 text-success',
    info: 'bg-primary/10 text-primary',
    muted: 'bg-slate-200 text-slate-600'
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${palette[tone]}`}>
      <Icon size={14} />
      {label}
    </span>
  );
}

function GroupDetail({ group }: { group: GroupSummary }) {
  const linkGroups: Array<{
    reason: GroupSummary['links'][number]['reason'];
    label: string;
    description: string;
    tone: string;
  }> = [
    {
      reason: 'hierarchy',
      label: '階層（ビッグ→ロングテール）',
      description: '上位概念から細かな検索ニーズへの導線',
      tone: 'bg-amber-100 text-amber-700'
    },
    {
      reason: 'hub',
      label: 'ハブ＆スポーク',
      description: 'ハブ記事から関連スポーク記事へ流す導線',
      tone: 'bg-indigo-100 text-indigo-700'
    },
    {
      reason: 'sibling',
      label: '兄弟（横並び補完）',
      description: '同じ意図で補完し合う比較・派生記事',
      tone: 'bg-teal-100 text-teal-700'
    }
  ] as const;

  return (
    <div className="flex h-full flex-col gap-4">
      <header className="border-b border-slate-200 pb-3">
        <h4 className="text-lg font-semibold text-slate-900">{group.title}</h4>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5">
            {translateIntent(group.intent)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary/10 px-2 py-0.5 text-secondary">
            <MdOutlineStackedBarChart />
            priorityScore {group.priorityScore.toFixed(1)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5">
            <MdOutlineCalendarToday />
            キーワード {group.keywords.length} 件
          </span>
        </div>
      </header>

      <section className="space-y-3">
        <h5 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <MdArticle />
          アウトライン
        </h5>
        {group.outline ? (
          <OutlineView outline={group.outline} />
        ) : (
          <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-500">
            まだアウトラインが生成されていません。
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h5 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <MdOutlineListAlt />
          代表キーワード
        </h5>
        <ul className="grid gap-2 md:grid-cols-2">
          {group.keywords.map((keyword) => (
            <li key={keyword.id} className="rounded-md border border-slate-200 p-2 text-sm">
              <p className="font-medium text-slate-800">{keyword.text}</p>
              <p className="text-xs text-slate-500">
                検索ボリューム: {keyword.metrics.avgMonthly ?? 'n/a'}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h5 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <MdOutlineLink />
          内部リンク推奨
        </h5>
        <LinkHierarchy group={group} linkGroups={linkGroups} />
      </section>
    </div>
  );
}

function LinkHierarchy({
  group,
  linkGroups
}: {
  group: GroupSummary;
  linkGroups: Array<{
    reason: GroupSummary['links'][number]['reason'];
    label: string;
    description: string;
    tone: string;
  }>;
}) {
  if (!group.links.length) {
    return (
      <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-500">
        現時点で推奨リンクはありません。
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200">
      <div className="border-b border-slate-200 px-3 py-2 text-xs text-slate-500">
        選択したクラスタを起点にしたリンク構造
      </div>
      <div className="p-3">
        <ul className="space-y-3 text-sm text-slate-700">
          <li>
            <div className="flex items-center gap-2 font-semibold text-slate-900">
              <MdOutlineKeyboardArrowDown />
              {group.title}
            </div>
            <ul className="ml-6 mt-2 space-y-3 border-l border-dashed border-slate-300 pl-4">
              {linkGroups.map(({ reason, label, description, tone }) => {
                const links = group.links.filter((link) => link.reason === reason);
                if (!links.length) {
                  return null;
                }
                return (
                  <li key={reason} className="space-y-1">
                    <div className={`inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs ${tone}`}>
                      {label}
                    </div>
                    <p className="text-xs text-slate-500">{description}</p>
                    <ul className="ml-4 space-y-1">
                      {links.map((link) => (
                        <li
                          key={`${reason}-${link.targetId}`}
                          className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1 text-xs"
                        >
                          <span className="flex items-center gap-1">
                            <MdOutlineKeyboardArrowRight />
                            {link.targetId}
                          </span>
                          <span className="font-semibold text-slate-500">
                            スコア {link.weight.toFixed(2)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </li>
        </ul>
      </div>
    </div>
  );
}

function OutlineView({
  outline
}: {
  outline: NonNullable<GroupSummary['outline']>;
}) {
  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <h6 className="text-sm font-semibold text-slate-800">{outline.outlineTitle}</h6>
      <div>
        <p className="text-xs font-semibold text-slate-600">H2 ブロック</p>
        <ul className="list-disc pl-5 text-sm text-slate-700">
          {outline.h2.map((heading) => (
            <li key={heading}>{heading}</li>
          ))}
        </ul>
      </div>
      {outline.h3 && outline.h3.length ? (
        <div>
          <p className="text-xs font-semibold text-slate-600">H3 アイデア</p>
          <ul className="list-disc pl-5 text-sm text-slate-700">
            {outline.h3.map((heading) => (
              <li key={heading}>{heading}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {outline.faq && outline.faq.length ? (
        <div>
          <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-slate-600">
            <MdOutlineQuestionAnswer />
            FAQ
          </p>
          <ul className="space-y-2 text-sm text-slate-700">
            {outline.faq.map((item) => (
              <li key={item.q} className="rounded-md bg-white p-2 shadow-sm">
                <p className="font-semibold">Q. {item.q}</p>
                <p className="text-slate-600">A. {item.a}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function translateIntent(intent: GroupSummary['intent']) {
  switch (intent) {
    case 'info':
      return 'Informational';
    case 'trans':
      return 'Transactional';
    case 'local':
      return 'Local';
    case 'mixed':
      return 'Mixed';
    default:
      return intent;
  }
}
