// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSwitcherTitles } from "../lib/use-switcher-titles";

afterEach(() => vi.useRealTimers());

it("refreshes inactive command names in the switcher and stops reading when dismissed", async () => {
  vi.useFakeTimers();
  let reads = 0;
  const call = vi.fn(async () => ({
    chunks: [
      {
        dataBase64: btoa(
          reads++ === 0
            ? "\x1b]0;bb-fg:command:sleep\x07"
            : "\x1b]0;bb-fg:shell:zsh\x07",
        ),
      },
    ],
    nextSeq: reads,
  }));
  const rpc = { call } as any;
  const onTitle = vi.fn();
  const view = renderHook(
    ({ enabled }) => useSwitcherTitles(rpc, ["inactive"], enabled, onTitle),
    { initialProps: { enabled: true } },
  );
  await act(async () => {});
  expect(onTitle).toHaveBeenLastCalledWith("inactive", "bb-fg:command:sleep");
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(onTitle).toHaveBeenLastCalledWith("inactive", "bb-fg:shell:zsh");
  expect(call).toHaveBeenLastCalledWith("read", {
    terminalId: "inactive",
    sinceSeq: 1,
  });
  view.rerender({ enabled: false });
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(call).toHaveBeenCalledTimes(2);
  view.unmount();
});

it("bounds concurrent reads and ignores results after leaving the switcher", async () => {
  const resolve: Array<(value: unknown) => void> = [];
  const call = vi.fn(() => new Promise((done) => resolve.push(done)));
  const onTitle = vi.fn();
  const rpc = { call } as any;
  const view = renderHook(
    ({ enabled }) =>
      useSwitcherTitles(rpc, ["1", "2", "3", "4", "5"], enabled, onTitle),
    { initialProps: { enabled: true } },
  );
  expect(call).toHaveBeenCalledTimes(4);
  view.rerender({ enabled: false });
  await act(async () => {
    for (const done of resolve)
      done({ chunks: [{ dataBase64: btoa("\x1b]0;old\x07") }], nextSeq: 1 });
  });
  expect(onTitle).not.toHaveBeenCalled();
  expect(call).toHaveBeenCalledTimes(4);
  view.unmount();
});
