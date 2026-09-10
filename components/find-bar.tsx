// Find in scrollback.
//
// Opened by Cmd/Ctrl+F from inside the terminal, or the `find` key on the
// mobile bar. Deliberately tiny: a query, a count, previous/next, close. It
// floats over the top-right of the terminal so the output being searched stays
// visible, and Escape puts focus straight back at the prompt.
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";

export interface FindBarProps {
  query: string;
  /** Null until a search has run; the count renders only when real. */
  results: { index: number; count: number } | null;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}

export function FindBar({
  query,
  results,
  onQueryChange,
  onNext,
  onPrevious,
  onClose,
}: FindBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The bar exists to be typed into; focus it the moment it appears.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div
      data-no-drag=""
      className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-lg"
      role="search"
      aria-label="Find in scrollback"
    >
      <Input
        ref={inputRef}
        value={query}
        placeholder="Find"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="h-7 w-40 border-none bg-transparent px-2 text-xs shadow-none focus-visible:ring-0"
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      />
      {/* 0/0 for a query nothing matches — silence would read as "still searching". */}
      {results === null || query === "" ? null : (
        <span className="min-w-8 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
          {results.count === 0 ? "0/0" : `${results.index + 1}/${results.count}`}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground"
        aria-label="Previous match"
        onClick={onPrevious}
      >
        <Icon name="ChevronUp" className="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground"
        aria-label="Next match"
        onClick={onNext}
      >
        <Icon name="ChevronDown" className="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground"
        aria-label="Close find"
        onClick={onClose}
      >
        <Icon name="X" className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}
