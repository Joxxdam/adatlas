import type { CreativeStrategy, ProductInfoForPrompt } from "../mvp/types";
import type {
  AdvertiserProfile,
  ProductSafeZone,
  SceneProfile,
  ScenePromptPlan,
  TextSafeZone,
  VisualArchetype,
} from "./types";

function zonesForArchetype(archetypeId: string): {
  product: ProductSafeZone;
  text: TextSafeZone[];
} {
  if (["problem-solution", "community-review", "lifestyle-context"].includes(archetypeId)) {
    return {
      product: { position: "right-center", widthRatio: 0.42, heightRatio: 0.62 },
      text: [
        { position: "upper-left", widthRatio: 0.5, heightRatio: 0.34, contrastRequirement: "quiet, high-contrast surface with low detail" },
        { position: "bottom-left", widthRatio: 0.48, heightRatio: 0.16, contrastRequirement: "dark or light strip-ready field" },
      ],
    };
  }
  if (["price-event", "numeric-proof", "three-benefits"].includes(archetypeId)) {
    return {
      product: { position: "center", widthRatio: 0.58, heightRatio: 0.52 },
      text: [
        { position: "top", widthRatio: 0.92, heightRatio: 0.25, contrastRequirement: "even low-detail field for a two-line headline" },
        { position: "bottom", widthRatio: 0.92, heightRatio: 0.2, contrastRequirement: "offer strip or price-card ready field" },
      ],
    };
  }
  return {
    product: { position: "center-right", widthRatio: 0.5, heightRatio: 0.62 },
    text: [
      { position: "upper-left", widthRatio: 0.48, heightRatio: 0.34, contrastRequirement: "calm field with clear contrast" },
      { position: "bottom-left", widthRatio: 0.46, heightRatio: 0.14, contrastRequirement: "CTA-ready negative space" },
    ],
  };
}

function categoryObjectPolicy(profileId: string, category: string) {
  if (profileId.startsWith("food-meat")) {
    return [
      "This is an EMPTY food photography set that will receive a real meat product later.",
      "Do not show raw meat, cooked meat, steak, barbecue, a plated dish, food portions, packaging, or any edible hero object anywhere in the frame.",
      "A clean unoccupied grill, table, board, restrained smoke, warm light, and peripheral tools are allowed only as environmental context.",
    ];
  }
  if (profileId.startsWith("agriculture")) {
    return [
      "This is an EMPTY agricultural commerce set that will receive the real produce later.",
      "Do not show fruit, vegetables, crops, harvested produce, produce piles, filled baskets, packages, or a substitute product anywhere in the frame.",
      "Empty crates, clean packing paper, leaves, farm light, and an unoccupied table are allowed only as environmental context.",
    ];
  }
  if (profileId.startsWith("personal-care")) {
    return [
      "This is an EMPTY personal-care advertising set that will receive the real product later.",
      "Do not show bottles, tubes, jars, pumps, packages, cosmetic containers, a person holding a product, or any substitute hero object anywhere in the frame.",
      "Water, mist, tile, acrylic, towels, and restrained ingredient cues are allowed only as environmental context.",
    ];
  }
  return [
    `This is an EMPTY commercial set for a ${category} product that will be composited later.`,
    "Do not show the sold product category, a substitute product, packaging, containers, or a hero object anywhere in the frame.",
  ];
}

