import { advanceWithAutomation, AutomationLimitError, NumericProgressError, configureAutomation, getEquipmentMilestones, purchaseEquipment } from '../../core/game';
import type { PurchaseMode } from '../../core/game';
import { createSave, parseSave, SaveDataError, serializeSave, settleOffline, SAVE_VERSION } from '../../core/save';
import type { OfflineReport, SaveData } from '../../core/save';
import { createInitialState } from '../../core/state';
import type { GameState } from '../../core/state';
import type { EquipmentId } from '../../data/equipment';
import { SaveConflictError, SaveRepository } from './SaveRepository';
import type { SaveStorage } from './SaveRepository';
import { getPrestigeReward, prestigeGame, purchaseSkill } from '../../core/prestige';
import { SKILLS } from '../../data/skills';
import type { SkillId } from '../../data/skills';
import { getScoreCap } from '../../data/scoreCaps';
import { performBreakthrough } from '../../core/breakthrough';
import type { AutomationSettings } from '../../data/automation';
import { performDeepResearch, purchaseResearch, resetResearch } from '../../core/research';
import type { DeepMemoryChoice } from '../../core/research';
import { RESEARCH } from '../../data/research';
import type { ResearchId } from '../../data/research';

export interface SessionClock {
  wallNow(): number;
  monotonicNow(): number;
}

export interface SessionSnapshot {
  readonly gameState: GameState;
  readonly status: 'loading' | 'ready' | 'invalid' | 'unavailable' | 'conflict';
  readonly message: string | null;
  readonly report: OfflineReport | null;
  readonly savedAt: number | null;
  readonly progressNotice: string | null;
  readonly milestoneNotice: { readonly id: EquipmentId; readonly counts: readonly number[]; readonly multiplier: number } | null;
  readonly automaticPurchases: number;
}

const AUTOSAVE_INTERVAL_MS = 10_000;

/** 保存・時計・復帰のライフサイクルを担当。React とブラウザイベントには依存しない。 */
export class GameSession {
  private readonly repository: SaveRepository;
  private readonly listeners = new Set<() => void>();
  private initialized = false;
  private hidden = false;
  private lastTick = 0;
  private lastAutosave = 0;
  private stateAt = 0;
  private migrationSource: string | null = null;
  private snapshot: SessionSnapshot = {
    gameState: createInitialState(), status: 'loading', message: null, report: null, savedAt: null, progressNotice: null, milestoneNotice: null, automaticPurchases: 0,
  };

  constructor(storage: SaveStorage, private readonly clock: SessionClock) {
    this.repository = new SaveRepository(storage);
  }

