import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveMetaDailyBudget } from "../app/lib/meta/budget.ts";
import { createMetaConfirmationTokenService } from "../app/lib/meta/confirmationToken.server.ts";
import { createGuardedMetaClient } from "../app/lib/meta/guardedClient.server.ts";
import { aggregateMetaPerformance, recentThreeDayRange, spendImbalanceWarning } from "../app/lib/meta/performance.ts";
import { validateMetaDraftPreflight } from "../app/lib/meta/preflight.ts";
import { GraphMetaProvider, MockMetaProvider } from "../app/lib/meta/provider.server.ts";
import { createMetaDraftRegistrationService } from "../app/lib/meta/registration.server.ts";
import { createMetaRepository } from "../app/lib/meta/repository.server.ts";
import { buildPausedAdRequest, buildPausedAdSetRequest, buildSingleMediaCreativeRequest } from "../app/lib/meta/requestBuilders.ts";

function input(overrides = {}) {
  const creative = (index = 1) => ({ hookCode: `H0${index}`, materialCode: `AT-ORS-65-H0${index}-T01`, mediaPath: `/creative-${index}.jpg`, mediaType: "image", mediaRatio: "1:1", primaryText: `문구 ${index}`, headline: `후킹 ${index}`, description: "확인된 상품 근거", landingUrl: "https://shop.example.com/product/65", utm: `utm_source=meta&utm_content=H0${index}`, approved: true });
  return { requestKey: "adv:product:T01:H01", advertiserId: "adv", advertiserName: "광고주", productId: "65", productName: "상품", testRound: 1, testType: "creative-combination", archiveEntryIds: ["asset:one"], adAccount: { id: "act_1", name: "계정", currency: "USD", timezoneName: "Asia/Seoul" }, campaign: { id: "cmp_1", accountId: "act_1", name: "판매", objective: "OUTCOME_SALES", status: "PAUSED", budgetMode: "ABO", specialAdCategories: [] }, baselineAdSet: { id: "base_1", accountId: "act_1", campaignId: "cmp_1", name: "기준", targeting: { publisher_platforms: ["facebook"] }, placements: ["facebook_feed"], promotedObject: { pixelId: "px_1", customEventType: "PURCHASE" }, optimizationGoal: "OFFSITE_CONVERSIONS", billingEvent: "IMPRESSIONS", attributionSpec: [{ event_type: "CLICK_THROUGH", window_days: 7 }] }, pageId: "page_1", pixelId: "px_1", conversionEvent: "PURCHASE", creatives: [creative(1)], ...overrides };
}

const config = { defaultDailyBudgetUsd: 5, budgetByAccount: {}, maxAdsPerRequest: 6 };

test("Meta preflight permits only approved PAUSED single-media drafts", () => {
  const value = input();
  const result = validateMetaDraftPreflight(value, config);
  assert.equal(result.ok, true);
  assert.equal(result.budget.dailyBudgetMinor, 500);
  const adSet = buildPausedAdSetRequest(value, result);
  const creative = buildSingleMediaCreativeRequest(value, value.creatives[0], "hash_1");
  const ad = buildPausedAdRequest({ materialCode: "AT", hookCode: "H01", adSetId: "set", creativeId: "creative" });
  assert.equal(adSet.status, "PAUSED");
  assert.equal(adSet.daily_budget, 500);
  assert.equal(ad.status, "PAUSED");
  assert.equal(creative.object_story_spec.link_data.call_to_action.type, "SHOP_NOW");
  const serialized = JSON.stringify({ adSet, creative, ad });
  assert.doesNotMatch(serialized, /ACTIVE|asset_feed_spec|catalog_id|degrees_of_freedom_spec/);
});

test("CBO, non-USD without approved budget, vertical mismatch, and unapproved media are blocked", () => {
  const cbo = validateMetaDraftPreflight(input({ campaign: { ...input().campaign, budgetMode: "CBO" } }), config);
  assert.equal(cbo.ok, false);
  assert.match(cbo.checks.find((item) => item.key === "campaign").detail, /캠페인 예산 방식/);
  assert.equal(resolveMetaDailyBudget({ id: "act_krw", name: "KRW", currency: "KRW", timezoneName: "Asia/Seoul" }, config).ok, false);
  const vertical = validateMetaDraftPreflight(input({ baselineAdSet: { ...input().baselineAdSet, placements: ["instagram_reels"] } }), config);
  assert.equal(vertical.checks.find((item) => item.key === "media").ok, false);
  const unapproved = input(); unapproved.creatives[0].approved = false;
  assert.equal(validateMetaDraftPreflight(unapproved, config).ok, false);
});

test("confirmation token is payload-bound, one-time, and expires", () => {
  let now = 1_000;
  const service = createMetaConfirmationTokenService({ secret: "test-secret", ttlMs: 10, now: () => now });
  const payload = input();
  const first = service.issue(payload);
  assert.equal(service.consume(first.token, { ...payload, productId: "changed" }), false);
  assert.equal(service.consume(first.token, payload), true);
  assert.equal(service.consume(first.token, payload), false);
  const expired = service.issue(payload); now = 2_000;
  assert.equal(service.consume(expired.token, payload), false);
});

