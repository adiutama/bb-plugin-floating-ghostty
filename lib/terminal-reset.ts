/** Split real RIS controls from a byte stream without interpreting string payloads.
 * The ESC may already have reached the core in the preceding transport chunk;
 * recreating the core discards that incomplete escape as well. */
export class TerminalResetWriter {
  private state: "text" | "escape" | "string" | "string-escape" = "text";

  write(bytes: Uint8Array, write: (bytes: Uint8Array) => void, reset: () => void): void {
    let start = 0;
    for (let index = 0; index < bytes.length; index++) {
      const byte = bytes[index];
      if (byte === 0x18 || byte === 0x1a) {
        this.state = "text";
        continue;
      }
      switch (this.state) {
        case "text":
          if (byte === 0x1b) this.state = "escape";
          break;
        case "escape":
          if (byte === 0x63) {
            if (index > start) write(bytes.subarray(start, index));
            reset();
            start = index + 1;
            this.state = "text";
          } else if ([0x5d, 0x50, 0x58, 0x5e, 0x5f].includes(byte)) {
            this.state = "string";
          } else if (byte !== 0x1b && byte >= 0x20) {
            this.state = "text";
          }
          break;
        case "string":
          if (byte === 7) this.state = "text";
          else if (byte === 0x1b) this.state = "string-escape";
          break;
        case "string-escape":
          this.state = byte === 0x5c || byte === 7
            ? "text" : byte === 0x1b ? "string-escape" : "string";
          break;
      }
    }
    if (start < bytes.length) write(bytes.subarray(start));
  }
}
