import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { resolveGitSha } from "../git-sha.js";

describe("resolveGitSha", () => {
  test("an OWH_GIT_SHA env override wins and never shells out", () => {
    const sha = resolveGitSha({
      env: { OWH_GIT_SHA: "abc1234" },
      run: () => {
        throw new Error("must not shell out when env override is present");
      },
    });
    assert.equal(sha, "abc1234");
  });

  test("falls back to the injected git command's trimmed output when no env override", () => {
    const sha = resolveGitSha({ env: {}, run: () => "deadbee\n" });
    assert.equal(sha, "deadbee");
  });

  test("falls back to 'unknown' when the git command throws (git unavailable)", () => {
    const sha = resolveGitSha({
      env: {},
      run: () => {
        throw new Error("git: command not found");
      },
    });
    assert.equal(sha, "unknown");
  });

  test("falls back to 'unknown' when the git command returns blank output", () => {
    const sha = resolveGitSha({ env: {}, run: () => "   \n" });
    assert.equal(sha, "unknown");
  });

  test("an empty-string env override does not win (falls through to git)", () => {
    const sha = resolveGitSha({ env: { OWH_GIT_SHA: "" }, run: () => "fedcba1" });
    assert.equal(sha, "fedcba1");
  });
});
