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
  firstLineHook: "",
  copyStructure: "",
  toneOfVoice: "",
  trendElements: "",
  consumerInsight: "",
  purchaseTrigger: "",
  reusableCopyPattern: "",
  visualCopyRelation: "",
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
    copyNuance: "OCR 문구가 질문형으로 불편을 먼저 찌른 뒤 해결책을 붙이는 구조입니다. 딱딱한 브랜드체가 아니라 소비자가 속으로 할 법한 말을 꺼내는 구어체라, 상품 설명 전에 '내 얘기 같다'는 반응을 만들도록 설계된 말투입니다.",
    visualTone: "상품과 핵심 문구가 먼저 보이는 선명한 커머스형 비주얼",
    layoutPattern: "상단에 문제/후킹 문구를 두고 중앙에 상품, 하단에 혜택이나 CTA를 배치하는 구조",
    whyItWorks: `${brand} 광고처럼 보이는 이미지에서 소비자의 불편을 먼저 건드리면, 상품 설명보다 구매 이유가 먼저 생깁니다.`,
    recommendedUse: "일상 불편 해결, 선물 명분, 즉시 혜택을 강조해야 하는 상품에 응용하기 좋습니다.",
    firstLineHook: "첫 문장에서 소비자가 이미 겪는 불편을 질문형으로 찔러 시선을 붙잡는 구조입니다.",
    copyStructure: "문제 제기 → 해결 명분 → 구매 행동으로 이어지는 퍼포먼스 광고형 문장 구조입니다.",
    toneOfVoice: "친구가 추천하듯 말하지만, 혜택과 이유는 분명하게 짚는 구어체입니다.",
    trendElements: "특별한 밈 표현 없음",
    consumerInsight: "소비자가 상품 설명보다 지금 자신의 불편을 먼저 알아봐 주길 기대한다는 심리를 건드립니다.",
    purchaseTrigger: "불편을 계속 두면 손해라는 느낌을 만들어 즉시 확인할 이유를 만듭니다.",
    reusableCopyPattern: "'아직도 OO 없이 버텼다고?'처럼 문제를 먼저 던지고 해결책을 붙이는 패턴으로 재사용할 수 있습니다.",
    visualCopyRelation: "상품과 핵심 문구가 함께 보이도록 배치해 문제와 해결책을 한 화면에서 연결합니다.",
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

function enrichCopyNuance(value: Partial<AdImageAnalysisDraft>) {
  const copyNuance = String(value.copyNuance ?? "").trim();
  const ocrText = String(value.ocrText ?? "").trim();
  const trendElements = String(value.trendElements ?? "").trim();
  const trendSource = `${ocrText} ${trendElements}`;
  const hasBrokenMeme = /나와버[ㄹ림]?|버ㄹ|ㄹ\.\.|[가-힣]+코어|야호|POV|pov/.test(trendSource);
  const isTooGeneric =
    !copyNuance ||
    /^(친근함|유쾌함|고급스러움|감성적|직관적|깔끔함|재미있음|귀여움|신뢰감|호기심|공감|친근하고 유쾌함)[\s/·,]*$/i.test(copyNuance) ||
    copyNuance.length < 16;

  if (!isTooGeneric && !hasBrokenMeme) return copyNuance;

  const firstLineHook = String(value.firstLineHook ?? "").trim();
  const copyStructure = String(value.copyStructure ?? "").trim();
  const toneOfVoice = String(value.toneOfVoice ?? "").trim();
  const targetEmotion = String(value.targetEmotion ?? "").trim();

  if (hasBrokenMeme) {
    return [
      "일부러 말을 끊은 듯한 SNS 밈 문법입니다.",
      /나와버[ㄹ림]?|버ㄹ|ㄹ\.\./.test(trendSource) ? `"나와버ㄹ.."처럼 완성되지 않은 표현으로 다음 말을 궁금하게 만들고, 광고 문장보다 친구가 올린 게시글 같은 미완성 말맛을 냅니다.` : "",
      /[가-힣]+코어/.test(trendSource) ? `"~코어" 표현을 상품 콘셉트에 붙여 요즘 유행하는 취향/무드 태그처럼 보이게 합니다.` : "",
      /야호/.test(trendSource) ? `"야호" 같은 감탄을 넣어 득템감과 가벼운 흥분을 만듭니다.` : "",
      /POV|pov/.test(trendSource) ? `"POV" 문법으로 소비자가 그 상황의 주인공이 된 것처럼 상상하게 만듭니다.` : "",
      firstLineHook || copyStructure || "가격/상황 후킹을 먼저 던진 뒤 상품 키워드로 장난스럽게 받는 구조입니다.",
    ].filter(Boolean).join(" ");
  }

  return [
    ocrText ? `OCR의 실제 표현("${ocrText.split(/\n/)[0].slice(0, 40)}")을 기준으로,` : "OCR 문구를 기준으로,",
    firstLineHook || copyStructure || "첫 문장에서 시선을 잡고 다음 문장으로 구매 이유를 붙이는 구조입니다.",
    toneOfVoice ? `말투는 ${toneOfVoice}` : "말투는 단순 브랜드 설명보다 소비자 입말에 가깝습니다.",
    trendElements && !/특별한 밈 표현 없음/.test(trendElements) ? `밈/유행어 요소는 ${trendElements}입니다.` : "",
    targetEmotion ? `유도 감정은 ${targetEmotion}입니다.` : "",
  ].filter(Boolean).join(" ");
}

