import { serializeSave } from '../../core/save';
import type { SaveData } from '../../core/save';

export const SAVE_STORAGE_KEY = 'oimo-depth.save';

export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class SaveConflictError extends Error {}

/** 読み込んだ値から変化していたら上書きせず、呼び出し元へ競合を知らせる。 */
export class SaveRepository {
  private loaded = false;
  private expected: string | null = null;

  constructor(private readonly storage: SaveStorage) {}

  get raw(): string | null { return this.expected; }

  read(): string | null {
    const raw = this.storage.getItem(SAVE_STORAGE_KEY);
    this.expected = raw;
    this.loaded = true;
    return raw;
  }

  assertCurrent(): void {
    if (!this.loaded || this.storage.getItem(SAVE_STORAGE_KEY) !== this.expected) {
      throw new SaveConflictError('別のタブでセーブが変更されました。');
    }
  }

  write(save: SaveData): void {
    const text = serializeSave(save);
    this.assertCurrent();
    this.storage.setItem(SAVE_STORAGE_KEY, text);
    this.expected = text;
  }
}
