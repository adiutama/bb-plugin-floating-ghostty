import { describe, expect, it } from "vitest";
import {
  environmentExportScript,
  parseProjectEnvironment,
} from "../lib/project-environment";

describe("project environment parser", () => {
  it("parses dotenv values without evaluating shell syntax", () => {
    expect(
      parseProjectEnvironment(
        [
          "# project values",
          "PLAIN=value",
          "export EMPTY=",
          "HASH='value#kept'",
          'MULTILINE="first\\nsecond"',
          "COMMAND=$(touch /tmp/never-run)",
        ].join("\n"),
      ),
    ).toEqual([
      { key: "PLAIN", value: "value" },
      { key: "EMPTY", value: "" },
      { key: "HASH", value: "value#kept" },
      { key: "MULTILINE", value: "first\nsecond" },
      { key: "COMMAND", value: "$(touch /tmp/never-run)" },
    ]);
  });

  it("rejects malformed, duplicate, and integration-owned assignments", () => {
    expect(() => parseProjectEnvironment("NOT AN ASSIGNMENT")).toThrow(
      /expected '='/,
    );
    expect(() => parseProjectEnvironment("TOKEN=one\nTOKEN=two")).toThrow(
      /assigned more than once/,
    );
    expect(() =>
      parseProjectEnvironment("BB_FLOATING_GHOSTTY_ENV_FILE=x"),
    ).toThrow(/reserved/);
  });

  it("quotes every value in the generated export file", () => {
    expect(
      environmentExportScript([
        { key: "TOKEN", value: "a'b $(echo nope)" },
      ]),
    ).toBe("export TOKEN='a'\"'\"'b $(echo nope)'\n");
  });
});