function normalizeDraft(value: Partial<AdImageAnalysisDraft>, fallbackCategory: string): AdImageAnalysisDraft {
  return {
    ocrText: String(value.ocrText ?? ""),
    category: pickOption(value.category, categoryOptions, fallbackCategory || "기타"),
    hookType: pickOption(value.hookType, hookTypeOptions, String(value.hookType ?? "")),
    appealPoint: pickOption(value.appealPoint, appealPointOptions, String(value.appealPoint ?? "")),
    targetEmotion: String(value.targetEmotion ?? ""),
    copyNuance: enrichCopyNuance(value),
    visualTone: String(value.visualTone ?? ""),
    layoutPattern: String(value.layoutPattern ?? ""),
    whyItWorks: String(value.whyItWorks ?? ""),
    recommendedUse: String(value.recommendedUse ?? ""),
    firstLineHook: String(value.firstLineHook ?? ""),
    copyStructure: String(value.copyStructure ?? ""),
    toneOfVoice: String(value.toneOfVoice ?? ""),
    trendElements: String(value.trendElements ?? ""),
    consumerInsight: String(value.consumerInsight ?? ""),
    purchaseTrigger: String(value.purchaseTrigger ?? ""),
    reusableCopyPattern: String(value.reusableCopyPattern ?? ""),
    visualCopyRelation: String(value.visualCopyRelation ?? ""),
  };
}

