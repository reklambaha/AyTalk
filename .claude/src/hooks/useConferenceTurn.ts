import {useCallback, useState} from "react";

type CompleteTurnOptions = {
  enabled: boolean;
  speak: () => Promise<void>;
  swapTurn: () => void;
  startNextListening: () => Promise<void>;
};

const wait = (milliseconds: number) =>
  new Promise<void>(resolve => setTimeout(resolve, milliseconds));

export function useConferenceTurn() {
  const [autoTurnEnabled, setAutoTurnEnabled] = useState(true);
  const [autoListenEnabled, setAutoListenEnabled] = useState(true);

  const completeTurn = useCallback(
    async ({
      enabled,
      speak,
      swapTurn,
      startNextListening,
    }: CompleteTurnOptions) => {
      await speak();

      if (!enabled || !autoTurnEnabled) return;

      swapTurn();

      if (!autoListenEnabled) return;

      // React state güncellemelerinin ekrana ve dil seçimine yansıması için
      // kısa bir bekleme bırakılır, sonra yeni konuşmacının mikrofonu açılır.
      await wait(450);
      await startNextListening();
    },
    [autoListenEnabled, autoTurnEnabled],
  );

  return {
    autoTurnEnabled,
    setAutoTurnEnabled,
    autoListenEnabled,
    setAutoListenEnabled,
    completeTurn,
  };
}