export function buildScenePrompt(params: {
  profile: SceneProfile;
  archetype: VisualArchetype;
  product: ProductInfoForPrompt;
  advertiserProfile: AdvertiserProfile;
  strategy?: CreativeStrategy | null;
  variation?: number;
}): ScenePromptPlan {
  const baseZones = zonesForArchetype(params.archetype.id);
  const zones = {
    product: {
      ...baseZones.product,
      position: params.strategy?.productPosition || baseZones.product.position,
    },
    text: baseZones.text.map((zone, index) =>
      index === 0 && params.strategy?.textSafeArea
        ? { ...zone, position: params.strategy.textSafeArea }
        : zone
    ),
  };
  const variation = params.variation || 0;
  const environment = [
    params.profile.environment[variation % params.profile.environment.length],
    ...params.profile.environment.filter((_, index) => index !== variation % params.profile.environment.length).slice(0, 1),
  ];
  const props = (params.profile.props || []).slice(variation % 2, variation % 2 + 3);
  const prohibitedElements = Array.from(
    new Set([
      ...params.profile.negativePromptRules,
      ...(params.advertiserProfile.prohibitedVisuals || []),
      "readable Korean or English text",
      "letters, numbers, captions, logos, labels, price tags and watermarks",
      "a newly generated hero product, package or container",
      "transparent background, alpha holes, black voids or missing pixels",
      "an isolated cutout, product mockup or floating object",
    ])
  );
  const productCategory = params.product.category || "commerce product";
  const categoryPolicy = categoryObjectPolicy(params.profile.id, productCategory);
  const hookScene = params.strategy?.sceneDescription;
  const hookMood = params.strategy?.mood || [];
  const hookBackgroundTags = params.strategy?.backgroundTags || [];
  const prompt = [
    "Create a high-end, photorealistic commercial photography SET PLATE for a 1200x1200 square Korean performance ad.",
    "The output must be a complete edge-to-edge OPAQUE scene. Render every pixel. Never use transparency, alpha, a cutout, a black void, or a missing-background area.",
    ...categoryPolicy,
    hookScene ? `Selected ad hook scene: ${hookScene}.` : "",
    hookMood.length ? `Selected hook mood: ${hookMood.join(", ")}.` : "",
    hookBackgroundTags.length
      ? `Background cues to interpret without adding a product: ${hookBackgroundTags.join(", ")}.`
      : "",
    `Scene profile: ${params.profile.label}. Environment: ${environment.join(", ")}.`,
    `Mood: ${params.profile.visualMood.join(", ")}. Lighting: ${params.profile.lighting.join(", ")}.`,
    props.length ? `Supporting props, kept subtle and peripheral: ${props.join(", ")}.` : "Keep supporting props restrained.",
    `Color direction: ${(params.profile.colorHints || params.advertiserProfile.preferredColorHints || []).join(", ")}.`,
    `Composition archetype: ${params.archetype.name}. ${params.profile.compositionRules.join(". ")}.`,
    `Keep a LOW-DETAIL, FULLY RENDERED product placement area at ${zones.product.position}, approximately ${Math.round(zones.product.widthRatio * 100)}% canvas width by ${Math.round(zones.product.heightRatio * 100)}% canvas height. This area must continue the same floor, table, wall, light, and perspective as the rest of the scene. It is not empty, transparent, black, white, masked, boxed, or cut out. Include a believable ground/contact-shadow surface for a real product layer that will be composited later.`,
    `Keep fully rendered text-safe areas with restrained detail: ${zones.text.map((zone) => `${zone.position} ${Math.round(zone.widthRatio * 100)}%x${Math.round(zone.heightRatio * 100)}%, ${zone.contrastRequirement}`).join("; ")}. These areas must remain part of the same continuous photographic environment.`,
    "Use realistic depth, coherent perspective, natural material detail, one directional key light, soft fill, and enough advertising density around the safe areas. The result should look like a finished commercial location photograph before the real product and typography are composited.",
    "FINAL CHECK: full-frame opaque square scene, no product, no package, no substitute product, no readable text, no typography, no letters, no numbers, no price, no logos, no watermark, no UI, no price card, and no CTA. Preserve clean empty safe zones for the real product and ad text, with coherent light and believable contact shadow support.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    profileId: params.profile.id,
    sceneType: params.profile.label,
    visualMood: params.profile.visualMood,
    environment,
    lighting: params.profile.lighting,
    props,
    colorHints: params.profile.colorHints || params.advertiserProfile.preferredColorHints || [],
    productSafeZone: zones.product,
    textSafeZones: zones.text,
    depthPlan: {
      foreground: ["clear grounding plane", "subtle peripheral texture only"],
      midground: ["continuous low-detail product placement surface", ...props.slice(0, 1)],
      background: environment,
    },
    prohibitedElements,
    prompt,
    negativePrompt: prohibitedElements.join(", "),
    reason: `${params.advertiserProfile.name}의 상품군과 선택한 ${params.strategy?.title || params.archetype.name} 후킹에 맞춰 실제 상품과 한글 카피가 들어갈 자리를 먼저 비운 장면입니다.`,
  };
}
