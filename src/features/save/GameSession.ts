import { advanceGame, purchaseEquipment } from '../../core/game';
import type { PurchaseMode } from '../../core/game';
import { createSave, parseSave, SaveDataError, serializeSave, settleOffline } from '../../core/save';
import type { OfflineReport, SaveData } from '../../core/save';
import { createInitialState } from '../../core/state';
import type { GameState } from '../../core/state';
import { INITIAL_BALANCE } from '../../data/balance';
import type { EquipmentId } from '../../data/equipment';
import { SaveConflictError, SaveRepository } from './SaveRepository';
import type { SaveStorage } from './SaveRepository';

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
  private snapshot: SessionSnapshot = {
    gameState: createInitialState(), status: 'loading', message: null, report: null, savedAt: null,
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
    if (error instanceof SaveConflictError) {
      this.update({ status: 'conflict', message: '別のタブでセーブが変更されたため、進行と保存を停止しました。他のタブを閉じて再読み込みしてください。' });
    } else if (error instanceof SaveDataError) {
      this.update({ status: 'invalid', message: `${error.message} 元データを保持し、進行と自動保存を停止しています。セーブ管理から元データの退避・インポート・初期化ができます。` });
    } else {
      this.update({ status: 'unavailable', message: '保存領域の読み書きに失敗したため、進行と保存を停止しました。エクスポートで進行を退避し、ブラウザの設定や空き容量を確認して再読み込みしてください。' });
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
      const result = raw === null ? null : settleOffline(parseSave(raw), this.stateAt);
      const save = result?.save ?? createSave(createInitialState(), this.stateAt);
      this.stateAt = save.savedAt;
      this.update({ gameState: save.gameState, report: result?.report ?? null });
      this.repository.write(save);
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
    this.lastTick = now;
    this.stateAt = Math.max(this.stateAt, this.clock.wallNow());
    const gameState = advanceGame(this.snapshot.gameState, elapsed);
    if (gameState !== this.snapshot.gameState) this.update({ gameState });
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
    if (this.snapshot.status !== 'ready' || this.hidden || this.snapshot.gameState.runEarnedScore >= INITIAL_BALANCE.scoreCap) return;
    this.update({ gameState: purchaseEquipment(this.snapshot.gameState, id, mode) });
    this.persist();
  };

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
      this.update({ gameState: save.gameState, report });
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
      this.update({ gameState: save.gameState, status: 'ready', savedAt: save.savedAt, message: null, report: null });
      return true;
    } catch (error) { this.fail(error); return false; }
  }

  importSave = (save: SaveData): boolean => this.replace(parseSave(serializeSave(save)).gameState);
  reset = (): boolean => this.replace(createInitialState());
  dismissReport = (): void => { this.update({ report: null }); };
}
