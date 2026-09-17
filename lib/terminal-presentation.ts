/** Observe only real CSI controls, never escape-looking text inside OSC/DCS.
 * Wterm's current Ghostty adapter does not expose DECSCUSR cursor shape. */
export class TerminalPresentation {
  private state: "text" | "escape" | "csi" | "string" | "string-escape" = "text";
  private body = "";
  constructor(private readonly element: HTMLElement) {}

  reset(): void {
    this.state = "text";
    this.body = "";
    this.setCursor(0);
  }

  private setCursor(style: number): void {
    this.element.dataset.cursorShape = style >= 5 ? "bar" : style >= 3 ? "underline" : "block";
    this.element.classList.toggle("cursor-blink", style === 0 || style % 2 === 1);
  }

  consume(bytes: Uint8Array): void {
    for (const byte of bytes) {
      if (byte === 0x18 || byte === 0x1a) { this.state = "text"; continue; }
      const char = String.fromCharCode(byte);
      switch (this.state) {
        case "text":
          if (byte === 0x1b) this.state = "escape";
          break;
        case "escape":
          this.body = "";
          if (char === "[") this.state = "csi";
          else if ("]PX^_".includes(char)) this.state = "string";
          else {
            if (char === "c") this.setCursor(0);
            this.state = byte === 0x1b ? "escape" : "text";
          }
          break;
        case "csi":
          if (byte === 0x1b) { this.state = "escape"; break; }
          if (byte >= 0x40 && byte <= 0x7e) {
            if (char === "q" && /^[0-6]? $/.test(this.body)) this.setCursor(Number(this.body.trim() || 0));
            this.state = "text";
          } else if (this.body.length < 64) this.body += char;
          else this.state = "text";
          break;
        case "string":
          if (byte === 7) this.state = "text";
          else if (byte === 0x1b) this.state = "string-escape";
          break;
        case "string-escape":
          this.state = char === "\\" || byte === 7 ? "text" : byte === 0x1b ? "string-escape" : "string";
          break;
      }
    }
  }
}

/** CSS computed RGB becomes the 16-bit channel spelling used by OSC 10/11. */
export function oscColor(color: string): string | null {
  const channels = color.match(/^rgba?\(\s*(\d+(?:\.\d+)?)[, ]+\s*(\d+(?:\.\d+)?)[, ]+\s*(\d+(?:\.\d+)?)/);
  if (!channels) {
    // Modern BB themes may use OKLCH or display-p3. Canvas converts CSS colors
    // to sRGB, the color space terminal RGB queries expect.
    if (typeof CanvasRenderingContext2D === "undefined" || !color || color.includes("var(")) return null;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return a ? oscColor(`rgb(${r}, ${g}, ${b})`) : null;
  }
  return "rgb:" + channels.slice(1).map(value => Math.round(Math.min(255, Number(value)) * 257).toString(16).padStart(4, "0")).join("/");
}
