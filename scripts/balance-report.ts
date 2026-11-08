import { JSDOM } from 'jsdom';
import * as Plot from '@observablehq/plot';
import { getProductionPerSecond, getRootLink } from '../src/core/game';
import type { SimulationSuite } from '../src/simulation/suite';
import { EQUIPMENT_IDS, INITIAL_EQUIPMENT_IDS } from '../src/data/equipment';
import { SCORE_CAP_STAGES } from '../src/data/scoreCaps';
import { AUTOMATION_POLICIES } from '../src/data/automation';
import { GameNumber, gn, encodeGameNumbers } from '../src/core/numbers';
import { getDigSpeed, getStratum } from '../src/core/excavation';
import { STRATA } from '../src/data/depth';
import { GEAR_PRESETS } from '../src/data/gearModes';

const number = (value: number | GameNumber) => value instanceof GameNumber ? value.format(12) : new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(value);
const axisNumber = (value: number) => new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3 }).format(value);
const time = (seconds: number | null | undefined): string => {
  if (seconds === null || seconds === undefined) return '未到達 / 未観測';
  if (seconds < 60) return `${number(seconds)}秒`;
  if (seconds < 3_600) return `${number(seconds / 60)}分`;
  if (seconds < 86_400) return `${number(seconds / 3_600)}時間`;
  if (seconds < 365 * 86_400) return `${number(seconds / 86_400)}日`;
  return `${number(seconds / 365 / 86_400)}年`;
};

/** Native origin samples use the same 12 significant digits as JSON samples.
 * Amounts retain canonical, lossless components; cross-platform last-bit
 * differences are checked against the documented report tolerances. */
function originReportValue(value: unknown): unknown {
  if (value instanceof GameNumber) return value.toString();
  if (typeof value === 'number') return Number.isInteger(value) ? value : Number(value.toPrecision(12));
  if (Array.isArray(value)) return value.map(originReportValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, originReportValue(item)]));
  return value;
}
function csv(rows: readonly (readonly (string | number | GameNumber | null)[])[], origin = false): string {
  return rows.map((row) => row.map((cell) => cell === null ? '' : `"${String(origin ? originReportValue(cell) : cell).replaceAll('"', '""')}"`).join(',')).join('\n') + '\n';
}

function json(value: unknown): string {
  return JSON.stringify(encodeGameNumbers(value), (_key, item: unknown) => {
    if (typeof item !== 'number') return item;
    if (!Number.isFinite(item)) throw new RangeError('Report must not contain NaN or Infinity.');
    return Number.isInteger(item) ? item : Number(item.toPrecision(12));
  }, 2) + '\n';
}

