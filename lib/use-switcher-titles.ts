import { useEffect } from "react";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { TerminalTitleObserver } from "./terminal-title";
import { base64ToBytes, normalizeTerminalTitle } from "./terminal-io";

/** Refresh names for the visible list without mounting hidden Ghostty renderers.
 * Only the open switcher polls; at most four reads run concurrently.
 */
export function useSwitcherTitles(
  rpc: PluginRpcClient<typeof rpcContract>,
  terminalIds: string[],
  enabled: boolean,
  onTitle: (terminalId: string, title: string | null) => void,
): void {
  const idsKey = JSON.stringify(terminalIds);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const entries = (JSON.parse(idsKey) as string[]).map((terminalId) => ({
      terminalId,
      seq: 0,
      replay: true,
      observer: new TerminalTitleObserver((title) => {
        if (!cancelled) onTitle(terminalId, normalizeTerminalTitle(title));
      }),
    }));
    const refresh = async () => {
      let next = 0;
      const worker = async () => {
        while (!cancelled && next < entries.length) {
          const entry = entries[next++]!;
          try {
            const output = await rpc.call("read", {
              terminalId: entry.terminalId,
              sinceSeq: entry.seq,
              ...(entry.replay ? { replay: true } : {}),
            });
            if (cancelled) return;
            for (const chunk of output.chunks) {
              entry.observer.consume(base64ToBytes(chunk.dataBase64));
            }
            entry.seq = output.nextSeq;
            entry.replay = false;
          } catch {
            // Keep the last title on disconnect; the next refresh retries.
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(4, entries.length) }, worker),
      );
      if (!cancelled && entries.length)
        timer = setTimeout(() => void refresh(), 2000);
    };
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rpc, idsKey, enabled, onTitle]);
}
