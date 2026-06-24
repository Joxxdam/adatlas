import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { AdImageAnalysisDraft } from "../../../lib/mvp/types";

export const runtime = "nodejs";

const emptyDraft: AdImageAnalysisDraft = {
  ocrText: "",
  category: "",
  hookType: "",
  appealPoint: "",
  targetEmotion: "",
  copyNuance: "",
  visualTone: "",
  layoutPattern: "",
  whyItWorks: "",
  recommendedUse: "",
};

const categoryOptions = ["식품/선물", "뷰티/스킨케어", "패션/의류", "생활용품", "건강기능식품", "디지털/앱", "인테리어/리빙", "기타"];
const hookTypeOptions = [
  "가격정당화형",
  "가격소구형",
  "문제제기형",
  "공감형",
  "후기/리뷰형",
  "UGC형",
  "비포애프터형",
  "전문가/권위형",
  "선물명분형",
  "긴급/한정형",
  "반전/궁금증형",
  "상황제안형",
];
const appealPointOptions = [
  "가성비",
  "선물명분",
  "고급감",
  "실속",
  "불편해소",
  "체형보완",
  "성분/효능",
  "시간절약",
  "후기신뢰",
  "희소성",
  "즉시혜택",
  "자기관리",
  "사회적 인정",
];

