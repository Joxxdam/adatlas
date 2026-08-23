import sharp from "sharp";
import { readCreativeRasterAsset } from "./assets.server.ts";
import type { MasterSceneGenerationMode, PlacementBox, ProductReferenceProfile } from "./types.ts";

export type ProductIdentityEvaluation = {
  score: number;
  productVisible: boolean;
  severeDistortion: boolean;
  textArtifactDetected: boolean;
  brandMismatch: boolean;
  humanArtifactDetected: boolean;
  groundingMismatch: boolean;
  estimatedProductAreaRatio?: number;
  productBounds?: PlacementBox;
  findings: string[];
  method: "protected-original" | "vision" | "conservative-local";
};

function clamp(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : fallback;
}

async function imageDataUrl(buffer: Buffer) {
  const resized = await sharp(buffer).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  return `data:image/jpeg;base64,${resized.toString("base64")}`;
}

function outputText(payload: unknown) {
  const value = payload as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (value.output_text) return value.output_text;
  return (value.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text)
    .join("\n");
}

async function visionIdentityEvaluation(input: { profile: ProductReferenceProfile; candidate: Buffer }) {
  const reference = input.profile.referenceImages.find((image) => image.usableForGeneration && !image.duplicateOf);
  if (!reference) return null;
  const referenceBuffer = await readCreativeRasterAsset(reference.url);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_TEXT_MODEL || "gpt-5.6-sol",
      temperature: 0,
      max_output_tokens: 500,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: ["첫 이미지는 실제 판매 제품 레퍼런스이고 두 번째 이미지는 광고 장면 후보다.", "제품 종류, 실루엣, 비율, 대표 색상, 패키지·라벨 구조, 구성 수량, 옵션을 보수적으로 비교하라.", "읽기 어려운 로고 글자를 추측하지 말고, 다른 상품처럼 보이면 낮게 평가하라.", `반드시 보존할 특징: ${input.profile.visualIdentity.mustPreserve.join("; ")}`, "손·얼굴·신체 왜곡, 제품이 떠 보이는 접촉 그림자, 조명·원근 불일치도 함께 검사하라.", "후보 이미지에서 실제 상품이 차지하는 픽셀 면적 비율(0~1)과 1200×1200 좌표계의 상품 경계도 보수적으로 추정하라.", "JSON만 반환: {score:0-100,productVisible:boolean,severeDistortion:boolean,textArtifactDetected:boolean,brandMismatch:boolean,humanArtifactDetected:boolean,groundingMismatch:boolean,estimatedProductAreaRatio:0-1,productBounds:{x:number,y:number,width:number,height:number},findings:string[]}"].join("\n"),
            },
            { type: "input_image", image_url: await imageDataUrl(referenceBuffer), detail: "high" },
            { type: "input_image", image_url: await imageDataUrl(input.candidate), detail: "high" },
          ],
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`제품 동일성 검사 실패: HTTP ${response.status}`);
  const text = outputText(await response.json())
    .replace(/^```(?:json)?\s*|\s*```$/g, "")
    .trim();
  const parsed = JSON.parse(text) as Partial<ProductIdentityEvaluation>;
  const ratio = Number(parsed.estimatedProductAreaRatio);
  const bounds = parsed.productBounds;
  const validBounds = bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every((value) => Number.isFinite(value));
  return {
    score: clamp(parsed.score, 55),
    productVisible: parsed.productVisible !== false,
    severeDistortion: parsed.severeDistortion === true,
    textArtifactDetected: parsed.textArtifactDetected === true,
    brandMismatch: parsed.brandMismatch === true,
    humanArtifactDetected: parsed.humanArtifactDetected === true,
    groundingMismatch: parsed.groundingMismatch === true,
    estimatedProductAreaRatio: Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : undefined,
    productBounds: validBounds
      ? {
          x: Math.max(0, Math.min(1199, Math.round(bounds.x))),
          y: Math.max(0, Math.min(1199, Math.round(bounds.y))),
          width: Math.max(1, Math.min(1200, Math.round(bounds.width))),
          height: Math.max(1, Math.min(1200, Math.round(bounds.height))),
        }
      : undefined,
    findings: Array.isArray(parsed.findings) ? parsed.findings.map(String).filter(Boolean).slice(0, 8) : [],
    method: "vision" as const,
  };
}

export async function evaluateProductIdentity(input: { profile: ProductReferenceProfile; candidate: Buffer; generationMode: MasterSceneGenerationMode }): Promise<ProductIdentityEvaluation> {
  if (input.generationMode === "protected-product-composite" || input.generationMode === "real-photo-adaptation" || input.generationMode === "library-fallback") {
    return {
      score: 100,
      productVisible: true,
      severeDistortion: false,
      textArtifactDetected: false,
      brandMismatch: false,
      humanArtifactDetected: false,
      groundingMismatch: false,
      findings: [input.generationMode === "real-photo-adaptation" ? "검증된 실제 상품 사진 전체를 유지한 실사 광고 장면" : "검증된 실제 상품 픽셀을 유지한 보호 합성"],
      method: "protected-original",
    };
  }
  const canUseVision = Boolean(process.env.OPENAI_API_KEY) && String(process.env.ADATLAS_SCENE_IDENTITY_VISION_ENABLED || "true").toLowerCase() === "true";
  if (canUseVision) {
    try {
      const evaluated = await visionIdentityEvaluation(input);
      if (evaluated) return evaluated;
    } catch {
      // The scene remains usable for manual review or protected-product fallback.
    }
  }
  return {
    score: input.profile.referenceSufficiency === "high" ? 68 : input.profile.referenceSufficiency === "medium" ? 58 : 42,
    productVisible: true,
    severeDistortion: false,
    textArtifactDetected: false,
    brandMismatch: false,
    humanArtifactDetected: false,
    groundingMismatch: false,
    findings: ["자동 시각 동일성 검사를 완료하지 못해 실제 상품 사진과의 확인이 필요함"],
    method: "conservative-local",
  };
}
