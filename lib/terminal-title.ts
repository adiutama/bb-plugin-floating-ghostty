/** Passive OSC 0/2 observer: Ghostty 0.5's getTitle() is not implemented.
 * Keep parsing independent of rendering so hidden/replayed output updates names.
 * The bounded buffer never consumes or changes the terminal's output.
 */
export class TerminalTitleObserver {
  private decoder = new TextDecoder();
  private state: "text" | "escape" | "osc" | "osc-escape" = "text";
  private body = "";
  private overflow = false;

  constructor(
    private readonly onTitle: (title: string) => void,
    private readonly onDirectory: (cwd: string) => void = () => {},
  ) {}

  consume(bytes: Uint8Array): void {
    for (const char of this.decoder.decode(bytes, { stream: true })) {
      if (this.state === "text") {
        if (char === "\x1b") this.state = "escape";
      } else if (this.state === "escape") {
        this.state = char === "]" ? "osc" : char === "\x1b" ? "escape" : "text";
        this.body = "";
        this.overflow = false;
      } else if (
        char === "\x07" ||
        (this.state === "osc-escape" && char === "\\")
      ) {
        if (!this.overflow && /^(0|2);/.test(this.body)) {
          this.onTitle(this.body.slice(2));
        } else if (!this.overflow) {
          let cwd: string | undefined;
          if (this.body.startsWith("1337;CurrentDir="))
            cwd = this.body.slice(16);
          else if (this.body.startsWith("7;file://")) {
            try {
              cwd = decodeURIComponent(new URL(this.body.slice(2)).pathname);
            } catch {
              /* Invalid OSC path. */
            }
          }
          if (cwd?.startsWith("/") && !/[\x00-\x1f\x7f]/.test(cwd))
            this.onDirectory(cwd);
        }
        this.state = "text";
        this.body = "";
      } else if (char === "\x18" || char === "\x1a") {
        this.state = "text";
        this.body = "";
      } else {
        if (this.state === "osc-escape") this.overflow = true;
        this.state = char === "\x1b" ? "osc-escape" : "osc";
        if (char !== "\x1b" && !this.overflow) {
          if (this.body.length < 4096) this.body += char;
          else {
            this.body = "";
            this.overflow = true;
          }
        }
      }
    }
  }
}