function mockDraft(brandName: string, category: string): AdImageAnalysisDraft {
  const brand = brandName || "브랜드 미상";
  const recommendedCategory = category && category !== "unknown" ? category : "기타";

  return {
    ocrText: "",
    category: recommendedCategory,
    hookType: "문제제기형",
    appealPoint: "불편해소",
    targetEmotion: "지금 겪는 불편을 빠르게 해결하고 싶은 마음",
    copyNuance: "문제를 먼저 짚고 상품을 자연스러운 해결책으로 제안하는 톤",
    visualTone: "상품과 핵심 문구가 먼저 보이는 선명한 커머스형 비주얼",
    layoutPattern: "상단에 문제/후킹 문구를 두고 중앙에 상품, 하단에 혜택이나 CTA를 배치하는 구조",
    whyItWorks: `${brand} 광고처럼 보이는 이미지에서 소비자의 불편을 먼저 건드리면, 상품 설명보다 구매 이유가 먼저 생깁니다.`,
    recommendedUse: "일상 불편 해결, 선물 명분, 즉시 혜택을 강조해야 하는 상품에 응용하기 좋습니다.",
  };
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function contentTypeFromPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

async function imageInputUrl(imagePathOrUrl: string) {
  if (isHttpUrl(imagePathOrUrl)) return imagePathOrUrl;

  const publicRelativePath = imagePathOrUrl.replace(/^\/+/, "");
  const filePath = path.join(process.cwd(), "public", publicRelativePath);
  const buffer = await fs.readFile(filePath);
  return `data:${contentTypeFromPath(filePath)};base64,${buffer.toString("base64")}`;
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const source = fenced ?? text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  return JSON.parse(source) as Partial<AdImageAnalysisDraft>;
}

function pickOption(value: unknown, options: string[], fallback: string) {
  const text = String(value ?? "").trim();
  return options.includes(text) ? text : fallback;
}

function normalizeDraft(value: Partial<AdImageAnalysisDraft>, fallbackCategory: string): AdImageAnalysisDraft {
  return {
    ocrText: String(value.ocrText ?? ""),
    category: pickOption(value.category, categoryOptions, fallbackCategory || "기타"),
    hookType: pickOption(value.hookType, hookTypeOptions, String(value.hookType ?? "")),
    appealPoint: pickOption(value.appealPoint, appealPointOptions, String(value.appealPoint ?? "")),
    targetEmotion: String(value.targetEmotion ?? ""),
    copyNuance: String(value.copyNuance ?? ""),
    visualTone: String(value.visualTone ?? ""),
    layoutPattern: String(value.layoutPattern ?? ""),
    whyItWorks: String(value.whyItWorks ?? ""),
    recommendedUse: String(value.recommendedUse ?? ""),
  };
}

function analysisPrompt(input: { brandName: string; category: string }) {
  return `
브랜드명: ${input.brandName || "optional"}
현재 카테고리 후보: ${input.category || "기타"}

너는 한국 이커머스 퍼포먼스 마케터다.
첨부된 광고 이미지를 브랜드가 아니라 카테고리, 후킹 유형, 소구점 기준으로 라벨링한다.

category는 반드시 아래 중 하나로 고른다:
${categoryOptions.join(", ")}

hookType은 반드시 아래 중 하나로 고른다:
${hookTypeOptions.join(", ")}

appealPoint는 반드시 아래 중 하나로 고른다:
${appealPointOptions.join(", ")}

반드시 분석할 것:
- 이미지 안의 문구를 OCR 관점으로 추출한다.
- 첫눈에 시선을 잡는 후킹 방식이 무엇인지 판단한다.
- 핵심 소구점이 무엇인지 판단한다.
- 소비자가 느끼도록 설계된 감정을 짚는다.
- 카피의 말투와 뉘앙스를 분석한다.
- 비주얼 톤과 레이아웃 구조를 분석한다.
- 왜 이 광고가 클릭/구매 전환에 먹힐 수 있는지 마케터 관점으로 설명한다.
- 어떤 상품/상황에 응용하기 좋은지 제안한다.

반환은 반드시 아래 JSON 구조만 사용한다. 설명 문장, 마크다운, 코드블록은 쓰지 않는다.
{
  "ocrText": "",
  "category": "",
  "hookType": "",
  "appealPoint": "",
  "targetEmotion": "",
  "copyNuance": "",
  "visualTone": "",
  "layoutPattern": "",
  "whyItWorks": "",
  "recommendedUse": ""
}
`;
}

function openAiStatusMessage(status: number) {
  if (status === 401) return "OpenAI API 키가 유효하지 않습니다. .env.local의 OPENAI_API_KEY를 확인해주세요.";
  if (status === 403) return "OpenAI API 권한이 거부되었습니다. API 키의 프로젝트 권한을 확인해주세요.";
  if (status === 429) return "OpenAI 사용량 한도 또는 요청 제한에 걸렸습니다. 결제 상태, 크레딧, rate limit을 확인해주세요.";
  if (status >= 500) return "OpenAI 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
  return `OpenAI Vision 분석 실패: HTTP ${status}`;
}

async function analyzeWithOpenAI(input: { imagePathOrUrl: string; brandName: string; category: string }) {
  const imageUrl = await imageInputUrl(input.imagePathOrUrl);
  let response: Response;

  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: analysisPrompt(input) },
              { type: "input_image", image_url: imageUrl },
            ],
          },
        ],
        text: { format: { type: "json_object" } },
      }),
    });
  } catch {
    throw new Error("OpenAI 서버에 연결할 수 없습니다. dev 서버의 네트워크 권한, VPN, 방화벽 상태를 확인해주세요.");
  }

  if (!response.ok) {
    throw new Error(openAiStatusMessage(response.status));
  }

  const result = await response.json();
  const text =
    result.output_text ??
    result.output?.flatMap((item: { content?: { text?: string }[] }) => item.content ?? []).map((item: { text?: string }) => item.text ?? "").join("\n") ??
    "";

  return normalizeDraft(extractJson(text), input.category);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const imagePathOrUrl = String(body.localImagePath || body.imageUrl || "").trim();
    const brandName = String(body.brandName ?? "").trim();
    const category = String(body.category ?? "").trim();
    const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);

    if (!imagePathOrUrl) {
      return NextResponse.json({ ok: false, error: "이미지 경로 또는 이미지 URL이 필요합니다." }, { status: 400 });
    }

    const draft = hasOpenAiKey
      ? await analyzeWithOpenAI({ imagePathOrUrl, brandName, category })
      : mockDraft(brandName, category);

    return NextResponse.json({ ok: true, draft: { ...emptyDraft, ...draft }, isMock: !hasOpenAiKey });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "광고 이미지 분석 실패" },
      { status: 500 },
    );
  }
}