  getSnapshot = (): SessionSnapshot => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private update(patch: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private fail(error: unknown): void {
    if (error instanceof NumericProgressError) {
      this.update({ status: 'unavailable', message: '数値の精度または処理量の安全条件を満たさないため進行を停止しました。現在のセーブをエクスポートして保管してください。' });
    } else if (error instanceof AutomationLimitError) {
      this.update({ status: 'unavailable', message: '自動購入の処理上限に達したため進行を停止しました。現在のセーブをエクスポートして保管してください。' });
    } else if (error instanceof SaveConflictError) {
      this.update({ status: 'conflict', message: '別のタブでセーブが変更されたため、進行と保存を停止しました。他のタブを閉じて再読み込みしてください。' });
    } else if (error instanceof SaveDataError) {
      this.update({ status: 'invalid', message: `${error.message} 元データを保持し、進行と自動保存を停止しています。セーブ管理から元データの退避・インポート・初期化ができます。` });
    } else {
      this.update({ status: 'unavailable', message: this.migrationSource !== null
        ? '保存領域に旧セーブの移行結果を書き込めないため、進行を停止しました。エクスポートでは移行前の元テキストを退避できます。ブラウザの設定や空き容量を確認して再読み込みしてください。'
        : '保存領域の読み書きに失敗したため、進行と保存を停止しました。エクスポートで進行を退避し、ブラウザの設定や空き容量を確認して再読み込みしてください。' });
    }
  }

  start(): void {
    // StrictMode の effect 再実行で読込・報酬・保存を繰り返さない。
    if (this.initialized) return;
    this.initialized = true;
    this.lastTick = this.lastAutosave = this.clock.monotonicNow();
    this.stateAt = this.clock.wallNow();
    try {
      const raw = this.repository.read();
      const parsed = raw === null ? null : parseSave(raw);
      if (raw !== null && parsed !== null && JSON.parse(raw).saveVersion < SAVE_VERSION) this.migrationSource = raw;
      const observedAt = this.stateAt;
      if (parsed !== null) {
        this.stateAt = parsed.savedAt;
        this.update({ gameState: parsed.gameState });
      }
      const result = parsed === null ? null : settleOffline(parsed, observedAt);
      const save = result?.save ?? createSave(createInitialState(), this.stateAt);
      this.stateAt = save.savedAt;
      this.update({ gameState: save.gameState, report: result?.report ?? null, automaticPurchases: result?.report.automaticPurchases ?? 0 });
      this.repository.write(save);
      this.migrationSource = null;
      this.update({ status: 'ready', savedAt: save.savedAt });
    } catch (error) { this.fail(error); }
  }

  private checkCurrent(): boolean {
    try {
      this.repository.assertCurrent();
      return true;
    } catch (error) { this.fail(error); return false; }
  }

  tick(): void {
    if (this.snapshot.status !== 'ready' || this.hidden || !this.checkCurrent()) return;
    const now = this.clock.monotonicNow();
    const elapsed = Math.max(0, (now - this.lastTick) / 1_000);
    try {
      const progress = advanceWithAutomation(this.snapshot.gameState, elapsed);
      this.lastTick = now;
      this.stateAt = Math.max(this.stateAt, this.clock.wallNow());
      if (progress.state !== this.snapshot.gameState) this.update({ gameState: progress.state,
        ...(progress.purchaseCount > 0 ? { automaticPurchases: progress.purchaseCount } : {}) });
    } catch (error) { this.fail(error); return; }
    if (now - this.lastAutosave >= AUTOSAVE_INTERVAL_MS) this.persist();
  }

  private persist(): boolean {
    try {
      const save = createSave(this.snapshot.gameState, this.stateAt);
      this.repository.write(save);
      this.lastAutosave = this.clock.monotonicNow();
      this.update({ savedAt: save.savedAt });
      return true;
    } catch (error) { this.fail(error); return false; }
  }

  purchase = (id: EquipmentId, mode: PurchaseMode): void => {
    this.tick();
    if (this.snapshot.status !== 'ready' || this.hidden || this.snapshot.gameState.runEarnedScore.gte(getScoreCap(this.snapshot.gameState))) return;
    try {
      const before = this.snapshot.gameState.equipmentCounts[id];
      const gameState = purchaseEquipment(this.snapshot.gameState, id, mode);
      const milestones = getEquipmentMilestones(id, gameState.equipmentCounts[id]);
      const counts = milestones.achieved.filter((milestone) => milestone.count > before).map((milestone) => milestone.count);
      this.update({ gameState, milestoneNotice: counts.length > 0 ? { id, counts, multiplier: milestones.multiplier } : null });
      this.persist();
    } catch (error) { this.fail(error); }
  };

  private commitProgress(gameState: GameState, progressNotice: string): boolean {
    try {
      const save = createSave(gameState, this.stateAt);
      this.repository.write(save);
      this.lastAutosave = this.clock.monotonicNow();
      this.update({ gameState: save.gameState, savedAt: save.savedAt, progressNotice, report: null, milestoneNotice: null });
      return true;
    } catch (error) { this.fail(error); return false; }
  }

  prestige = (expectedReward: number): boolean => {
    this.tick();
    if (this.hidden || this.snapshot.status !== 'ready') return false;
    const reward = getPrestigeReward(this.snapshot.gameState);
    // 確認直前に1pt→2ptへ変化した場合は最新の予告で再確認してもらう。
    if (reward === 0 || reward !== expectedReward) return false;
    try {
      const gameState = prestigeGame(this.snapshot.gameState);
      return this.commitProgress(gameState, `転生しました。${reward}pt を獲得しました（累計 ${gameState.permanent.prestigeCount}回）。`);
    } catch (error) { this.fail(error); return false; }
  };

  buySkill = (id: SkillId): boolean => {
    this.tick();
    if (this.hidden || this.snapshot.status !== 'ready') return false;
    const gameState = purchaseSkill(this.snapshot.gameState, id);
    return gameState !== this.snapshot.gameState
      && this.commitProgress(gameState, `${SKILLS[id].name}をランク${gameState.permanent.skillRanks[id]}に強化しました。`);
  };

  breakthrough = (): boolean => {
    this.tick();
    if (this.hidden || this.snapshot.status !== 'ready') return false;
    const gameState = performBreakthrough(this.snapshot.gameState);
    return gameState !== this.snapshot.gameState
      && this.commitProgress(gameState, '限界突破しました。SCORE上限が1E9になり、同じ周回で採掘を再開します。');
  };

  setAutomation = (settings: AutomationSettings): boolean => {
    this.tick();
    if (this.hidden || this.snapshot.status !== 'ready') return false;
    try {
      const configured = configureAutomation(this.snapshot.gameState, settings);
      if (configured === this.snapshot.gameState) return false;
      const progress = advanceWithAutomation(configured, 0);
      const succeeded = this.commitProgress(progress.state, `自動購入設定を保存しました（${settings.enabled ? 'ON' : 'OFF'}）。`);
      if (succeeded && progress.purchaseCount > 0) this.update({ automaticPurchases: progress.purchaseCount });
      return succeeded;
    } catch (error) { this.fail(error); return false; }
  };

  deepResearch = (choice: DeepMemoryChoice = 'discount'): boolean => this.researchAction((state) => performDeepResearch(state, choice), '深層解析を実行し、深層記憶の保持・ポイント返還を適用しました。SCORE上限は1E12です。');
  buyResearch = (id: ResearchId): boolean => this.researchAction((state) => purchaseResearch(state, id), `${RESEARCH[id].name}を強化しました。`);
  resetResearch = (): boolean => this.researchAction(resetResearch, '研究強化を振り直しました。使用した芋を全額返却しました。');

  private researchAction(action: (state: GameState) => GameState, notice: string): boolean {
    this.tick();
    if (this.hidden || this.snapshot.status !== 'ready') return false;
    try {
      const gameState = action(this.snapshot.gameState);
      return gameState !== this.snapshot.gameState && this.commitProgress(gameState, notice);
    } catch (error) { this.fail(error); return false; }
  }

  hide(): void {
    if (this.hidden) return;
    this.tick();
    if (this.snapshot.status === 'ready') this.persist();
    this.hidden = true;
  }

  show(): void {
    if (!this.hidden) return;
    this.hidden = false;
    if (this.snapshot.status !== 'ready' || !this.checkCurrent()) return;
    try {
      const { save, report } = settleOffline(createSave(this.snapshot.gameState, this.stateAt), this.clock.wallNow());
      this.stateAt = save.savedAt;
      this.lastTick = this.clock.monotonicNow();
      this.update({ gameState: save.gameState, report, ...(report.automaticPurchases > 0 ? { automaticPurchases: report.automaticPurchases } : {}) });
      this.persist();
    } catch (error) { this.fail(error); }
  }

  storageChanged(raw: string | null): void {
    if (raw !== this.repository.raw) this.fail(new SaveConflictError());
  }

  exportText = (): string => {
    this.tick();
    // 破損・未対応の元テキストも、手で退避できるようそのまま取り出せる。
    if (this.snapshot.status === 'invalid') return this.repository.raw ?? '';
    if (this.migrationSource !== null) return this.migrationSource;
    return serializeSave(createSave(this.snapshot.gameState, this.stateAt));
  };

  private replace(gameState: GameState): boolean {
    if (this.snapshot.status === 'conflict' || this.snapshot.status === 'unavailable') return false;
    try {
      // 書込みに成功してからメモリ状態を差し替える。失敗時は今の進行を保持する。
      const save = createSave(gameState, this.clock.wallNow());
      this.repository.write(save);
      this.stateAt = save.savedAt;
      this.lastTick = this.lastAutosave = this.clock.monotonicNow();
      this.update({ gameState: save.gameState, status: 'ready', savedAt: save.savedAt, message: null, report: null, progressNotice: null, milestoneNotice: null, automaticPurchases: 0 });
      return true;
    } catch (error) { this.fail(error); return false; }
  }

  importSave = (save: SaveData): boolean => this.replace(parseSave(serializeSave(save)).gameState);
  reset = (): boolean => this.replace(createInitialState());
  dismissReport = (): void => { this.update({ report: null }); };
}
