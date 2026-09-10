const OSC_INTRODUCER = "\x1b]";
const BEL = "\x07";
const ST = "\x1b\\";
const MAX_FRAME_BYTES = 1_048_576;
const CLIPBOARD_SPECIFIERS = new Set(["", "c", "p", "s", "0", "1", "2", "3", "4", "5", "6", "7"]);

export function decodeLatin1(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

export function encodeLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index) & 0xff;
  }
  return bytes;
}

export function decodeOsc52Payload(base64: string): string | null {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function copyWithExecCommand(text: string): boolean {
  if (typeof document === "undefined") return false;
  let field: HTMLTextAreaElement | null = null;
  try {
    field = document.createElement("textarea") as HTMLTextAreaElement;
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.left = "-9999px";
    document.body.append(field);
    field.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field?.remove();
  }
}

export function copyTextToClipboard(text: string): void {
  if (text.length === 0) return;
  copyWithExecCommand(text);
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard?.writeText) return;
  try {
    void clipboard.writeText(text);
  } catch {
    // Native clipboard permission failures may surface synchronously.
  }
}

export async function approveClipboardText(text: string): Promise<boolean> {
  if (text.length === 0) return false;
  const clipboard = globalThis.navigator?.clipboard;
  const writeText = clipboard?.writeText?.bind(clipboard);
  if (!writeText) return false;
  try {
    await writeText(text);
    return true;
  } catch {
    return false;
  }
}

export class Osc52ClipboardFilter {
  private carry = "";
  private discarding = false;

  constructor(private readonly onWrite: (text: string) => void) {}

  consumeString(text: string): string {
    return this.consume(text);
  }

  consumeBytes(data: Uint8Array): Uint8Array {
    if (this.carry.length === 0 && !this.discarding && data.indexOf(0x1b) < 0) return data;
    const decoded = decodeLatin1(data);
    const next = this.consume(decoded);
    return next === decoded ? data : encodeLatin1(next);
  }

  private consume(text: string): string {
    const stream = this.carry + text;
    this.carry = "";
    let output = "";
    let cursor = 0;

    while (cursor < stream.length) {
      if (this.discarding) {
        const terminator = this.findTerminator(stream, cursor);
        if (terminator.end < 0) {
          this.carry = stream.endsWith("\x1b") ? "\x1b" : "";
          return output;
        }
        this.discarding = false;
        cursor = terminator.end + terminator.length;
        continue;
      }

      const start = stream.indexOf(OSC_INTRODUCER, cursor);
      if (start < 0) {
        const endsWithEsc = stream.endsWith("\x1b");
        output += stream.slice(cursor, endsWithEsc ? -1 : undefined);
        this.carry = endsWithEsc ? "\x1b" : "";
        return output;
      }

      output += stream.slice(cursor, start);
      const bodyStart = start + OSC_INTRODUCER.length;
      if (stream.length - bodyStart < 3) {
        this.carry = this.boundedCarry(stream.slice(start));
        return output;
      }

      if (!stream.startsWith("52;", bodyStart)) {
        const nextIntroducer = stream.indexOf(OSC_INTRODUCER, start + 1);
        if (nextIntroducer < 0) {
          output += stream.slice(start);
          this.carry = "";
          return output;
        }
        output += stream.slice(start, nextIntroducer);
        cursor = nextIntroducer;
        continue;
      }

      const payloadStart = bodyStart + 3;
      const terminator = this.findTerminator(stream, payloadStart);
      if (terminator.end < 0) {
        const frame = stream.slice(start);
        if (frame.length > MAX_FRAME_BYTES) {
          this.discarding = true;
          this.carry = stream.endsWith("\x1b") ? "\x1b" : "";
        } else {
          this.carry = this.boundedCarry(frame);
        }
        return output;
      }

      const frameLength = terminator.end + terminator.length - start;
      if (frameLength <= MAX_FRAME_BYTES) {
        this.handlePayload(stream.slice(payloadStart, terminator.end));
      }
      cursor = terminator.end + terminator.length;
    }

    this.carry = "";
    return output;
  }

  private findTerminator(stream: string, start: number): { end: number; length: number } {
    const bel = stream.indexOf(BEL, start);
    const st = stream.indexOf(ST, start);
    if (bel < 0 && st < 0) return { end: -1, length: 0 };
    if (st < 0 || (bel >= 0 && bel <= st)) return { end: bel, length: 1 };
    return { end: st, length: 2 };
  }

  private boundedCarry(value: string): string {
    return value.length > MAX_FRAME_BYTES ? "" : value;
  }

  private handlePayload(payload: string): void {
    const separator = payload.indexOf(";");
    if (separator < 0) return;
    const specifier = payload.slice(0, separator);
    const data = payload.slice(separator + 1);
    if (!CLIPBOARD_SPECIFIERS.has(specifier) || data.length === 0 || data === "?") {
      return;
    }
    const text = decodeOsc52Payload(data);
    if (text) this.onWrite(text);
  }
}