function chart(id: string, options: Plot.PlotOptions, legend: readonly { label: string; color: string }[] = [], note = ''): string {
  if (['score', 'expansion', 'breakthrough', 'automation', 'research', 'root', 'origin', 'root-cycle', 'gear', 'gear-modes'].includes(id)) {
    const domain = options.y?.domain ? Array.from(options.y.domain, (value: unknown) => gn(value as number | GameNumber).log10().toFiniteNumber()) : undefined;
    options = { ...options, y: { ...options.y, type: 'linear', domain, tickFormat: (value: number) => `10^${Number(value.toFixed(2))}` } };
  }
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

/** Plot logarithmic coordinates; a 1e1000 amount must never become Infinity in SVG data. */
function amountLineY(data: Plot.Data, options: Plot.LineYOptions) {
  const field = options.y;
  return field === 'score' || field === 'scoreCap'
    ? Plot.lineY(data, { ...options, y: (point: Record<string, GameNumber>) => point[String(field)]!.log10().toFiniteNumber() })
    : Plot.lineY(data, options);
}
function amountRuleY(data: readonly (number | GameNumber)[], options: Plot.RuleYOptions) {
  return Plot.ruleY(data.map((value) => value instanceof GameNumber ? value.log10().toFiniteNumber() : value), options);
}

export function buildArtifacts(suite: SimulationSuite, coreSha256: string): Record<string, string> {
  const compactCampaigns = suite.campaigns.map(({ trace: _trace, runs, ...campaign }) => ({ ...campaign,
    runs: runs.map(({ result: { trace: _runTrace, ...result }, ...run }) => ({ ...run, result })),
  }));
  const compactBenchmarks = suite.benchmarks.map(({ result: { trace: _trace, ...result }, ...benchmark }) => ({ ...benchmark, result }));
  const compactExpansion = suite.expansion.map(({ result: { trace: _trace, ...result }, ...trial }) => ({ ...trial, result }));
  const compactJourney = ({ trace: _trace, runs, expansion, ...journey }: SimulationSuite['breakthroughJourneys'][number]) => {
    const { trace: _expansionTrace, ...afterExpansion } = expansion ?? {};
    return { ...journey, expansion: expansion ? afterExpansion : null,
      runs: runs.map(({ result: { trace: _runTrace, ...result }, ...run }) => ({ ...run, result })) };
  };
  const compactJourneys = suite.breakthroughJourneys.map(compactJourney);
  const compactAutomation = { journeys: suite.automation.journeys.map(compactJourney),
    trials: suite.automation.trials.map(({ result: { trace: _trace, ...result }, ...trial }) => ({ ...trial, result })) };
  const compactResearch = suite.research.map(({ result: { trace: _trace, ...result }, ...trial }) => ({ ...trial, result }));
  const compactRoots = suite.rootConnections.map(({ result: { trace: _trace, ...result }, ...trial }) => ({ ...trial, result }));
  const compactOrigins = suite.origins.map(({ result: { trace: _trace, ...result }, ...trial }) => ({ ...trial, result }));
  const compactDeepPrestige = suite.deepPrestige.map(({ result: { trace: _trace, ...result }, cycles, ...trial }) => ({ ...trial, result,
    cycles: cycles.map(({ result: { trace: _cycleTrace, ...cycleResult }, ...cycle }) => ({ ...cycle, result: cycleResult })) }));
  const compactRootCycles = suite.rootCycles.map(({ trace: _trace, stages, ...trial }) => ({ ...trial,
    stages: stages.map(({ result: { trace: _stageTrace, ...result }, ...stage }) => ({ ...stage, result })) }));
  const compactGear = suite.gear.map(({ trace: _trace, cycles, ...trial }) => ({ ...trial, cycles: cycles.map(({ stages, ...cycle }) => ({ ...cycle,
    stages: stages.map(({ result: { trace: _stageTrace, ...result }, ...stage }) => ({ ...stage, result })) })) }));
  const compactGearModes = suite.gearModes.map(({ trace: _trace, cycles, ...trial }) => ({ ...trial, cycles: cycles.map(({ stages, ...cycle }) => ({ ...cycle,
    stages: stages.map(({ result: { trace: _stageTrace, ...result }, ...stage }) => ({ ...stage, result })) })) }));
  const compactDepth = {
    campaigns: suite.depth.campaigns.map(({ result: { trace: _trace, runs, ...result }, ...trial }) => ({ ...trial, result: { ...result,
      runs: runs.map(({ result: { trace: _runTrace, ...runResult }, ...run }) => ({ ...run, result: runResult })) } })),
    late: suite.depth.late.map(({ result: { trace: _trace, ...result }, resumed: { trace: _resumedTrace, ...resumed }, ...trial }) => ({ ...trial, result, resumed })),
  };
  const { campaigns: _campaigns, benchmarks: _benchmarks, expansion: _expansion, breakthroughJourneys: _journeys, automation: _automation, research: _research, rootConnections: _roots, origins: _origins, rootCycles: _rootCycles, gear: _gear, gearModes: _gearModes, deepPrestige: _deepPrestige, depth: _depth, ...metadata } = suite;
  const files: Record<string, string> = {
    'results.json': json({ ...metadata, coreSha256, campaigns: compactCampaigns, benchmarks: compactBenchmarks, expansion: compactExpansion, breakthroughJourneys: compactJourneys, automation: compactAutomation, research: compactResearch, rootConnections: compactRoots, origins: originReportValue(compactOrigins), rootCycles: originReportValue(compactRootCycles), gear: originReportValue(compactGear), gearModes: originReportValue(compactGearModes), deepPrestige: originReportValue(compactDeepPrestige), depth: compactDepth }),
    'deep-prestige.csv': csv([
      ['scenario', 'cycle', 'visit_seconds', 'automated', 'starting_stage', 'starting_score', 'starting_imo', 'analysis_count', 'skill_lock', 'earned_points', 'lost_points', 'unspent_points', 'ranks', 'completed', 'seconds', 'final_score', 'depth_meters'],
      ...suite.deepPrestige.flatMap((trial) => trial.cycles.map((cycle) => [trial.scenario.id, cycle.cycle, trial.scenario.visitSeconds, String(trial.automated), cycle.afterPrestige.scoreCapStage,
        cycle.afterPrestige.runEarnedScore, cycle.afterPrestige.imo, cycle.afterPrestige.permanent.deepResearchCount, String(cycle.afterPrestige.postDeepResearchSkillLock),
        cycle.initialState.permanent.lifetimePrestigePointsEarned, cycle.initialState.permanent.pointsLostByDeepResearch, cycle.initialState.permanent.unspentPoints,
        Object.entries(cycle.initialState.permanent.skillRanks).map(([id, rank]) => `${id}:${rank}`).join('/'),
        String(cycle.result.completed), cycle.result.elapsedSeconds, cycle.result.state.runEarnedScore, cycle.result.state.permanent.depthMeters])),
    ], true),
    'gear-modes.csv': csv([
      ['scenario', 'preset', 'cycle', 'completed', 'seconds', 'production', 'depth_meters', 'unlocked', 'unlock_order', 'modes'],
      ...suite.gearModes.flatMap((trial) => trial.cycles.map((cycle) => [trial.scenario.id, trial.scenario.gearModePreset ?? null, cycle.cycle, String(cycle.completed), cycle.elapsedSeconds,
        cycle.production, cycle.state.permanent.depthMeters, cycle.unlocked.join('/'),
        trial.trace.filter((p) => p.run === cycle.cycle && p.kind === 'gear-unlock').map((p) => `${p.elapsedSeconds}:${Object.entries(p.gearUnlocked).filter(([, v]) => v).map(([id]) => id).join('+')}`).join('/'),
        Object.entries(cycle.state.permanent.gearModes).map(([id, mode]) => `${id}:${mode}`).join('/')])),
    ], true),
    'gear-modes-timeline.csv': csv([
      ['scenario', 'cycle', 'event', 'seconds', 'score', 'imo', 'production', 'depth_meters', 'actual_dig_speed', 'modes', 'unlocked'],
      ...suite.gearModes.flatMap((trial) => trial.trace.map((point) => [trial.scenario.id, point.run, point.kind, point.elapsedSeconds, point.score, point.imo,
        point.actualProduction, point.depthMeters, point.digSpeed, Object.entries(point.gearModes).map(([id, mode]) => `${id}:${mode}`).join('/'), Object.entries(point.gearUnlocked).filter(([, v]) => v).map(([id]) => id).join('/')])),
    ], true),
    'gear.csv': csv([
      ['scenario', 'policy', 'cycle', 'completed', 'seconds', 'total_seconds', 'first_root_seconds', 'gear_multiplier', 'unlocked', 'spent_score', 'cumulative_score', 'spendable_score', 'production', 'depth_meters'],
      ...suite.gear.flatMap((trial) => trial.cycles.map((cycle) => [trial.scenario.id, trial.policy, cycle.cycle, String(cycle.completed), cycle.elapsedSeconds,
        trial.firstRootSeconds + cycle.startsAtSeconds + cycle.elapsedSeconds, trial.firstRootSeconds, cycle.multiplier, cycle.unlocked.join('/'), cycle.state.scoreSpentThisRun,
        cycle.state.runEarnedScore, cycle.state.runEarnedScore.subtract(cycle.state.scoreSpentThisRun), cycle.production, cycle.state.permanent.depthMeters])),
    ], true),
    'gear-timeline.csv': csv([
      ['scenario', 'cycle', 'event', 'seconds', 'score', 'imo', 'spent_score', 'spendable_score', 'production', 'gear_multiplier', 'unlocked', 'depth_meters'],
      ...suite.gear.flatMap((trial) => trial.trace.map((point) => [trial.scenario.id, point.run, point.kind, point.elapsedSeconds, point.score, point.imo,
        point.scoreSpentThisRun, point.spendableScore, point.production, point.gearMultiplier,
        Object.entries(point.gearUnlocked).filter(([, value]) => value).map(([id]) => id).join('/'), point.depthMeters])),
    ], true),
    'root-cycle.csv': csv([
      ['scenario', 'automated', 'choice', 'visit_seconds', 'completed', 'first_root_seconds', 'second_root_seconds', 'total_seconds', 'initial_production', 'final_production', 'first_depth_meters', 'second_depth_meters', 'normal_prestige_count', 'normal_points', 'root_count', 'root_crystals', 'idle_at_cap_seconds', 'stage0_seconds', 'stage1_seconds', 'stage2_seconds', 'stage3_seconds', 'stage4_seconds'],
      ...suite.rootCycles.map((trial) => [trial.scenario.id, String(trial.automated), trial.choice, trial.scenario.visitSeconds, String(trial.completed),
        trial.firstRootSeconds, trial.elapsedSeconds, trial.totalSeconds, trial.initialProduction, trial.finalProduction,
        trial.firstState.permanent.depthMeters, trial.state.permanent.depthMeters, trial.state.permanent.prestigeCount, trial.state.permanent.unspentPoints,
        trial.afterSecondRoot?.permanent.rootRebirthCount ?? trial.state.permanent.rootRebirthCount, trial.afterSecondRoot?.permanent.unspentRootCrystals ?? trial.state.permanent.unspentRootCrystals,
        trial.stages.reduce((sum, stage) => sum + stage.result.idleAtCapSeconds, 0), ...[0, 1, 2, 3, 4].map((stage) => trial.stages[stage]?.result.elapsedSeconds ?? null)]),
    ], true),
    'root-cycle-timeline.csv': csv([
      ['scenario', 'stage', 'event', 'seconds', 'score', 'imo', 'production', 'actual_production', 'depth_meters', ...EQUIPMENT_IDS],
      ...suite.rootCycles.flatMap((trial) => trial.stages.flatMap((stage) => stage.result.trace.map((point) => [trial.scenario.id, stage.stage, point.kind,
        stage.startsAtSeconds + point.elapsedSeconds, point.score, point.imo, point.production, point.actualProduction, point.depthMeters, ...EQUIPMENT_IDS.map((id) => point.equipmentCounts[id])]))),
    ], true),
    'origin.csv': csv([
      ['scenario', 'automated', 'policy', 'visit_seconds', 'completed', 'before_analysis_seconds', 'after_analysis_seconds', 'total_seconds', 'idle_at_cap_seconds', 'purchases', 'initial_production', 'final_production', 'links', 'harvest_rank', 'link_rank', 'depth_meters', ...EQUIPMENT_IDS],
      ...suite.origins.map((trial) => [trial.scenario.id, String(trial.automated), trial.policy, trial.scenario.visitSeconds, String(trial.result.completed),
        trial.beforeAnalysisSeconds, trial.result.elapsedSeconds, trial.totalSeconds, trial.result.idleAtCapSeconds, trial.result.purchases,
        trial.initialProduction, trial.finalProduction, trial.links, trial.result.state.originResearchRanks.harvest, trial.result.state.originResearchRanks.link,
        trial.result.state.permanent.depthMeters, ...EQUIPMENT_IDS.map((id) => trial.result.state.equipmentCounts[id])]),
    ], true),
    'origin-timeline.csv': csv([
      ['scenario', 'event', 'seconds', 'total_seconds', 'score', 'imo', 'production', 'actual_production', 'links', 'harvest_rank', 'link_rank', 'depth_meters', 'actual_dig_speed', ...EQUIPMENT_IDS],
      ...suite.origins.flatMap((trial) => trial.result.trace.map((point) => [trial.scenario.id, point.kind, point.elapsedSeconds, trial.beforeAnalysisSeconds + point.elapsedSeconds,
        point.score, point.imo, point.production, point.actualProduction, getRootLink(point.equipmentCounts).linked,
        point.originResearchRanks.harvest, point.originResearchRanks.link, point.depthMeters, point.digSpeed, ...EQUIPMENT_IDS.map((id) => point.equipmentCounts[id])])),
    ], true),
    'depth.csv': csv([
      ['scenario', 'band', 'dig_research', 'visit_seconds', 'run', 'completed', 'seconds', 'score', 'depth_meters', 'stratum', 'dig_speed_capacity', 'idle_at_score_cap_seconds', 'basic_rank', 'vein_rank'],
      ...suite.depth.campaigns.flatMap((trial) => trial.result.runs.map((run) => [trial.scenario.id, '1e6', String(trial.digResearch), trial.scenario.visitSeconds, run.run,
        String(run.result.completed), run.result.elapsedSeconds, run.result.state.runEarnedScore, run.result.state.permanent.depthMeters, STRATA[getStratum(run.result.state.permanent.depthMeters)]!.name,
        getDigSpeed(run.result.state), run.result.idleAtCapSeconds, run.result.state.permanent.digResearchRanks.basic, run.result.state.permanent.digResearchRanks.vein])),
      ...suite.depth.late.flatMap((trial) => ([['1e15', trial.result], ['post-prestige-early-target', trial.resumed]] as const).map(([band, result]) => [trial.scenario.id, band, String(trial.digResearch), trial.scenario.visitSeconds, 1,
        String(result.completed), result.elapsedSeconds, result.state.runEarnedScore, result.state.permanent.depthMeters, STRATA[getStratum(result.state.permanent.depthMeters)]!.name,
        getDigSpeed(result.state), result.idleAtCapSeconds, result.state.permanent.digResearchRanks.basic, result.state.permanent.digResearchRanks.vein])),
    ]),
    'depth-timeline.csv': csv([
      ['scenario', 'run', 'event', 'seconds', 'score', 'depth_meters', 'stratum', 'dig_power', 'actual_dig_speed', 'basic_rank', 'vein_rank'],
      ...suite.depth.campaigns.flatMap((trial) => trial.result.trace.map((point) => [trial.scenario.id, point.run, point.kind, point.elapsedSeconds, point.score, point.depthMeters, point.stratum, point.digPower, point.digSpeed, point.digResearchRanks.basic, point.digResearchRanks.vein])),
      ...suite.depth.late.flatMap((trial) => trial.result.trace.map((point) => [trial.scenario.id, point.run, point.kind, point.elapsedSeconds, point.score, point.depthMeters, point.stratum, point.digPower, point.digSpeed, point.digResearchRanks.basic, point.digResearchRanks.vein])),
    ]),
    'root-connection.csv': csv([
      ['scenario', 'automated', 'policy', 'visit_seconds', 'completed', 'before_connection_seconds', 'after_connection_seconds', 'total_seconds', 'purchases', 'idle_at_cap_seconds', 'initial_production', 'final_production', 'production_multiplier', 'links', ...EQUIPMENT_IDS],
      ...suite.rootConnections.map((trial) => [trial.scenario.id, String(trial.automated), trial.policy, trial.scenario.visitSeconds, String(trial.result.completed),
        trial.beforeConnectionSeconds, trial.result.elapsedSeconds, trial.totalSeconds, trial.result.purchases, trial.result.idleAtCapSeconds,
        trial.initialProduction, trial.finalProduction, trial.productionMultiplier, trial.links, ...EQUIPMENT_IDS.map((id) => trial.result.state.equipmentCounts[id])]),
    ]),
    'root-connection-timeline.csv': csv([
      ['scenario', 'event', 'seconds', 'score', 'imo', 'production', 'actual_production', 'links', 'link_base_production', 'geology_rank', 'resonance_rank', ...EQUIPMENT_IDS],
      ...suite.rootConnections.flatMap((trial) => trial.result.trace.map((point) => [trial.scenario.id, point.kind, point.elapsedSeconds, point.score, point.imo,
        point.production, point.actualProduction, getRootLink(point.equipmentCounts).linked, getRootLink(point.equipmentCounts).baseProduction,
        point.researchRanks.geology, point.researchRanks.resonance, ...EQUIPMENT_IDS.map((id) => point.equipmentCounts[id])])),
    ]),
    'research.csv': csv([
      ['scenario', 'automated', 'policy', 'visit_seconds', 'completed', 'before_research_seconds', 'after_research_seconds', 'total_seconds', 'idle_at_cap_seconds',
        'cap_only_fixed_production_seconds', 'initial_production', 'final_production', 'production_multiplier', 'geology_rank', 'resonance_rank', ...EQUIPMENT_IDS],
      ...suite.research.map((trial) => [trial.scenario.id, String(trial.automated), trial.policy, trial.scenario.visitSeconds, String(trial.result.completed),
        trial.beforeResearchSeconds, trial.result.elapsedSeconds, trial.totalSeconds, trial.result.idleAtCapSeconds, trial.capOnlySeconds,
        trial.initialProduction, trial.finalProduction, trial.productionMultiplier, trial.result.state.researchRanks.geology, trial.result.state.researchRanks.resonance,
        ...EQUIPMENT_IDS.map((id) => trial.result.state.equipmentCounts[id])]),
    ]),
    'research-timeline.csv': csv([
      ['scenario', 'event', 'seconds', 'score', 'imo', 'production', 'actual_production', 'geology_rank', 'resonance_rank', ...EQUIPMENT_IDS],
      ...suite.research.flatMap((trial) => trial.result.trace.map((point) => [trial.scenario.id, point.kind, point.elapsedSeconds, point.score, point.imo,
        point.production, point.actualProduction, point.researchRanks.geology, point.researchRanks.resonance, ...EQUIPMENT_IDS.map((id) => point.equipmentCounts[id])])),
    ]),
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
      ['scenario', 'run', 'event', 'wall_seconds', 'score', 'imo', 'capacity', 'actual_production', 'prestige_count', 'score_cap', ...EQUIPMENT_IDS],
      ...suite.campaigns.flatMap((campaign) => campaign.trace.map((point) => [campaign.scenario.id, point.run, point.kind,
        point.elapsedSeconds, point.score, point.imo, point.production, point.actualProduction, point.prestigeCount, point.scoreCap, ...EQUIPMENT_IDS.map((id) => point.equipmentCounts[id])])),
    ]),
    'projections.csv': csv([
      ['from', 'to', 'assumed_multiplier', 'production', 'seconds', 'target_seconds', 'required_production', 'required_multiplier_from_reference'],
      ...suite.projections.map((row) => [row.from, row.to, row.multiplier, row.production, row.seconds, row.targetSeconds, row.requiredProduction, row.requiredMultiplier]),
    ]),
    'expansion.csv': csv([
      ['scenario', 'assumed', 'actual_save_supported', 'equipment_policy', 'completed', 'seconds', 'initial_production', 'final_production', ...EQUIPMENT_IDS],
      ...suite.expansion.map((trial) => [trial.scenario.id, String(trial.assumed), String(trial.actualSaveSupported), trial.policy, String(trial.result.completed), trial.result.elapsedSeconds,
        getProductionPerSecond(trial.initialState), trial.finalProduction, ...EQUIPMENT_IDS.map((id) => trial.result.state.equipmentCounts[id])]),
    ]),
    'expansion-timeline.csv': csv([
      ['scenario', 'assumed', 'event', 'seconds', 'score', 'production', ...EQUIPMENT_IDS],
      ...suite.expansion.flatMap((trial) => trial.result.trace.map((point) => [trial.scenario.id, String(trial.assumed), point.kind, point.elapsedSeconds, point.score, point.production, ...EQUIPMENT_IDS.map((id) => point.equipmentCounts[id])])),
    ]),
    'breakthrough.csv': csv([
      ['scenario', 'completed', 'first_1m_seconds', 'permission_seconds', 'breakthrough_seconds', 'prestige_count_at_breakthrough', 'points_earned_before_breakthrough', 'expansion_seconds', 'total_seconds', 'idle_at_1e9_seconds', ...EQUIPMENT_IDS],
      ...suite.breakthroughJourneys.map((journey) => [journey.scenario.id, String(journey.completed), journey.firstScore1mSeconds, journey.permissionAtSeconds, journey.breakthroughAtSeconds,
        journey.beforeBreakthrough?.permanent.prestigeCount ?? null, journey.runs.reduce((sum, run) => sum + run.reward, 0),
        journey.expansion?.elapsedSeconds ?? null, journey.elapsedSeconds, journey.expansion?.idleAtCapSeconds ?? null, ...EQUIPMENT_IDS.map((id) => journey.state.equipmentCounts[id])]),
    ]),
    'breakthrough-timeline.csv': csv([
      ['scenario', 'run', 'event', 'wall_seconds', 'score', 'imo', 'capacity', 'actual_production', 'prestige_count', 'score_cap', ...EQUIPMENT_IDS],
      ...suite.breakthroughJourneys.flatMap((journey) => journey.trace.map((point) => [journey.scenario.id, point.run, point.kind, point.elapsedSeconds, point.score, point.imo, point.production, point.actualProduction, point.prestigeCount, point.scoreCap, ...EQUIPMENT_IDS.map((id) => point.equipmentCounts[id])])),
    ]),
    'automation.csv': csv([
      ['scenario', 'stage', 'policy', 'visit_seconds', 'completed', 'seconds', 'idle_at_cap_seconds', 'automatic_purchases', 'production', ...EQUIPMENT_IDS],
      ...suite.automation.trials.map((trial) => [trial.scenario.id, trial.stage, trial.policy, trial.scenario.visitSeconds, String(trial.result.completed), trial.result.elapsedSeconds,
        trial.result.idleAtCapSeconds, trial.result.automaticPurchases, getProductionPerSecond(trial.result.state), ...EQUIPMENT_IDS.map((id) => trial.result.state.equipmentCounts[id])]),
    ]),
    'automation-timeline.csv': csv([
      ['scenario', 'event', 'seconds', 'score', 'imo', 'production', 'actual_production', 'score_cap', ...EQUIPMENT_IDS],
      ...suite.automation.trials.flatMap((trial) => trial.result.trace.map((point) => [trial.scenario.id, point.kind, point.elapsedSeconds, point.score, point.imo, point.production, point.actualProduction, point.scoreCap, ...EQUIPMENT_IDS.map((id) => point.equipmentCounts[id])])),
    ]),
    'automation-journeys.csv': csv([
      ['scenario', 'policy', 'visit_seconds', 'completed', 'first_1m_seconds', 'permission_seconds', 'breakthrough_seconds', 'prestige_count_at_breakthrough', 'points_earned', 'expansion_seconds', 'total_seconds'],
      ...suite.automation.journeys.map((journey) => [journey.scenario.id, journey.scenario.automation ?? 'off', journey.scenario.visitSeconds, String(journey.completed), journey.firstScore1mSeconds,
        journey.permissionAtSeconds, journey.breakthroughAtSeconds, journey.beforeBreakthrough?.permanent.prestigeCount ?? null,
        journey.runs.reduce((sum, run) => sum + run.reward, 0), journey.expansion?.elapsedSeconds ?? null, journey.elapsedSeconds]),
    ]),
  };
  const lines = [
    '# 現行バランスのシミュレーション結果', '',
    `コア識別子（LF 正規化 SHA-256）: \`${coreSha256}\`。${suite.runCount}周回、打切り ${time(suite.maxSeconds)}。生成日時や乱数を含まない再現可能な結果です。`, '',
    'これは方策比較であり、最適解の探索やプレイヤー全体の平均ではありません。生産・価格・報酬・保存は実コアから計算しています。', '',
    '結果形式v2・セーブv16。JSON/CSVの芋金額・SCORE支出・生産速度はgn1文字列、台数・ランク・秒数・DEPTH・掘削速度はnumberです。数値移行は [巨大数移行](../../number-migration.md)、深層解析と通常転生後の上限維持は [深層記憶](../../deep-memory.md)、第3突破は [設備連携](../../root-connection.md)、恒久深度は [DEPTH](../../depth.md)、第4突破は [根源領域](../../origin.md)、根源転生は [ROOT](../../root-rebirth.md)、恒久装備は [装備](../../gear.md)、構成切替は [効果モード](../../gear-modes.md) を参照してください。', '',
    '## 現行パラメータ', '',
    `基礎生産 ${number(suite.parameters.balance.baseProduction)}/秒、上限 ${number(suite.parameters.balance.scoreCap)}、転生解禁 ${number(suite.parameters.prestige.unlockScore)}、報酬 ${suite.parameters.prestigeRewards[0].points}〜${suite.parameters.prestigeRewards.at(-1)!.points}pt、オフライン上限 ${time(suite.parameters.offlineLimitSeconds)}。`, '',
    '| 設備 | 基礎価格 | 台数価格倍率 | 1台あたり基礎生産 | 解禁する上限 | 台数/追加倍率（乗算） |', '| --- | ---: | ---: | ---: | ---: | --- |',
    ...Object.values(suite.parameters.equipment).map((definition) => `| ${definition.name} | ${number(definition.basePrice)} | ${number(definition.priceMultiplier)} | ${number(definition.productionPerUnit)}/秒 | ${number(definition.unlockAtScoreCap)} | ${definition.milestones.map((milestone) => `${milestone.count}台/×${milestone.multiplier}`).join('、') || 'なし'} |`), '',
    '| スキル | 各ランク費用 | 最大ランク | 効果種別 / 1ランクあたり | 前提 |', '| --- | --- | ---: | --- | --- |',
    ...Object.values(suite.parameters.skills).map((definition) => `| ${definition.name} | ${definition.costs.join('/')}pt | ${definition.maxRank} | ${definition.effect.type} / ${definition.effect.type === 'startingImo' ? definition.effect.values.join('/') : definition.effect.perRank} | ${[...definition.prerequisites.map((required) => `${required.id} ${required.rank}`), ...(definition.minimumPrestigeCount ? [`転生${definition.minimumPrestigeCount}回`] : [])].join(', ') || 'なし'} |`), '',
    '## 初回到達と周回時間', '',
    '| 方策 | 10万を確認 | 100万を確認 | 初回転生 | 最終記録周の転生 | 完了周回 | 累計時間 | 1〜最終周の報酬 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const campaign of suite.campaigns) {
    const first = campaign.runs[0];
    const last = campaign.runs.at(-1);
    lines.push(`| ${campaign.scenario.label} (\`${campaign.scenario.id}\`) | ${time(first?.result.score100k?.observedSeconds)} | ${time(first?.result.score1m?.observedSeconds)} | ${first?.result.completed ? time(first.result.elapsedSeconds) : '打切り'} | ${last?.result.completed ? time(last.result.elapsedSeconds) : '打切り'} | ${campaign.completedRuns}/${campaign.requestedRuns} | ${time(campaign.elapsedSeconds)} | ${campaign.runs.map((run) => run.reward).join('/')}pt |`);
  }
  lines.push('', '## Issue #4 からの設備変更前後', '',
    `変更前は ${suite.equipmentBaseline.source} の固定スナップショット（コア \`${suite.equipmentBaseline.coreSha256}\`）。同じ方策の完了6周回だけを比較します。`, '',
    '| 方策 | 初周 前→後 | 6周合計 前→後 | 初周停止時間 前→後 | 各周の分数 前→後 |', '| --- | --- | --- | --- | --- |');
  for (const campaign of suite.campaigns) {
    const before = suite.equipmentBaseline.campaigns.find((item) => item.id === campaign.scenario.id);
    if (!before || campaign.requestedRuns !== 6 || campaign.completedRuns !== 6) continue;
    lines.push(`| \`${campaign.scenario.id}\` | ${time(before.runs[0]?.seconds)} → ${time(campaign.runs[0]?.result.elapsedSeconds)} | ${time(before.elapsedSeconds)} → ${time(campaign.elapsedSeconds)} | ${time(before.runs[0]?.idleAtCapSeconds)} → ${time(campaign.runs[0]?.result.idleAtCapSeconds)} | ${before.runs.map((run) => number(run.seconds / 60)).join('/')} → ${campaign.runs.map((run) => number(run.result.elapsedSeconds / 60)).join('/')} |`);
  }
  lines.push('', '## 台数マイルストーンの到達可能性', '',
    `初期上限1e6の${suite.runCount}周回で観測した最大所有数と、各台数を初めて確認した周回。未到達は仮定の1e9段階での確認と区別します。`, '',
    '| 方策 | 設備 | 最大所有 | 10台 | 25台 | 50台 |', '| --- | --- | ---: | --- | --- | --- |');
  for (const campaign of suite.campaigns.filter((item) => ['active-60-cap', 'continuous-cap', 'offline-6h-cap', 'offline-12h-cap'].includes(item.scenario.id))) {
    for (const id of INITIAL_EQUIPMENT_IDS) {
      const maximum = Math.max(...campaign.runs.map((run) => run.result.state.equipmentCounts[id]));
      const reached = [10, 25, 50].map((count) => {
        const point = campaign.trace.find((point) => point.equipmentCounts[id] >= count);
        return point ? `第${point.run}周 / 累計${time(point.elapsedSeconds)}` : '未到達';
      });
      lines.push(`| \`${campaign.scenario.id}\` | ${suite.parameters.equipment[id].name} | ${maximum} | ${reached.join(' | ')} |`);
    }
  }
  lines.push('', '未到達は0秒ではありません。早期転生では100万に届く前にリセットします。低頻度の早期方針でも、復帰時に上限へ達していれば実際の報酬は2ptです。', '',
    '## 成長・ポイント効率・待ち時間', '',
    '3倍/10倍は初周の生産能力が初期値に対して初めて到達した確認時刻。獲得ptは支出前の累計で、未使用ptとは別です。', '',
    '| 方策 | 初周3倍 | 初周10倍 | 累計6ptまで | 記録期間の獲得pt/時間 | 初周の上限停止時間 | オフライン24h超の切捨て合計 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const campaign of suite.campaigns) {
    const first = campaign.runs[0]?.result;
    const initialProduction = first?.trace[0]?.production ?? gn(1);
    const growthTime = (factor: number) => first?.trace.find((point) => point.production.gte(initialProduction.multiply(factor)))?.elapsedSeconds;
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
  for (const row of suite.projections) lines.push(`| ${row.from.format(1)} → ${row.to.format(1)} | ×${row.multiplier} | ${time(row.seconds)} | ${number(row.requiredProduction)} /秒 | ×${number(row.requiredMultiplier)} |`);
  lines.push('', '6時間は1日4回確認する場合の設計比較用の目標で、決定済みの新仕様ではありません。この固定生産試算では設備追加・追加購入・研究・解禁費用・将来の数値表現をモデル化していません。', '',
    '## 初期状態から突破権取得・同一周回で1e9到達（#20）', '',
    '突破優先は収穫3・割引1・限界突破の心得1の順で計10ptを支出します。心得は3pt・転生5回以上が条件です。早期方策も権利取得後は1e6へ進み、転生せず突破します。既存スキル買切り後の経路は計15ptを支出します。初期15方策とは別に、実際の取得・突破・保存・購入を測定します。', '',
    '| 方策 | 最初の1e6 | 権利取得まで | 突破時の転生回数 / 獲得pt | 突破時刻 | 突破後1e9まで | 全体 | 1e9停止待ち |', '| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |',
    ...suite.breakthroughJourneys.map((journey) => `| ${journey.scenario.label} | ${time(journey.firstScore1mSeconds)} | ${time(journey.permissionAtSeconds)} | ${journey.beforeBreakthrough?.permanent.prestigeCount ?? '未到達'}回 / ${journey.runs.reduce((sum, run) => sum + run.reward, 0)}pt | ${time(journey.breakthroughAtSeconds)} | ${journey.expansion?.completed ? time(journey.expansion.elapsedSeconds) : '未到達 / 打切り'} | ${time(journey.elapsedSeconds)} | ${time(journey.expansion?.idleAtCapSeconds)} |`), '',
    '通常転生は突破権を保持して周回上限を1e6へ戻します。各段階の突破は同一周回で一度だけで、次周回の再突破には追加ptを使いません。通常転生報酬は実到達SCORE帯により1〜6ptです。1e9で停止した後は手動の地層研究で1e12へ進めます。下記の既存比較は1e9までです。', '',
    '## 正規の上限1e9・設備購入比較', '',
    '1分確認・突破優先経路の実際の突破直前状態を共通の開始条件にします。取得済みの権利でコアのperformBreakthroughを実行し、購入なし・既存3種・解禁済み5種を比較します。仮の権利やポイントは付与しません。全オフライン方策で現行v10セーブの保存・復元・24h制限を通します。', '',
    '| 確認方策 | 購入 | 1e9までの追加時間 | 到達時生産 | 深層掘削機 | 芋精製プラント |', '| --- | --- | ---: | ---: | ---: | ---: |',
    ...suite.expansion.map((trial) => `| ${trial.scenario.label} | ${trial.policy === 'fixed' ? '購入なし' : trial.policy === 'existing' ? '既存3種のみ' : '追加2種を含む5種'} | ${trial.result.completed ? time(trial.result.elapsedSeconds) : '7日で打切り'} | ${number(trial.finalProduction)} /秒 | ${trial.result.state.equipmentCounts.deepDrill} | ${trial.result.state.equipmentCounts.refinery} |`), '',
    '上位設備の解禁条件は獲得SCOREではなく周回の上限段階です。固定生産の感度分析との差は、実際の設備購入・台数マイルストーンによるものです。', '',
    '## 自動購入ON/OFFと方針比較（#23）', '',
    '自動設備管理は収穫1・転生1回以上・1ptで解禁し、初期OFF。均等は最少所有数、収穫効率は価格÷マイルストーン込み増分の最小設備を目標に貯めます。同率は掲載順。指定優先は買える設備へ順番にフォールバックし、資金を保留しません。オンライン・放置とも同じ購入イベント駆動APIを使用し、上限で手動操作を待ちます。', '',
    '以下は同じ取得済み状態・同じ開始設備を使い、OFFでは確認時だけ手動購入、ONでは自動購入のみ。1e6と1e9の開始状態は別で、ON/OFFを段階内で比較します。自動処理中の購入時点もCSVに記録します。', '',
    '| 段階 | 確認間隔 | 方針 | 上限を確認 | 上限停止 | 自動購入台数 | 到達生産 |', '| --- | --- | --- | ---: | ---: | ---: | ---: |',
    ...suite.automation.trials.map((trial) => `| ${trial.stage === 0 ? '1e6' : '1e9'} | ${time(trial.scenario.visitSeconds)} | ${trial.policy === 'off' ? 'OFF・手動' : AUTOMATION_POLICIES[trial.policy as keyof typeof AUTOMATION_POLICIES]} | ${trial.result.completed ? time(trial.result.elapsedSeconds) : '打切り'} | ${time(trial.result.idleAtCapSeconds)} | ${trial.result.automaticPurchases} | ${number(getProductionPerSecond(trial.result.state))}/秒 |`), '',
    '## 自動購入の解禁コストを含む取得経路', '',
    'OFFは従来の10pt突破経路、ONは収穫1→自動設備管理→収穫3→割引1→突破の11pt経路です。自動スキルを取るまでは手動購入し、取得後にONへ設定します。転生・突破は確認したときだけ手動。旧経路を選べるため、必須の追加コストにはしません。', '',
    '| 確認間隔 | 方針 | 最初の1e6 | 突破権取得 | 突破時刻 / 転生回数 | 突破後1e9 | 総時間 |', '| --- | --- | ---: | ---: | --- | ---: | ---: |',
    ...suite.automation.journeys.map((journey) => `| ${time(journey.scenario.visitSeconds)} | ${journey.scenario.automation ? AUTOMATION_POLICIES[journey.scenario.automation] : 'OFF・手動'} | ${time(journey.firstScore1mSeconds)} | ${time(journey.permissionAtSeconds)} | ${time(journey.breakthroughAtSeconds)} / ${journey.beforeBreakthrough?.permanent.prestigeCount ?? '未到達'}回 | ${journey.expansion?.completed ? time(journey.expansion.elapsedSeconds) : '打切り'} | ${time(journey.elapsedSeconds)} |`), '',
    '## 地層研究と第2突破（#24）', '',
    '初期状態から正規の転生・スキル購入・初回突破・1e9到達を経由し、初回の深層解析で強化スキルを全リセット・7pt消失した後を比較します。強化スキルは同周回で再購入しません。機能解禁は保持します。手動経路は自動購入スキルを取得しません。ON/OFFの開始設備は取得経路が異なるため、研究あり/なしと研究配分を同一経路内で比較してください。', '',
    '研究強化は確認時にだけ手動購入し、指定した研究の買えるランクを優先してから他方を買います。その後、OFFは設備を手動購入、ONは実コアで自動購入します。6h/12hの途中に研究を捏造しません。設備のみは研究ランク0の対照。上限だけ拡張した固定生産試算もCSVに併記します。', '',
    '| 確認 | 購入 | 研究方策 | 突破後1e12まで | 上限停止待ち | 開始→到達の生産倍率 | 地層/共鳴 | 抽出機/濃縮炉 |', '| --- | --- | --- | ---: | ---: | ---: | --- | --- |',
    ...suite.research.map((trial) => `| ${time(trial.scenario.visitSeconds)} | ${trial.automated ? '自動' : '手動'} | ${trial.policy} | ${trial.result.completed ? time(trial.result.elapsedSeconds) : '打切り'} | ${time(trial.result.idleAtCapSeconds)} | ×${number(trial.productionMultiplier)} | ${trial.result.state.researchRanks.geology}/${trial.result.state.researchRanks.resonance} | ${trial.result.state.equipmentCounts.veinExtractor}/${trial.result.state.equipmentCounts.concentrator} |`), '',
    'これは方策別の到達観測時間で、プレイヤー全体の平均ではありません。研究で全収穫は最大8倍、研究段階の新設備はさらに最大8倍。上限到達時は生産・購入が停止し、第3突破も手動です。', '',
    '## 第3限界突破と設備連携（#29）', '',
    '深層記憶を反映した初期状態→転生→1e9→深層解析→1e12の正規経路の終点から、無料で根脈接続を実行します。研究は確認時のみ手動購入。比較対照は連携の物理法則を変更せず、連携設備2種を購入対象から外します。手動貯蓄方策は次の連携に必要な設備まで残高を保留し、既存設備を追加購入しません。', '',
    '| 確認 | 購入 | 方策 | 1e15までの追加時間 | 設備購入台数 | 連携数 | 生産増幅 | 上限停止待ち |', '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...suite.rootConnections.map((trial) => `| ${time(trial.scenario.visitSeconds)} | ${trial.automated ? '自動' : '手動'} | ${trial.policy === 'control' ? '既存設備のみ' : trial.policy === 'saving' ? '連携設備へ貯蓄' : '連携設備あり'} | ${trial.result.completed ? time(trial.result.elapsedSeconds) : '打切り'} | ${trial.result.purchases} | ${trial.links} | ×${number(trial.productionMultiplier)} | ${time(trial.result.idleAtCapSeconds)} |`), '',
    '段階3の目標は研究あり・1分自動で2〜6h、6h確認で6〜18h、12h確認で12〜36hです。連携追加生産には全体・地層倍率を適用し、地脈共鳴の対象は従来の2設備に限定します。1e15到達後は第4突破を選べます。', '',
    '## 恒久DEPTHと任意の掘削研究（#30）', '',
    '設備の掘削力を地層の硬さで割り、SCOREの稼働時間だけ深度を進めます。地層境界はイベントで切替。通常転生でも深度と購入済み掘削研究を保持し、芋生産の研究・設備優先方針は変えません。研究あり方策は確認時にだけ所持芋で任意強化を買います。以下は通常転生とROOT前の正規段階3の比較で、ROOT後の比較は後段に分けています。', '',
    '| 確認 | 掘削研究 | 初周の深度 | 6周後の深度 | 到達層 | 総時間 |', '| --- | --- | ---: | ---: | --- | ---: |',
    ...suite.depth.campaigns.map((trial) => `| ${time(trial.scenario.visitSeconds)} | ${trial.digResearch ? 'あり' : 'なし'} | ${number(trial.result.runs[0]?.result.state.permanent.depthMeters ?? 0)} m | ${number(trial.result.state.permanent.depthMeters)} m | ${STRATA[getStratum(trial.result.state.permanent.depthMeters)]!.name} | ${time(trial.result.elapsedSeconds)} |`), '',
    '| 確認 | 掘削研究 | 段階3開始深度 | 1e15時の深度 | 到達層 | 通常転生後の次回転生判断時 |', '| --- | --- | ---: | ---: | --- | ---: |',
    ...suite.depth.late.map((trial) => `| ${time(trial.scenario.visitSeconds)} | ${trial.digResearch ? 'あり' : 'なし'} | ${number(trial.initialState.permanent.depthMeters)} m | ${number(trial.result.state.permanent.depthMeters)} m | ${STRATA[getStratum(trial.result.state.permanent.depthMeters)]!.name} | ${number(trial.resumed.state.permanent.depthMeters)} m |`), '',
    '待機時間・深度・掘削速度と研究ランクの明細はdepth.csv、確認/購入/SCORE停止時の進行はdepth-timeline.csvに記録します。発見報酬は記録・任意研究・掘削連携補助の解禁だけで、芋や転生ptの受取操作はありません。', '',
    '## 第4突破・根源領域（初期状態からの実経路）', '',
    '| 確認 | 購入 | 方策 | 1E15→1E18 | 初期→1E18 | 最終DEPTH | 上限停止待ち |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: |',
    ...suite.origins.map((trial) => `| ${time(trial.scenario.visitSeconds)} | ${trial.automated ? '自動' : '手動'} | ${trial.policy === 'hold' ? '追加購入なし' : trial.policy === 'equipment' ? '新設備・新研究なし' : '新設備と新研究'} | ${trial.result.completed ? time(trial.result.elapsedSeconds) : '90日で打切り'} | ${trial.result.completed ? time(trial.totalSeconds) : '90日で打切り'} | ${number(trial.result.state.permanent.depthMeters)} m | ${time(trial.result.idleAtCapSeconds)} |`), '',
    '1分/6h/12h×自動ON/OFFの6経路を実際の初期状態から継続。対照は6hの追加購入なし・新研究なし4経路だけとし、研究順や全組合せは増やしません。研究・突破は確認時のみ手動です。各段階の停止待ちは既存campaign/breakthrough/research/rootとorigin CSVに記録します。1日2〜4回確認で追加数日、初期から1〜3週間は参考目標で、全方策や最適値の保証ではありません。詳細は [根源領域](../../origin.md)。', '',
    '## 解析済み通常転生・段階2からの再開', '',
    '| 確認 | 購入 | 再成長周回 | 実支給芋 | 取得ランク（収穫/割引/蓄え） | 累計獲得/解析消失pt | 上限1E12への再到達 |',
    '| --- | --- | ---: | ---: | --- | ---: | ---: |',
    ...suite.deepPrestige.flatMap((trial) => trial.cycles.map((cycle) => `| ${time(trial.scenario.visitSeconds)} | ${trial.automated ? '自動' : '手動'} | ${cycle.cycle} | ${number(cycle.afterPrestige.runStartingImo)} | ${cycle.initialState.permanent.skillRanks.harvest}/${cycle.initialState.permanent.skillRanks.discount}/${cycle.initialState.permanent.skillRanks.startingImo} | ${cycle.initialState.permanent.lifetimePrestigePointsEarned}/${cycle.initialState.permanent.pointsLostByDeepResearch} | ${cycle.result.completed ? time(cycle.result.elapsedSeconds) : '打切り'} |`)), '',
    '段階4の実状態から通常転生し、SCORE0・設備0・周回研究0・ロック解除・上限1E12で3周回します。最初は1E18の6pt、その後は1E12の4ptだけを加算し、収穫・蓄え・割引へ順に投資します。蓄えの増額は次のリセットから支給し、解析累計と消失ptを増やしません。既存の効率購入は高額設備を待つため、最適化された周回速度を保証する比較ではありません。 [比較CSV](deep-prestige.csv) / [台帳・校正](../../prestige-economy.md)', '',
    '## ROOT REBIRTH・初回と再到達', '',
    '| 確認 | 購入 | 最初の結晶 | 初期→初回ROOT | ROOT後→2回目 | 序盤1E6まで | 2回目までのDEPTH |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: |',
    ...suite.rootCycles.map((trial) => `| ${time(trial.scenario.visitSeconds)} | ${trial.automated ? '自動' : '手動'} | ${trial.choice === 'blessing' ? '原初の恵み' : '根源の記憶'} | ${time(trial.firstRootSeconds)} | ${trial.completed ? time(trial.elapsedSeconds) : '打切り'} | ${time(trial.stages[0]?.result.elapsedSeconds)} | ${number(trial.state.permanent.depthMeters)} m |`), '',
    '初回ROOTで全収穫×3、結晶1個を手動で使用。維持した未使用ポイントの範囲でスキルを買い、通常転生を挟まず段階0〜4を再突破します。解析で失ったポイントは返還しません。スキルを最大ランクまで自動補完しません。根源の記憶の初期芋は次のリセットから支給します。詳細は [ROOT](../../root-rebirth.md)。', '',
    '## 効果モード・4プリセット（ROOT1〜3）', '',
    '| 確認 | 購入 | プリセット | ROOT後の周回 | 全段階の時間 | 序盤1E6まで | 最終DEPTH | 解禁数 |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...suite.gearModes.flatMap((trial) => trial.cycles.map((cycle) => `| ${time(trial.scenario.visitSeconds)} | ${trial.automated ? '自動' : '手動'} | ${GEAR_PRESETS[trial.scenario.gearModePreset!].name} | ${cycle.cycle} | ${time(cycle.elapsedSeconds)} | ${time(cycle.stages[0]?.result.elapsedSeconds)} | ${number(cycle.state.permanent.depthMeters)} m | ${cycle.unlocked.length} |`)), '',
    '各確認時の解禁後にプリセットを手動適用する12経路。ROOT1〜3の36周回すべて完了し、有効装備は3→4→5点です。高速周回は序盤設備、長期成長は深層以降、根脈連携はリンク、DEPTH探索は掘削に重点を置きます。初回ROOTまでの経路は共通で、確認間隔による上限待ちも含めます。倍率・適用順・比較条件は [効果モード](../../gear-modes.md)。', '',
    '- [ROOT3・1分自動のSCORE比較](gear-modes.svg) / [周回・解禁順CSV](gear-modes.csv) / [切替・掘削の時系列](gear-modes-timeline.csv)', '',
    '## 恒久装備・ROOT1〜3周回', '',
    '| 確認 | 購入 | 解禁方策 | ROOT後の周回 | 所要時間 | 有効装備数 | 装備倍率 | 支出SCORE |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...suite.gear.flatMap((trial) => trial.cycles.map((cycle) => `| ${time(trial.scenario.visitSeconds)} | ${trial.automated ? '自動' : '手動'} | ${trial.policy === 'early' ? '確認時に随時' : '各上限で解禁'} | ${cycle.cycle} | ${time(cycle.elapsedSeconds)} | ${cycle.unlocked.length} | ×${number(cycle.multiplier)} | ${number(cycle.state.scoreSpentThisRun)} |`)), '',
    '正規の初回ROOTから3周回を継続。初回結晶は原初の恵みに使い、以降の結晶は温存して装備効果を比較します。ROOT1で3装備、ROOT2でコンパス、ROOT3で根源コアを追加。解禁は各確認時だけ手動で、放置中の解禁を捏造しません。累計SCOREと所持芋は不変、利用可能SCOREだけが減ります。各上限後でも解禁でき、生産/掘削停止を維持します。', '',
    '全5装備の常時倍率1.337056875と価格は据え置きます。#46の解析非返還によりROOT後のスキル再取得予算が変わるため、周回時間は上表の現行計算を使用します。随時解禁と各上限での解禁を同じ初回ROOTから比較します。詳細は [装備](../../gear.md)・[ポイント経済](../../prestige-economy.md)。', '',
    '## 検証範囲と未確定事項', '', '| 項目 | 区分 | 内容 |', '| --- | --- | --- |',
    ...suite.coverage.map((row) => `| ${row.feature} | ${row.status} | ${row.detail} |`), '',
    '## 図と機械可読データ', '',
    '- [初周の SCORE 曲線](first-run.svg)', '- [経過時間と転生回数](prestige.svg)', '- [桁拡張の固定生産試算](projection.svg)',
    '- [正規1e9の設備購入比較](expansion.svg) / [比較CSV](expansion.csv) / [購入時系列](expansion-timeline.csv)',
    '- [突破までの成長と上限](breakthrough.svg) / [経路CSV](breakthrough.csv) / [全経路時系列](breakthrough-timeline.csv)',
    '- [自動購入の成長比較](automation.svg) / [方針比較CSV](automation.csv) / [購入時系列](automation-timeline.csv) / [取得経路CSV](automation-journeys.csv)',
    '- [研究・新設備の成長比較](research.svg) / [比較CSV](research.csv) / [研究・購入時系列](research-timeline.csv)',
    '- [設備連携の比較](root-connection.svg) / [比較CSV](root-connection.csv) / [購入時系列](root-connection-timeline.csv)',
    '- [恒久DEPTHの比較](depth.svg) / [SCORE帯ごとの深度・待機CSV](depth.csv) / [進行時系列](depth-timeline.csv)',
    '- [第4突破の比較](origin.svg) / [初期状態から1E18までの時間・深度CSV](origin.csv) / [設備・研究・リンクの時系列](origin-timeline.csv)',
    '- [ROOT後の選択比較](root-cycle.svg) / [初回・2回目の経路CSV](root-cycle.csv) / [再突破の時系列](root-cycle-timeline.csv)',
    '- [恒久装備の解禁時期比較](gear.svg) / [ROOT1〜3周回CSV](gear.csv) / [支出・倍率・解禁時刻](gear-timeline.csv)',
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
    color: { domain, range }, marks: [amountLineY(points, { x: 'hours', y: 'prestigeCount', stroke: 'id', curve: 'step-after' })],
  }, legend, '初期15方策の SCORE 上限: 1e6（突破権を取得しない比較）');
  const firstPoints = selected.flatMap((campaign) => campaign.runs[0]?.result.trace.filter((point) => point.elapsedSeconds > 0 && point.score.gt(0))
    .map((point) => ({ ...point, id: campaign.scenario.id, minutes: point.elapsedSeconds / 60 })) ?? []);
  files['first-run.svg'] = chart('score', {
    ariaLabel: '初周のSCORE成長と固定上限。確認時点を結ぶ線で、復帰前の自動購入や転生はない。',
    x: { type: 'log', label: '初周の実経過時間 (minutes, log)', tickFormat: axisNumber, grid: true }, y: { type: 'log', label: 'SCORE (log)', domain: [1, suite.parameters.balance.scoreCap], grid: true },
    color: { domain, range }, marks: [amountRuleY([suite.parameters.balance.scoreCap], { stroke: '#888', strokeDasharray: '4,4' }), amountLineY(firstPoints, { x: 'minutes', y: 'score', stroke: 'id' })],
  }, legend, '初周の確認値と上限到達推計。破線: 現行上限 1e6');
  const projectionPoints = suite.projections.map((row) => ({ ...row, stage: `${row.from.format(1)} → ${row.to.format(1)}`, hours: row.seconds / 3_600, factor: `×${row.multiplier}` }));
  files['projection.svg'] = chart('projection', {
    ariaLabel: '仮定の固定生産量で桁拡張した所要時間。現行の到達結果ではない。',
    x: { label: '将来の仮定区間', domain: [...new Set(projectionPoints.map((point) => point.stage))] },
    y: { type: 'log', label: '所要時間 (hours, log)', tickFormat: axisNumber, ticks: 8, grid: true },
    color: { domain: ['×1', '×10', '×100', '×1000'], range: colors.slice(0, 4) },
    marks: [amountRuleY([6], { stroke: '#888', strokeDasharray: '4,4' }), Plot.dot(projectionPoints, { x: 'stage', y: 'hours', stroke: 'factor', r: 5 })],
  }, ['×1', '×10', '×100', '×1000'].map((label, index) => ({ label: `仮定倍率 ${label}`, color: colors[index]! })),
  suite.projectionReference ? '固定生産の仮定による試算。破線: 設計比較用の6時間目標' : '完了した参照周回がないため、所要時間は未試算');
  const expansionTrials = suite.expansion.filter((trial) => trial.scenario.presence === 'online' || trial.policy === 'expanded');
  const expansionDomain = expansionTrials.map((trial) => trial.scenario.id);
  const expansionPoints = expansionTrials.flatMap((trial) => trial.result.trace.filter((point) => point.elapsedSeconds > 0).map((point) => ({ ...point, id: trial.scenario.id, hours: point.elapsedSeconds / 3_600 })));
  files['expansion.svg'] = chart('expansion', {
    ariaLabel: '正規の初回突破後、設備購入方策による1e9到達の比較。',
    x: { type: 'log', label: '1e6からの追加時間 (hours, log)', tickFormat: axisNumber, grid: true },
    y: { type: 'log', label: 'SCORE (log)', domain: [1e6, SCORE_CAP_STAGES[1].cap], grid: true },
    color: { domain: expansionDomain, range: colors },
    marks: [amountLineY(expansionPoints, { x: 'hours', y: 'score', stroke: 'id' })],
  }, expansionTrials.map((trial, index) => ({ label: `${trial.scenario.label} / ${trial.policy}`, color: colors[index]! })),
  '正規の初回突破。購入なし / 既存3種 / 追加2種ありを比較');
  const journeySelected = suite.breakthroughJourneys.slice(0, 3);
  const journeyDomain = journeySelected.map((journey) => journey.scenario.id);
  const journeyPoints = journeySelected.flatMap((journey) => journey.trace.filter((point) => point.elapsedSeconds > 0).map((point) => ({ ...point, id: journey.scenario.id, series: `${journey.scenario.id}-${point.run}`, hours: point.elapsedSeconds / 3_600 })));
  files['breakthrough.svg'] = chart('breakthrough', {
    ariaLabel: '初期状態から通常転生・突破権取得・同一周回での1e9到達。破線は現周回の上限。',
    x: { type: 'log', label: '開始からの実経過時間 (hours, log)', tickFormat: axisNumber, grid: true },
    y: { type: 'log', label: 'SCORE / 上限 (log)', domain: [1, 1e9], grid: true },
    color: { domain: journeyDomain, range: colors.slice(0, 3) },
    marks: [amountLineY(journeyPoints.filter((point) => point.score.gt(0)), { x: 'hours', y: 'score', stroke: 'id', z: 'series' }),
      amountLineY(journeyPoints, { x: 'hours', y: 'scoreCap', stroke: 'id', strokeDasharray: '4,4', curve: 'step-after' })],
  }, journeySelected.map((journey, index) => ({ label: journey.scenario.label, color: colors[index]! })), '実コアで取得・突破・保存。破線: 現周回の上限');
  const automaticTrials = suite.automation.trials.filter((trial) => trial.stage === 1 && trial.scenario.visitSeconds === 21_600);
  const autoDomain = automaticTrials.map((trial) => trial.scenario.id);
  const autoPoints = automaticTrials.flatMap((trial) => trial.result.trace.filter((point) => point.elapsedSeconds > 0).map((point) => ({ ...point, id: trial.scenario.id, hours: point.elapsedSeconds / 3_600 })));
  files['automation.svg'] = chart('automation', {
    ariaLabel: '同じ突破後状態から、6時間復帰での自動購入OFFと3方針を比較。自動転生・突破はしない。',
    x: { type: 'log', label: '突破後の経過時間 (hours, log)', tickFormat: axisNumber, grid: true },
    y: { type: 'log', label: 'SCORE (log)', domain: [1e6, 1e9], grid: true },
    color: { domain: autoDomain, range: colors.slice(0, 4) },
    marks: [amountLineY(autoPoints, { x: 'hours', y: 'score', stroke: 'id' })],
  }, automaticTrials.map((trial, index) => ({ label: trial.policy === 'off' ? 'OFF / 復帰時だけ手動購入' : AUTOMATION_POLICIES[trial.policy as keyof typeof AUTOMATION_POLICIES], color: colors[index]! })), '上限1e9・6時間復帰。ONは購入イベント時刻も記録、上限後は停止');
  const researchTrials = suite.research.filter((trial) => trial.scenario.visitSeconds === 60 && trial.policy !== 'resonance-first');
  const researchPoints = researchTrials.flatMap((trial) => trial.result.trace.map((point) => ({ ...point, id: trial.scenario.id, minutes: point.elapsedSeconds / 60 })));
  files['research.svg'] = chart('research', {
    ariaLabel: '正規の第2突破後、1分確認での研究あり・なしと手動・自動購入のSCORE成長比較。',
    x: { label: '1E9からの追加時間 (minutes)', grid: true },
    y: { type: 'log', label: 'SCORE (log)', domain: [1e9, 1e12], grid: true },
    color: { domain: researchTrials.map((trial) => trial.scenario.id), range: colors.slice(0, 4) },
    marks: [amountLineY(researchPoints, { x: 'minutes', y: 'score', stroke: 'id' })],
  }, researchTrials.map((trial, index) => ({ label: `${trial.automated ? '自動' : '手動'} / ${trial.policy === 'equipment-only' ? '新設備のみ' : '新設備と研究'}`, color: colors[index]! })),
  '1分確認・正規の深層解析後。研究は確認時のみ手動購入、ON/OFFで取得経路は異なる');
  const rootTrials = suite.rootConnections.filter((trial) => trial.scenario.visitSeconds === 60);
  const rootPoints = rootTrials.flatMap((trial) => trial.result.trace.map((point) => ({ ...point, id: trial.scenario.id, hours: point.elapsedSeconds / 3600 })));
  files['root-connection.svg'] = chart('root', {
    ariaLabel: '深層記憶を反映した正規の第3突破後、1分確認の設備連携あり・なしと貯蓄方策の比較。',
    x: { label: '1E12からの追加時間 (hours)', grid: true },
    y: { type: 'log', label: 'SCORE (log)', domain: [1e12, 1e15], grid: true },
    color: { domain: rootTrials.map((trial) => trial.scenario.id), range: colors },
    marks: [amountLineY(rootPoints, { x: 'hours', y: 'score', stroke: 'id' })],
  }, rootTrials.map((trial, index) => ({ label: `${trial.automated ? '自動' : '手動'} / ${trial.policy === 'control' ? '既存設備のみ' : trial.policy === 'saving' ? '連携設備へ貯蓄' : '連携設備あり'}`, color: colors[index]! })),
  '1分確認。対照は新設備を除外。深層記憶後の正規経路から開始');
  const depthTrials = suite.depth.campaigns;
  const depthColors = [...colors, '#336b68'];
  const depthPoints = depthTrials.flatMap((trial) => trial.result.trace.filter((point) => point.elapsedSeconds > 0 && point.depthMeters > 0).map((point) => ({ ...point, id: trial.scenario.id, hours: point.elapsedSeconds / 3600 })));
  files['depth.svg'] = chart('depth', {
    ariaLabel: '1分・6h・12h確認、6周回の恒久深度と任意掘削研究あり・なしの比較。',
    x: { type: 'log', label: '開始からの実経過時間 (hours, log)', tickFormat: axisNumber, grid: true },
    y: { type: 'log', label: 'DEPTH (m, log)', tickFormat: axisNumber, grid: true },
    color: { domain: depthTrials.map((trial) => trial.scenario.id), range: depthColors },
    marks: [Plot.lineY(depthPoints, { x: 'hours', y: 'depthMeters', stroke: 'id' })],
  }, depthTrials.map((trial, index) => ({ label: `${time(trial.scenario.visitSeconds)} / 研究${trial.digResearch ? 'あり' : 'なし'}`, color: depthColors[index]! })), 'SCORE上限の待機中はDEPTHも停止。深度は通常転生で維持');
  const originTrials = suite.origins.filter((trial) => trial.scenario.visitSeconds === 21600);
  const originPoints = originTrials.flatMap((trial) => trial.result.trace.map((point) => ({ ...point, id: trial.scenario.id, days: point.elapsedSeconds / 86400 })));
  files['origin.svg'] = chart('origin', {
    ariaLabel: '第4突破後、6時間確認で追加購入なし・新設備・新研究を比較。',
    x: { label: '1E15からの追加日数（最初の8日）', domain: [0, 8], grid: true },
    y: { type: 'log', label: 'SCORE (log)', domain: [1e15, 1e18], grid: true },
    color: { domain: originTrials.map((trial) => trial.scenario.id), range: [...colors, '#336b68'] },
    marks: [amountLineY(originPoints, { x: 'days', y: 'score', stroke: 'id', clip: true })],
  }, originTrials.map((trial, index) => ({ label: `${trial.automated ? '自動' : '手動'} / ${trial.policy === 'hold' ? '追加購入なし' : trial.policy === 'equipment' ? '設備のみ' : '設備と研究'}`, color: [...colors, '#336b68'][index]! })), '通常の初期状態から継続。研究は確認時のみ手動購入。打切り90日');
  const cycleTrials = suite.rootCycles.filter((trial) => trial.automated && trial.scenario.visitSeconds === 60);
  const cyclePoints = cycleTrials.flatMap((trial) => trial.trace.filter((point) => point.score.gt(0)).map((point) => ({ ...point, id: trial.scenario.id, hours: point.elapsedSeconds / 3600 })));
  files['root-cycle.svg'] = chart('root-cycle', {
    ariaLabel: '初回ROOT後、1分自動購入で全収穫と設備割引の結晶選択を比較。',
    x: { label: '初回ROOT後の経過時間 (hours)', grid: true },
    y: { label: 'SCORE (log)', domain: [1, 1e18], grid: true },
    color: { domain: cycleTrials.map((trial) => trial.scenario.id), range: colors.slice(0, 2) },
    marks: [amountLineY(cyclePoints, { x: 'hours', y: 'score', stroke: 'id' })],
  }, cycleTrials.map((trial, index) => ({ label: trial.choice === 'blessing' ? '原初の恵み / 全収穫' : '根源の記憶 / 設備割引', color: colors[index]! })), '実際の初回ROOT→通常転生なし→段階0〜4の再突破→2回目ROOT');
  const gearTrials = suite.gear.filter((trial) => trial.scenario.visitSeconds === 60);
  const gearPoints = gearTrials.flatMap((trial) => trial.trace.filter((point) => point.run === 3 && point.score.gt(0)).map((point) => ({ ...point,
    id: trial.scenario.id, hours: (point.elapsedSeconds - trial.cycles[2]!.startsAtSeconds) / 3600 })));
  files['gear.svg'] = chart('gear', {
    ariaLabel: 'ROOT3回後、1分自動で装備の随時解禁と上限での解禁を比較。',
    x: { label: 'ROOT3回後の経過時間 (hours)', grid: true },
    y: { label: '累計SCORE (log)', domain: [1e6, 1e18], grid: true },
    color: { domain: gearTrials.map((trial) => trial.scenario.id), range: colors.slice(0, 2) },
    marks: [amountLineY(gearPoints, { x: 'hours', y: 'score', stroke: 'id', clip: true })],
  }, gearTrials.map((trial, index) => ({ label: trial.policy === 'early' ? '確認時に随時解禁' : '各上限で解禁', color: colors[index]! })), '同じ初回ROOTから継続。累計SCOREを消費せず、全解禁装備の効果を保持');
  const modeTrials = suite.gearModes.filter((trial) => trial.scenario.visitSeconds === 60);
  const modePoints = modeTrials.flatMap((trial) => trial.trace.filter((point) => point.run === 3 && point.score.gt(0)).map((point) => ({ ...point,
    id: trial.scenario.id, hours: (point.elapsedSeconds - trial.cycles[2]!.startsAtSeconds) / 3600 })));
  files['gear-modes.svg'] = chart('gear-modes', {
    ariaLabel: 'ROOT3回後、1分自動で4プリセットのSCORE到達を比較。',
    x: { label: 'ROOT3回後の経過時間 (hours)', grid: true },
    y: { label: '累計SCORE (log)', domain: [1e5, 1e18], grid: true },
    color: { domain: modeTrials.map((trial) => trial.scenario.id), range: colors.slice(0, 4) },
    marks: [amountLineY(modePoints, { x: 'hours', y: 'score', stroke: 'id', clip: true })],
  }, modeTrials.map((trial, index) => ({ label: GEAR_PRESETS[trial.scenario.gearModePreset!].name, color: colors[index]! })), '全装備の常時効果を保持。解禁後の手動切替を含む');
  return files;
}
