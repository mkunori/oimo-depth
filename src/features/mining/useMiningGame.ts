import { useEffect, useState, useSyncExternalStore } from 'react';
import { GameSession } from '../save/GameSession';
import { SAVE_STORAGE_KEY } from '../save/SaveRepository';

const UPDATE_INTERVAL_MS = 250;

export function useMiningGame() {
  const [session] = useState(() => new GameSession({
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
  }, { wallNow: () => Date.now(), monotonicNow: () => performance.now() }));
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);

  useEffect(() => {
    session.start();
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') session.hide();
      else session.show();
    };
    const pageHidden = () => session.hide();
    const pageShown = () => { if (document.visibilityState !== 'hidden') session.show(); };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === SAVE_STORAGE_KEY || event.key === null) session.storageChanged(event.newValue);
    };
    visibilityChanged();
    const timer = window.setInterval(() => session.tick(), UPDATE_INTERVAL_MS);
    document.addEventListener('visibilitychange', visibilityChanged);
    window.addEventListener('pagehide', pageHidden);
    window.addEventListener('pageshow', pageShown);
    window.addEventListener('storage', storageChanged);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visibilityChanged);
      window.removeEventListener('pagehide', pageHidden);
      window.removeEventListener('pageshow', pageShown);
      window.removeEventListener('storage', storageChanged);
    };
  }, [session]);

  return {
    state: snapshot.gameState,
    snapshot,
    purchase: session.purchase,
    exportText: session.exportText,
    importSave: session.importSave,
    reset: session.reset,
    dismissReport: session.dismissReport,
    prestige: session.prestige,
    buySkill: session.buySkill,
  };
}
