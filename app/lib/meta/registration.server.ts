import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readMetaServerConfig } from "./config.server.ts";
import { metaConfirmationTokens } from "./confirmationToken.server.ts";
import { createGuardedMetaClient } from "./guardedClient.server.ts";
import { validateMetaDraftPreflight } from "./preflight.ts";
import { GraphMetaProvider, type MetaProvider } from "./provider.server.ts";
import { buildPausedAdRequest, buildPausedAdSetRequest, buildSingleMediaCreativeRequest } from "./requestBuilders.ts";
import { metaRepository, type createMetaRepository } from "./repository.server.ts";
import type { MetaDraftRegistrationInput, MetaRegistrationJob, MetaRegistrationItem } from "./types.ts";

type Repository = ReturnType<typeof createMetaRepository>;

async function contentHash(path: string, fallback: string) {
  try {
    const buffer = await readFile(path.startsWith("/") ? `${process.cwd()}/public${path}` : path);
    return createHash("sha256").update(buffer).digest("hex");
  } catch {
    return createHash("sha256").update(fallback).digest("hex");
  }
}

export function createMetaDraftRegistrationService(options?: { provider?: MetaProvider; repository?: Repository }) {
  const config = readMetaServerConfig();
  const repository = options?.repository || metaRepository;
  const provider =
    options?.provider ||
    new GraphMetaProvider({
      graphApiVersion: config.graphApiVersion,
      systemUserAccessToken: config.systemUserAccessToken,
      appSecret: config.appSecret,
      timeoutMs: config.requestTimeoutMs,
    });
  const client = createGuardedMetaClient({
    provider,
    readEnabled: config.readEnabled,
    writeEnabled: config.writeEnabled,
    dryRun: config.dryRun,
  });

  async function ensurePerformanceExperiment(input: MetaDraftRegistrationInput, job: MetaRegistrationJob) {
    if (!job.adSetId) return;
    const creativeByMaterialCode = new Map(input.creatives.map((creative) => [creative.materialCode, creative]));
    const rows = job.items
      .filter((item) => Boolean(item.adId))
      .map((item) => {
        const creative = creativeByMaterialCode.get(item.materialCode);
        return {
          hookCode: item.hookCode,
          materialCode: item.materialCode,
          adId: String(item.adId),
          adName: creative?.materialCode || `${item.hookCode} ${input.productName}`,
          impressions: 0,
          spend: 0,
          outboundClicks: 0,
          landingPageViews: 0,
          purchases: 0,
          purchaseValue: 0,
          ctr: 0,
          cpc: 0,
          cpa: 0,
          roas: 0,
          spendShare: 0,
          status: "추가 데이터 필요",
        };
      });
    if (!rows.length) return;
    const experimentId = `meta-performance-${job.id}`;
    const alreadyLinked = (await repository.read()).performance.find((experiment) => experiment.adSetId === job.adSetId && experiment.id !== experimentId);
    if (alreadyLinked) return;
    await repository.upsertPerformance({
      id: experimentId,
      advertiserId: input.advertiserId,
      advertiserName: input.advertiserName,
      productId: input.productId,
      productName: input.productName,
      landingUrl: input.creatives[0]?.landingUrl,
      testRound: input.testRound,
      testType: input.testType || "creative-combination",
      archiveEntryIds: input.archiveEntryIds,
      source: "meta",
      adAccountId: input.adAccount.id,
      adAccountName: input.adAccount.name,
      currency: input.adAccount.currency,
      campaignId: input.campaign.id,
      campaignName: input.campaign.name,
      adSetId: job.adSetId,
      adSetName: `${input.productName} T${String(input.testRound).padStart(2, "0")} PAUSED`,
      metaStatus: job.status.toUpperCase(),
      trackingEnabled: false,
      trackingStatus: "prelaunch",
      timezoneName: input.adAccount.timezoneName,
      attributionSetting: JSON.stringify(input.baselineAdSet.attributionSpec || []),
      rows,
    });
  }

  async function verifyCreatedDraft(input: MetaDraftRegistrationInput, job: MetaRegistrationJob, expectedBudget: number) {
    if (!config.readEnabled || !job.adSetId) return false;
    const adSet = await client.read<Record<string, unknown>>("adsets", job.adSetId, {
      fields: "id,status,effective_status,daily_budget,campaign_id",
    });
    if (String(adSet.status) !== "PAUSED" || Number(adSet.daily_budget) !== expectedBudget || String(adSet.campaign_id) !== input.campaign.id) {
      return false;
    }
    for (const item of job.items) {
      if (!item.adId) continue;
      const ad = await client.read<Record<string, unknown>>("ads", item.adId, {
        fields: "id,status,effective_status,adset_id",
      });
      if (String(ad.status) !== "PAUSED" || String(ad.adset_id) !== job.adSetId) return false;
    }
    return true;
  }

  return {
    preflight(input: MetaDraftRegistrationInput) {
      return validateMetaDraftPreflight(input, config);
    },
    issueConfirmation(input: MetaDraftRegistrationInput) {
      const preflight = validateMetaDraftPreflight(input, config);
      if (!preflight.ok) throw new Error("사전 검토를 먼저 완료해 주세요.");
      return { preflight, ...metaConfirmationTokens.issue(input) };
    },
    async register(input: MetaDraftRegistrationInput, confirmationToken: string) {
      const preflight = validateMetaDraftPreflight(input, config);
      if (!preflight.ok) throw new Error("Meta 등록 사전 검토를 통과하지 못했습니다.");
      if (!metaConfirmationTokens.consume(confirmationToken, input)) throw new Error("최종 확인 토큰이 없거나 만료되었거나 등록 내용이 변경되었습니다.");
      const existing = await repository.findRegistrationByRequestKey(input.requestKey);
      if (existing) {
        await ensurePerformanceExperiment(input, existing);
        return existing;
      }
      if (!repository.acquireLock(input.requestKey)) throw new Error("동일한 Meta 등록 요청이 이미 처리 중입니다.");
      const now = new Date().toISOString();
      const job: MetaRegistrationJob = {
        id: `meta-registration-${randomUUID()}`,
        requestKey: input.requestKey,
        advertiserId: input.advertiserId,
        productId: input.productId,
        adAccountId: input.adAccount.id,
        campaignId: input.campaign.id,
        baselineAdSetId: input.baselineAdSet.id,
        testType: input.testType || "creative-combination",
        archiveEntryIds: input.archiveEntryIds,
        status: "pending",
        items: [],
        createdAt: now,
        updatedAt: now,
      };
      await repository.saveRegistration(job);
      try {
        const adSet = await client.write<{ id: string }>("adset.create", `${input.adAccount.id}/adsets`, buildPausedAdSetRequest(input, preflight), { userConfirmed: true });
        job.adSetId = adSet.id;
        for (const creative of input.creatives) {
          const item: MetaRegistrationItem = {
            hookCode: creative.hookCode,
            materialCode: creative.materialCode,
            status: "failed",
          };
          try {
            const hash = creative.mediaHash || (await contentHash(creative.mediaPath, creative.materialCode));
            let mediaId = await repository.findMediaId(hash);
            if (!mediaId) {
              const uploaded = await client.write<{ id?: string; hash?: string }>("media.upload", `${input.adAccount.id}/adimages`, { filename: creative.mediaPath, hash }, { userConfirmed: true });
              mediaId = uploaded.hash || uploaded.id || "";
              if (!mediaId) throw new Error("Meta 미디어 ID를 확인하지 못했습니다.");
              await repository.saveMediaHash(hash, mediaId);
            }
            item.mediaId = mediaId;
            const createdCreative = await client.write<{ id: string }>("creative.create", `${input.adAccount.id}/adcreatives`, buildSingleMediaCreativeRequest(input, creative, mediaId), { userConfirmed: true });
            item.creativeId = createdCreative.id;
            const createdAd = await client.write<{ id: string }>(
              "ad.create",
              `${input.adAccount.id}/ads`,
              buildPausedAdRequest({
                materialCode: creative.materialCode,
                hookCode: creative.hookCode,
                adSetId: adSet.id,
                creativeId: createdCreative.id,
              }),
              { userConfirmed: true }
            );
            item.adId = createdAd.id;
            item.status = "safety_verification_incomplete";
          } catch (error) {
            item.error = error instanceof Error ? error.message : "광고 생성 실패";
          }
          job.items.push(item);
          job.updatedAt = new Date().toISOString();
          await repository.saveRegistration(job);
        }
        const successCount = job.items.filter((item) => item.adId).length;
        if (successCount === input.creatives.length) {
          let verified = false;
          try {
            verified = await verifyCreatedDraft(input, job, preflight.budget.dailyBudgetMinor!);
          } catch {
            verified = false;
          }
          job.status = verified ? "success" : "safety_verification_incomplete";
          for (const item of job.items) {
            item.status = verified ? "success" : "safety_verification_incomplete";
          }
        } else {
          job.status = successCount ? "partial" : "failed";
        }
        job.updatedAt = new Date().toISOString();
        await repository.saveRegistration(job);
        await ensurePerformanceExperiment(input, job);
        return job;
      } finally {
        repository.releaseLock(input.requestKey);
      }
    },
  };
}