function analysisPrompt(input: { brandName: string; category: string }) {
  return `
브랜드명: ${input.brandName || "optional"}
현재 카테고리 후보: ${input.category || "기타"}

너는 한국 이커머스 퍼포먼스 광고를 분석하는 시니어 크리에이티브 전략가다.
이미지를 예쁘게 설명하지 말고, OCR 문구의 실제 카피 문법, 말투, 후킹 구조, 밈성, 감정 자극 방식, 구매 명분, 비주얼과 카피의 연결을 분석한다.
분석 결과는 이후 광고문구 생성 API가 바로 재사용할 수 있을 정도로 구체적이어야 한다.

category는 반드시 아래 중 하나로 고른다:
${categoryOptions.join(", ")}

hookType은 반드시 아래 중 하나로 고른다:
${hookTypeOptions.join(", ")}

appealPoint는 반드시 아래 중 하나로 고른다:
${appealPointOptions.join(", ")}

반드시 분석할 것:
- OCR 원문은 보이는 대로 최대한 보존한다. 줄바꿈, 말줄임표, 일부러 어색한 표현, 밈 표현을 자연스럽게 고치지 않는다.
- 첫 문장이 감탄형, 질문형, 일상말형, 경고형, 반전형, 가격충격형, 문제제기형, 공감형, 후기형, 밈/UGC형, 선물명분형 중 어디에 가까운지 설명한다.
- copyNuance는 "친근함", "유쾌함", "고급스러움" 같은 추상 단어만 쓰지 않는다. 반드시 OCR 문구의 실제 말투, 문장 구조, 밈성/유행어, 말줄임/끊긴 표기, 감탄/질문/반말 여부, 감정 유도 방식을 함께 설명한다.
- copyNuance는 이후 광고문구 생성에서 바로 참조할 수 있게 쓴다. 예: "나와버ㄹ.."처럼 말을 일부러 끊어 SNS 게시글처럼 보이게 하고, "야호" 감탄으로 가벼운 득템감을 만든다. 첫 문장은 가격 충격을 던지고 다음 문장은 상품 키워드로 장난스럽게 받는 구조다.
- 좋은 copyNuance 예시: 일부러 말을 끊은 듯한 SNS 밈 문법. "나와버ㄹ.."처럼 완성되지 않은 표현으로 궁금증을 만들고, "토마토코어"처럼 요즘 유행하는 ~코어 표현을 상품 콘셉트에 붙여 가볍고 재밌게 후킹한다.
- OCR에 "야호", "~코어", "POV", "나와버ㄹ..", "저장각", "장바구니각"이 보이면 copyNuance에 반드시 그 표현이 어떤 말맛과 감정 반응을 만드는지 적는다.
- copyStructure에는 문장이 어떤 순서로 설득하는지 쓴다. 예: 문제 제기 → 해결, 가격 충격 → 납득 명분, 일상 상황 → 상품 필요성, 후기 반응 → 구매 명분.
- toneOfVoice에는 반말/존댓말, 친구 추천체, 후기체, 브랜드체, 고급 선물체, SNS 게시글체, 광고체 여부를 구체적으로 쓴다.
- trendElements에는 실제로 보이는 밈/유행어/SNS 표현만 쓴다. 없으면 "특별한 밈 표현 없음"이라고 쓴다.
- consumerInsight에는 소비자의 숨은 불편, 체면, 귀찮음, 손해 회피, 저장 욕구, 선물 부담, 자기관리 욕구 등을 구체적으로 쓴다.
- purchaseTrigger에는 소비자가 왜 클릭하거나 구매하고 싶어지는지 직접적인 방아쇠를 쓴다.
- reusableCopyPattern에는 다른 상품에 옮겨 쓸 수 있는 문장 골격을 OO/XX 형태로 설명한다.
- visualCopyRelation에는 이미지 속 상품/인물/레이아웃/강조 박스와 문구가 어떻게 서로 설득력을 만드는지 쓴다.
- whyItWorks는 "호기심을 유도한다" 같은 일반론을 피하고, OCR 문구와 비주얼 요소가 어떤 클릭 욕구를 만드는지 최소 2문장으로 쓴다.
- recommendedUse는 어떤 카테고리/상품/상황에 이 카피 패턴을 응용할 수 있는지 구체적으로 쓴다.

반환은 반드시 아래 JSON 구조만 사용한다. 설명 문장, 마크다운, 코드블록은 쓰지 않는다.
copyNuance에는 단순 톤명이 아니라 "OCR 말투 + 문장 구조 + 밈/유행어 여부 + 감정 유도 방식"을 2문장 이상으로 적는다.
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
  "recommendedUse": "",
  "firstLineHook": "",
  "copyStructure": "",
  "toneOfVoice": "",
  "trendElements": "",
  "consumerInsight": "",
  "purchaseTrigger": "",
  "reusableCopyPattern": "",
  "visualCopyRelation": ""
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
