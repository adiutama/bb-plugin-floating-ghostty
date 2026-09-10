// Suggestion ordering. The point of the picker is that the top of the list is
// where you actually work, so recency must win and must not also leave the
// same directory duplicated further down.
import { describe, expect, it } from "vitest";
import { buildSections, shortenPath, type ScopeOption } from "./scopes";

function scope(key: string, kind: "project" | "home" = "project"): ScopeOption {
  return {
    key,
    label: key,
    detail: `/src/${key}`,
    hostName: "mac",
    online: true,
    kind,
  };
}

const all = [
  scope("alpha"),
  scope("beta"),
  scope("home:mac", "home"),
  scope("home:remote", "home"),
];

describe("buildSections", () => {
  it("groups projects and machines when nothing is recent", () => {
    const sections = buildSections(all, []);
    expect(sections.map((s) => s.id)).toEqual(["projects", "machines"]);
    expect(sections[0]!.scopes.map((s) => s.key)).toEqual(["alpha", "beta"]);
  });

  it("lifts recent directories to the top in most-recent-first order", () => {
    const sections = buildSections(all, ["home:remote", "beta"]);
    expect(sections[0]!.id).toBe("recent");
    expect(sections[0]!.scopes.map((s) => s.key)).toEqual([
      "home:remote",
      "beta",
    ]);
  });

  it("never lists a recent directory twice", () => {
    const sections = buildSections(all, ["beta"]);
    const keys = sections.flatMap((s) => s.scopes.map((x) => x.key));
    expect(keys.filter((k) => k === "beta")).toHaveLength(1);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("drops a remembered directory that no longer exists", () => {
    const sections = buildSections(all, ["deleted-project", "alpha"]);
    expect(sections[0]!.scopes.map((s) => s.key)).toEqual(["alpha"]);
  });

  it("omits empty sections entirely", () => {
    const sections = buildSections([scope("only")], []);
    expect(sections.map((s) => s.id)).toEqual(["projects"]);
  });
});

describe("shortenPath", () => {
  it("elides the head so the leaf directory always survives", () => {
    expect(shortenPath("/Users/alex/Git/acme-storefront")).toBe(
      "…/Git/acme-storefront",
    );
  });

  it("leaves a path that already fits completely alone", () => {
    expect(shortenPath("/opt/homebrew/bin")).toBe("/opt/homebrew/bin");
    expect(shortenPath("~")).toBe("~");
  });

  it("never claims another user's home is yours", () => {
    // The whole reason this is elision and not ~-substitution.
    expect(shortenPath("/Users/someone-else/secrets/keys")).not.toContain("~");
  });

  it("keeps a long two-segment path rather than eliding to nothing", () => {
    const path = "/an-extremely-long-single-directory-name-here/leaf";
    expect(shortenPath(path)).toBe(path);
  });
});