test("guarded client makes zero calls while read/write flags are off", async () => {
  const provider = new MockMetaProvider();
  const client = createGuardedMetaClient({ provider, readEnabled: false, writeEnabled: false, dryRun: true });
  await assert.rejects(client.read("accounts", "me/adaccounts"), /읽기가 꺼져/);
  await assert.rejects(client.write("ad.create", "act_1/ads", { status: "PAUSED" }, { userConfirmed: true }), /비활성화/);
  assert.equal(provider.calls.length, 0);
});

test("Graph provider does not retry 4xx and retries transient 5xx at most three times", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls += 1; return new Response(JSON.stringify({ error: { message: "bad request", code: 100 } }), { status: 400 }); };
    const provider = new GraphMetaProvider({ graphApiVersion: "v-test", systemUserAccessToken: "token", timeoutMs: 1000 });
    await assert.rejects(provider.request({ operation: "accounts", method: "GET", path: "me/adaccounts" }));
    assert.equal(calls, 1);
    calls = 0;
    globalThis.fetch = async () => { calls += 1; return new Response(JSON.stringify({ error: { message: "temporary", is_transient: true } }), { status: 500 }); };
    await assert.rejects(provider.request({ operation: "accounts", method: "GET", path: "me/adaccounts" }));
    assert.equal(calls, 3);
  } finally { globalThis.fetch = originalFetch; }
});

test("mock registration is sequential, idempotent, and never creates ACTIVE", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-meta-"));
  const saved = Object.fromEntries(["META_READ_ENABLED", "META_WRITE_ENABLED", "META_DRY_RUN", "META_DEFAULT_ADSET_DAILY_BUDGET_USD"].map((key) => [key, process.env[key]]));
  Object.assign(process.env, { META_READ_ENABLED: "true", META_WRITE_ENABLED: "true", META_DRY_RUN: "false", META_DEFAULT_ADSET_DAILY_BUDGET_USD: "5" });
  try {
    const provider = new MockMetaProvider({ "adset.create": { id: "set_new" }, "media.upload": { hash: "media_hash" }, "creative.create": { id: "creative_new" }, "ad.create": { id: "ad_new" }, adsets: { id: "set_new", status: "PAUSED", daily_budget: 500, campaign_id: "cmp_1" }, ads: { id: "ad_new", status: "PAUSED", adset_id: "set_new" } });
    const repository = createMetaRepository({ dataDirectory: directory });
    const service = createMetaDraftRegistrationService({ provider, repository });
    const value = input();
    const confirmation = service.issueConfirmation(value);
    const result = await service.register(value, confirmation.token);
    assert.equal(result.status, "success");
    assert.deepEqual(provider.calls.map((call) => call.operation), ["adset.create", "media.upload", "creative.create", "ad.create", "adsets", "ads"]);
    assert.doesNotMatch(JSON.stringify(provider.calls), /ACTIVE/);
    const stored = await repository.read();
    assert.equal(stored.performance.length, 1);
    assert.equal(stored.performance[0].testType, "creative-combination");
    assert.deepEqual(stored.performance[0].archiveEntryIds, ["asset:one"]);
    assert.equal(stored.performance[0].rows[0].materialCode, "AT-ORS-65-H01-T01");
    const second = await service.register(value, service.issueConfirmation(value).token);
    assert.equal(second.id, result.id);
    assert.equal(provider.calls.length, 6);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("performance snapshots dedupe by ad/date and avoid division errors", () => {
  const experiment = { id: "perf", advertiserId: "adv", advertiserName: "A", productId: "p", productName: "P", adAccountId: "a", adAccountName: "A", currency: "USD", campaignId: "c", campaignName: "C", adSetId: "s", adSetName: "S", metaStatus: "PAUSED", trackingEnabled: true, trackingStatus: "collecting", timezoneName: "UTC", attributionSetting: "7d", rows: [{ hookCode: "H01", materialCode: "AT-H01", adId: "ad1", adName: "H01", impressions: 0, spend: 0, outboundClicks: 0, landingPageViews: 0, purchases: 0, purchaseValue: 0, ctr: 0, cpc: 0, cpa: 0, roas: 0, spendShare: 0, status: "" }, { hookCode: "H02", materialCode: "AT-H02", adId: "ad2", adName: "H02", impressions: 0, spend: 0, outboundClicks: 0, landingPageViews: 0, purchases: 0, purchaseValue: 0, ctr: 0, cpc: 0, cpa: 0, roas: 0, spendShare: 0, status: "" }] };
  const base = { dateStart: "2026-08-20", dateStop: "2026-08-20", reach: 0, clicks: 0, landingPageViews: 0, fetchedAt: "now" };
  const updated = aggregateMetaPerformance(experiment, [{ ...base, adId: "ad1", impressions: 1000, spend: 90, outboundClicks: 0, purchases: 0, purchaseValue: 0 }, { ...base, adId: "ad1", impressions: 1000, spend: 90, outboundClicks: 0, purchases: 0, purchaseValue: 0 }, { ...base, adId: "ad2", impressions: 1000, spend: 10, outboundClicks: 0, purchases: 0, purchaseValue: 0 }], { impressions: 1, outboundClicks: 0, purchases: 0, spend: 1 });
  assert.equal(updated.rows[0].spend, 90);
  assert.equal(updated.rows[0].cpc, 0);
  assert.match(spendImbalanceWarning(updated.rows), /90%/);
  assert.deepEqual(recentThreeDayRange(new Date("2026-08-20T12:00:00Z")), { since: "2026-08-18", until: "2026-08-20" });
});
