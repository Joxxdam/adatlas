import assert from "node:assert/strict";
import test from "node:test";

import { robotsAllowsUrl } from "../app/lib/store-analysis/urlSafety.ts";

const ririncoPolicy = {
  found: true,
  disallowedPaths: ["/admin", "/exec/front/", "/skin-*", "/*board*page=", "/*article*category_no="],
};

test("robots wildcards do not turn a partial path rule into a site-wide block", () => {
  assert.equal(robotsAllowsUrl(ririncoPolicy, "https://ririnco.com/"), true);
  assert.equal(
    robotsAllowsUrl(ririncoPolicy, "https://ririnco.com/product/list.html?cate_no=62"),
    true
  );
  assert.equal(
    robotsAllowsUrl(ririncoPolicy, "https://ririnco.com/board/product/list.html?board_no=4&page=2"),
    false
  );
});

test("robots wildcard and end-anchor semantics remain enforced", () => {
  assert.equal(robotsAllowsUrl(ririncoPolicy, "https://ririnco.com/admin"), false);
  assert.equal(
    robotsAllowsUrl(ririncoPolicy, "https://ririnco.com/skin-mobile/layout.html"),
    false
  );

  const anchoredPolicy = { found: true, disallowedPaths: ["/private$"] };
  assert.equal(robotsAllowsUrl(anchoredPolicy, "https://ririnco.com/private"), false);
  assert.equal(robotsAllowsUrl(anchoredPolicy, "https://ririnco.com/private/page"), true);
});

test("an explicit root disallow still blocks the whole store", () => {
  const blockedPolicy = { found: true, disallowedPaths: ["/"] };
  assert.equal(robotsAllowsUrl(blockedPolicy, "https://ririnco.com/"), false);
  assert.equal(robotsAllowsUrl(blockedPolicy, "https://ririnco.com/product/1"), false);
});
