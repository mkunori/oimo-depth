import { JSDOM } from 'jsdom';
import * as Plot from '@observablehq/plot';
import { getProductionPerSecond } from '../src/core/game';
import type { SimulationSuite } from '../src/simulation/suite';

const number = (value: number) => new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(value);
const axisNumber = (value: number) => new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3 }).format(value);
const time = (seconds: number | null | undefined): string => {
  if (seconds === null || seconds === undefined) return '未到達 / 未観測';
  if (seconds < 60) return `${number(seconds)}秒`;
  if (seconds < 3_600) return `${number(seconds / 60)}分`;
  if (seconds < 86_400) return `${number(seconds / 3_600)}時間`;
  if (seconds < 365 * 86_400) return `${number(seconds / 86_400)}日`;
  return `${number(seconds / 365 / 86_400)}年`;
};

function csv(rows: readonly (readonly (string | number | null)[])[]): string {
  return rows.map((row) => row.map((cell) => cell === null ? '' : `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n') + '\n';
}

function json(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item !== 'number') return item;
    if (!Number.isFinite(item)) throw new RangeError('Report must not contain NaN or Infinity.');
    return Number.isInteger(item) ? item : Number(item.toPrecision(12));
  }, 2) + '\n';
}

function chart(id: string, options: Plot.PlotOptions, legend: readonly { label: string; color: string }[] = [], note = ''): string {
  const document = new JSDOM('').window.document;
  const svg = Plot.plot({ document, className: `balance-${id}`, width: 1100, height: 440,
    marginTop: note ? 45 : 25, marginLeft: 85, marginBottom: 65, marginRight: legend.length > 0 ? 300 : 60,
    style: { background: 'white', color: '#302d25', fontSize: '13px', fontFamily: 'system-ui, sans-serif' },
    ...options });
  // SVG 単体で読める凡例を追加する（HTML 凡例や外部アセットを使わない）。
  for (const [index, entry] of legend.entries()) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const line = document.createElementNS(group.namespaceURI, 'line');
    line.setAttribute('x1', '820'); line.setAttribute('x2', '846');
    line.setAttribute('y1', String(65 + index * 28)); line.setAttribute('y2', String(65 + index * 28));
    line.setAttribute('stroke', entry.color); line.setAttribute('stroke-width', '3');
    const text = document.createElementNS(group.namespaceURI, 'text');
    text.setAttribute('x', '855'); text.setAttribute('y', String(69 + index * 28));
    text.setAttribute('text-anchor', 'start');
    text.textContent = entry.label;
    group.append(line, text); svg.append(group);
  }
  if (note) {
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', '85'); text.setAttribute('y', '23'); text.setAttribute('text-anchor', 'start'); text.textContent = note; svg.append(text);
  }
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return svg.outerHTML + '\n';
}

export function buildArtifacts(suite: SimulationSuite, coreSha256: string): Record<string, string> {
  const compactCampaigns = suite.campaigns.map(({ trace: _trace, runs, ...campaign }) => ({ ...campaign,
    runs: runs.map(({ result: { trace: _runTrace, ...result }, ...run }) => ({ ...run, result })),
  }));
  const compactBenchmarks = suite.benchmarks.map(({ result: { trace: _trace, ...result }, ...benchmark }) => ({ ...benchmark, result }));
  const { campaigns: _campaigns, benchmarks: _benchmarks, ...metadata } = suite;
  const files: Record<string, string> = {
    'results.json': json({ ...metadata, coreSha256, campaigns: compactCampaigns, benchmarks: compactBenchmarks }),
    'runs.csv': csv([
      ['scenario', 'run', 'completed', 'start_seconds', 'duration_seconds', 'score100k_observed_seconds', 'score100k_production_seconds',
        'score1m_observed_seconds', 'score1m_production_seconds', 'reward', 'capacity_at_end', 'bought_units', 'purchase_decisions',
        'offline_discarded_seconds', 'idle_at_cap_seconds', 'unspent_after', 'harvest_after', 'discount_after', 'starting_imo_after'],
      ...suite.campaigns.flatMap((campaign) => campaign.runs.map((run) => [
        campaign.scenario.id, run.run, String(run.result.completed), run.startsAtSeconds, run.result.elapsedSeconds,
        run.result.score100k?.observedSeconds ?? null, run.result.score100k?.productionSeconds ?? null,
        run.result.score1m?.observedSeconds ?? null, run.result.score1m?.productionSeconds ?? null, run.reward,
        getProductionPerSecond(run.result.state), run.result.purchases, run.result.purchaseDecisions,
        run.result.discardedOfflineSeconds, run.result.idleAtCapSeconds, run.afterPrestige?.permanent.unspentPoints ?? null,
        run.afterPrestige?.permanent.skillRanks.harvest ?? null, run.afterPrestige?.permanent.skillRanks.discount ?? null,
        run.afterPrestige?.permanent.skillRanks.startingImo ?? null,
      ])),
    ]),
    'timeline.csv': csv([
      ['scenario', 'run', 'event', 'wall_seconds', 'score', 'imo', 'capacity', 'actual_production', 'prestige_count', 'score_cap'],
      ...suite.campaigns.flatMap((campaign) => campaign.trace.map((point) => [campaign.scenario.id, point.run, point.kind,
        point.elapsedSeconds, point.score, point.imo, point.production, point.actualProduction, point.prestigeCount, point.scoreCap])),
    ]),
    'projections.csv': csv([
      ['from', 'to', 'assumed_multiplier', 'production', 'seconds', 'target_seconds', 'required_production', 'required_multiplier_from_reference'],
      ...suite.projections.map((row) => [row.from, row.to, row.multiplier, row.production, row.seconds, row.targetSeconds, row.requiredProduction, row.requiredMultiplier]),
    ]),
  };
  const lines = [
    '# 現行バランスのシミュレーション結果', '',
    `コア識別子（LF 正規化 SHA-256）: \`${coreSha256}\`。${suite.runCount}周回、打切り ${time(suite.maxSeconds)}。生成日時や乱数を含まない再現可能な結果です。`, '',
    'これは方策比較であり、最適解の探索やプレイヤー全体の平均ではありません。生産・価格・報酬・保存は実コアから計算しています。', '',
    '## 現行パラメータ', '',
    `基礎生産 ${number(suite.parameters.balance.baseProduction)}/秒、上限 ${number(suite.parameters.balance.scoreCap)}、転生解禁 ${number(suite.parameters.prestige.unlockScore)}、報酬 ${suite.parameters.prestige.earlyReward}/${suite.parameters.prestige.capReward}pt、オフライン上限 ${time(suite.parameters.offlineLimitSeconds)}。`, '',
    '| 設備 | 基礎価格 | 台数価格倍率 | 1台あたり生産 |', '| --- | ---: | ---: | ---: |',
    ...Object.values(suite.parameters.equipment).map((definition) => `| ${definition.name} | ${definition.basePrice} | ${definition.priceMultiplier} | ${definition.productionPerUnit}/秒 |`), '',
    '| スキル | 各ランク費用 | 最大ランク | 効果種別 / 1ランクあたり | 前提 |', '| --- | --- | ---: | --- | --- |',
    ...Object.values(suite.parameters.skills).map((definition) => `| ${definition.name} | ${definition.costs.join('/')}pt | ${definition.maxRank} | ${definition.effect.type} / ${definition.effect.perRank} | ${definition.prerequisites.map((required) => `${required.id} ${required.rank}`).join(', ') || 'なし'} |`), '',
    '## 初回到達と周回時間', '',
    '| 方策 | 10万を確認 | 100万を確認 | 初回転生 | 最終記録周の転生 | 完了周回 | 累計時間 | 1〜最終周の報酬 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const campaign of suite.campaigns) {
    const first = campaign.runs[0];
    const last = campaign.runs.at(-1);
    lines.push(`| ${campaign.scenario.label} (\`${campaign.scenario.id}\`) | ${time(first?.result.score100k?.observedSeconds)} | ${time(first?.result.score1m?.observedSeconds)} | ${first?.result.completed ? time(first.result.elapsedSeconds) : '打切り'} | ${last?.result.completed ? time(last.result.elapsedSeconds) : '打切り'} | ${campaign.completedRuns}/${campaign.requestedRuns} | ${time(campaign.elapsedSeconds)} | ${campaign.runs.map((run) => run.reward).join('/')}pt |`);
  }
  lines.push('', '未到達は0秒ではありません。早期転生では100万に届く前にリセットします。低頻度の早期方針でも、復帰時に上限へ達していれば実際の報酬は2ptです。', '',
    '## 成長・ポイント効率・待ち時間', '',
    '3倍/10倍は初周の生産能力が初期値に対して初めて到達した確認時刻。獲得ptは支出前の累計で、未使用ptとは別です。', '',
    '| 方策 | 初周3倍 | 初周10倍 | 累計6ptまで | 記録期間の獲得pt/時間 | 初周の上限停止時間 | オフライン24h超の切捨て合計 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const campaign of suite.campaigns) {
    const first = campaign.runs[0]?.result;
    const initialProduction = first?.trace[0]?.production ?? 1;
    const growthTime = (factor: number) => first?.trace.find((point) => point.production >= initialProduction * factor)?.elapsedSeconds;
    let earned = 0;
    let timeTo6pt: number | null = null;
    for (const run of campaign.runs) {
      earned += run.reward;
      if (earned >= 6 && timeTo6pt === null) timeTo6pt = run.startsAtSeconds + run.result.elapsedSeconds;
    }
    lines.push(`| \`${campaign.scenario.id}\` | ${time(growthTime(3))} | ${time(growthTime(10))} | ${time(timeTo6pt)} | ${number(earned / (campaign.elapsedSeconds / 3_600))} | ${time(first?.idleAtCapSeconds)} | ${time(campaign.runs.reduce((total, run) => total + run.result.discardedOfflineSeconds, 0))} |`);
  }
  lines.push('', '各6回の比較では報酬総量が違います。累計6ptの列は同じ報酬量で比較しますが、スキル投資・転生回数・将来の解禁条件が異なるため普遍的な最適解とは限りません。上限停止時間は反映対象時間内の停止で、24h超の切捨てとは別です。', '',
    '## 初回15分以内の設備成長', '',
    '転生はせず、上限到達または15分で測定を止めます。復帰予定が15分より後の方策は未観測で、途中に架空のログインを追加しません。', '',
    '| 方策 | 測定時間 | SCORE | 生産能力 / 初期比 | 購入台数 |', '| --- | ---: | ---: | ---: | ---: |');
  for (const benchmark of suite.benchmarks) {
    const campaign = suite.campaigns.find((item) => item.scenario.id === benchmark.scenarioId)!;
    const result = benchmark.result;
    const unobserved = campaign.scenario.presence === 'offline' && result.lastObservationSeconds === 0;
    lines.push(`| ${campaign.scenario.label} | ${unobserved ? '復帰なし（未観測）' : time(result.elapsedSeconds)} | ${unobserved ? '—' : number(result.state.runEarnedScore)} | ${unobserved ? '—' : `${number(getProductionPerSecond(result.state))} / ×${number(getProductionPerSecond(result.state))}`} | ${result.purchases} |`);
  }
  lines.push('', '## 各周回のポイント配分', '',
    '| 方策 | 転生後 | 経過 | 獲得pt | 未使用pt | 収穫 / 割引 / 初期所持芋ランク |', '| --- | ---: | ---: | ---: | ---: | --- |');
  for (const campaign of suite.campaigns) for (const run of campaign.runs) {
    const permanent = run.afterPrestige?.permanent;
    lines.push(`| \`${campaign.scenario.id}\` | ${run.run} | ${time(run.startsAtSeconds + run.result.elapsedSeconds)} | ${run.reward} | ${permanent?.unspentPoints ?? '—'} | ${permanent ? `${permanent.skillRanks.harvest} / ${permanent.skillRanks.discount} / ${permanent.skillRanks.startingImo}` : '打切り'} |`);
  }
  lines.push('', '## 限界突破後の仮定による試算', '',
    suite.projectionReference ? `参照は \`${suite.projectionReference.scenarioId}\` の第${suite.projectionReference.run}周・上限到達時の生産能力 **${number(suite.projectionReference.production)} 芋/秒**。生産力を固定し、上限だけ広げたと仮定します。下記の倍率は実装済みスキルや設備ではありません。` : '完了した参照周回がないため試算しません。', '',
    '| 区間 | 仮定の生産倍率 | 所要時間 | 6時間到達に必要な生産量 | 参照生産量に対する必要倍率 |', '| --- | ---: | ---: | ---: | ---: |');
  for (const row of suite.projections) lines.push(`| ${row.from.toExponential(0)} → ${row.to.toExponential(0)} | ×${row.multiplier} | ${time(row.seconds)} | ${number(row.requiredProduction)} /秒 | ×${number(row.requiredMultiplier)} |`);
  lines.push('', '6時間は1日4回確認する場合の設計比較用の目標で、決定済みの新仕様ではありません。設備追加・追加購入・研究・解禁費用・数値表現は未モデル化です。', '',
    '## 検証範囲と未確定事項', '', '| 項目 | 区分 | 内容 |', '| --- | --- | --- |',
    ...suite.coverage.map((row) => `| ${row.feature} | ${row.status} | ${row.detail} |`), '',
    '## 図と機械可読データ', '',
    '- [初周の SCORE 曲線](first-run.svg)', '- [経過時間と転生回数](prestige.svg)', '- [桁拡張の固定生産試算](projection.svg)',
    '- [全結果 JSON](results.json) / [周回 CSV](runs.csv) / [時系列 CSV](timeline.csv) / [将来試算 CSV](projections.csv)', '',
    '再生成方法・方策の定義・後続 Issue の判断材料は [検証ガイド](../README.md) を参照してください。', '');
  files['report.md'] = lines.join('\n');

  const ids = ['active-60-cap', 'active-60-early', 'offline-6h-cap', 'offline-12h-cap', 'offline-48h-cap'];
  const colors = ['#245e8a', '#ad421e', '#407b44', '#7b4b9b', '#70602c'];
  const defaults = suite.campaigns.filter((campaign) => ids.includes(campaign.scenario.id));
  const selected = defaults.length > 0 ? defaults : suite.campaigns.slice(0, 5);
  const domain = selected.map((campaign) => campaign.scenario.id);
  const range = selected.map((campaign, index) => colors[ids.indexOf(campaign.scenario.id)] ?? colors[index]!);
  const legend = domain.map((label, index) => ({ label, color: range[index]! }));
  const points = selected.flatMap((campaign) => campaign.trace.filter((point) => point.elapsedSeconds > 0)
    .map((point) => ({ ...point, id: campaign.scenario.id, hours: point.elapsedSeconds / 3_600 })));
  files['prestige.svg'] = chart('prestige', {
    ariaLabel: '現行コアの確認方策別、経過時間と累計転生回数。SCORE上限は全期間1e6のまま。',
    x: { type: 'log', label: '実経過時間 (hours, log)', tickFormat: axisNumber, grid: true }, y: { label: '累計転生回数', domain: [0, suite.runCount], ticks: Math.min(suite.runCount + 1, 10), grid: true },
    color: { domain, range }, marks: [Plot.lineY(points, { x: 'hours', y: 'prestigeCount', stroke: 'id', curve: 'step-after' })],
  }, legend, '最高 SCORE 上限: 1e6（全方策・全期間固定。限界突破は未実装）');
  const firstPoints = selected.flatMap((campaign) => campaign.runs[0]?.result.trace.filter((point) => point.elapsedSeconds > 0 && point.score > 0)
    .map((point) => ({ ...point, id: campaign.scenario.id, minutes: point.elapsedSeconds / 60 })) ?? []);
  files['first-run.svg'] = chart('score', {
    ariaLabel: '初周のSCORE成長と固定上限。確認時点を結ぶ線で、復帰前の自動購入や転生はない。',
    x: { type: 'log', label: '初周の実経過時間 (minutes, log)', tickFormat: axisNumber, grid: true }, y: { type: 'log', label: 'SCORE (log)', domain: [1, suite.parameters.balance.scoreCap], grid: true },
    color: { domain, range }, marks: [Plot.ruleY([suite.parameters.balance.scoreCap], { stroke: '#888', strokeDasharray: '4,4' }), Plot.lineY(firstPoints, { x: 'minutes', y: 'score', stroke: 'id' })],
  }, legend, '初周の確認値と上限到達推計。破線: 現行上限 1e6');
  const projectionPoints = suite.projections.map((row) => ({ ...row, stage: `${row.from.toExponential(0)} → ${row.to.toExponential(0)}`, hours: row.seconds / 3_600, factor: `×${row.multiplier}` }));
  files['projection.svg'] = chart('projection', {
    ariaLabel: '仮定の固定生産量で桁拡張した所要時間。現行の到達結果ではない。',
    x: { label: '将来の仮定区間', domain: [...new Set(projectionPoints.map((point) => point.stage))] },
    y: { type: 'log', label: '所要時間 (hours, log)', tickFormat: axisNumber, ticks: 8, grid: true },
    color: { domain: ['×1', '×10', '×100', '×1000'], range: colors.slice(0, 4) },
    marks: [Plot.ruleY([6], { stroke: '#888', strokeDasharray: '4,4' }), Plot.dot(projectionPoints, { x: 'stage', y: 'hours', stroke: 'factor', r: 5 })],
  }, ['×1', '×10', '×100', '×1000'].map((label, index) => ({ label: `仮定倍率 ${label}`, color: colors[index]! })),
  suite.projectionReference ? '固定生産の仮定による試算。破線: 設計比較用の6時間目標' : '完了した参照周回がないため、所要時間は未試算');
  return files;
}
