// One tab's terminal: a ref'd div that a TerminalPump owns.
//
// Every open tab stays mounted so its Ghostty buffer and scroll position survive
// tab switches; inactive tabs are display:none and their pumps stop polling,
// so a hidden tab costs nothing.
import { useEffect, useRef } from "react";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import { TerminalPump } from "@/lib/pump";
import type { TabStatus } from "@/lib/tabs";
import type { rpcContract } from "../server";
import { cn } from "@/lib/utils";

export interface TerminalViewProps {
  rpc: PluginRpcClient<typeof rpcContract>;
  terminalId: string;
  /** Window open AND this tab selected: drives polling, sizing, and focus. */
  visible: boolean;
  fontSize: number;
  /** Bumped when the host theme changes; pumps re-derive their palette. */
  themeVersion: number;
  /** Bumped on window drag/resize commits; the visible pump refits. */
  fitVersion: number;
  onStatus: (terminalId: string, status: TabStatus, detail: string | null) => void;
  /** A normalised OSC title from the shell, or null when it has none. */
  onTitle: (terminalId: string, title: string | null) => void;
  /** The on-screen bar's Ctrl latch changed inside this tab's terminal. */
  onCtrlArmed: (armed: boolean) => void;
  /** Cmd/Ctrl+F landed inside this terminal. */
  onFindRequested: () => void;
  /** This tab's viewport reached, or left, the newest output. */
  onScrollState: (terminalId: string, atBottom: boolean) => void;
  /** Live match counts for a search in this tab; null once cleared. */
  onSearchResults: (
    terminalId: string,
    results: { index: number; count: number } | null,
  ) => void;
  onRequestRestart: (terminalId: string) => void;
  onToggleRequested: () => void;
  onPumpReady: (terminalId: string, pump: TerminalPump) => void;
  onPumpGone: (terminalId: string) => void;
}

export function TerminalView({
  rpc,
  terminalId,
  visible,
  fontSize,
  themeVersion,
  fitVersion,
  onStatus,
  onTitle,
  onCtrlArmed,
  onFindRequested,
  onScrollState,
  onSearchResults,
  onRequestRestart,
  onToggleRequested,
  onPumpReady,
  onPumpGone,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pumpRef = useRef<TerminalPump | null>(null);

  // Callbacks live in refs so the pump effect depends only on terminalId and
  // never tears down a live terminal because a parent re-rendered.
  const handlersRef = useRef({
    onStatus,
    onTitle,
    onCtrlArmed,
    onFindRequested,
    onScrollState,
    onSearchResults,
    onRequestRestart,
    onToggleRequested,
  });
  handlersRef.current = {
    onStatus,
    onTitle,
    onCtrlArmed,
    onFindRequested,
    onScrollState,
    onSearchResults,
    onRequestRestart,
    onToggleRequested,
  };

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const pump = new TerminalPump({
      container,
      rpc,
      terminalId,
      fontSize,
      onStatus: (status, detail) =>
        handlersRef.current.onStatus(terminalId, status, detail),
      onTitle: (title) => handlersRef.current.onTitle(terminalId, title),
      onCtrlArmed: (armed) => handlersRef.current.onCtrlArmed(armed),
      onFindRequested: () => handlersRef.current.onFindRequested(),
      onScrollState: (bottom) =>
        handlersRef.current.onScrollState(terminalId, bottom),
      onSearchResults: (results) =>
        handlersRef.current.onSearchResults(terminalId, results),
      onRequestRestart: () => handlersRef.current.onRequestRestart(terminalId),
      onToggleRequested: () => handlersRef.current.onToggleRequested(),
    });
    pumpRef.current = pump;
    onPumpReady(terminalId, pump);

    // Let layout settle before the first fit so cols/rows are real, then
    // replay scrollback and start polling.
    const raf = window.requestAnimationFrame(() => {
      pump.fit();
      pump.start();
    });

    return () => {
      window.cancelAnimationFrame(raf);
      onPumpGone(terminalId);
      pumpRef.current = null;
      pump.dispose();
    };
    // rpc and fontSize are stable at mount; later font changes apply below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId]);

  useEffect(() => {
    pumpRef.current?.setVisible(visible);
    if (visible) pumpRef.current?.focus();
  }, [visible]);

  useEffect(() => {
    pumpRef.current?.setFontSize(fontSize);
  }, [fontSize]);

  useEffect(() => {
    pumpRef.current?.refreshTheme();
  }, [themeVersion]);

  useEffect(() => {
    if (visible) pumpRef.current?.fit();
  }, [fitVersion, visible]);

  return (
    <div
      ref={containerRef}
      className={cn("size-full", visible ? "block" : "hidden")}
    />
  );
}
