"use client";

import * as React from "react";

/**
 * Preferência de interface guardada no navegador (ex.: colunas visíveis).
 *
 * Usa `useSyncExternalStore` em vez de ler o localStorage dentro de um efeito:
 * evita `setState` em efeito, não quebra a hidratação (o snapshot do servidor é
 * sempre nulo) e ainda reage a alterações feitas em outra aba.
 */
export function usePersistedState<T>(
  key: string,
  fallback: T,
): [T, (value: T) => void] {
  const [override, setOverride] = React.useState<T | null>(null);

  const stored = React.useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null,
  );

  const parsed = React.useMemo(() => parse<T>(stored), [stored]);
  const value = override ?? parsed ?? fallback;

  const setValue = React.useCallback(
    (next: T) => {
      setOverride(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Sem localStorage (modo privado, cota cheia): a preferência apenas
        // não persiste entre sessões.
      }
    },
    [key],
  );

  return [value, setValue];
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
