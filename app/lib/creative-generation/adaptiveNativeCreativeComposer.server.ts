import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { removeBackgroundToPng } from "../mvp/imageEffects.ts";
import { creativeFontRegistry, embeddedFontFace } from "./creativeFontRegistry.server.ts";
import { assertCreativeCopyAllowed } from "./bannedCreativePhrases.ts";
import { buildAdaptiveLayoutPlan } from "./referenceCreativeGrammar.ts";
import type { AdaptiveLayoutPlan, GenerationJob, GenerationResult, PlacementBox } from "./types.ts";

export const ADAPTIVE_NATIVE_COMPOSER_VERSION = "adaptive-native-composer-v2-measured";

const paletteMap: Record<string,{ink:string;accent:string;surface:string;secondary:string;inverse:string}> = {
  "signal-red":{ink:"#111111",accent:"#f01818",surface:"#fff4ec",secondary:"#ffd900",inverse:"#ffffff"},
  "mono-teal":{ink:"#07191f",accent:"#19e7bf",surface:"#eefdf9",secondary:"#ff4b35",inverse:"#ffffff"},
  "fresh-citrus":{ink:"#17340d",accent:"#eaff24",surface:"#fbffe5",secondary:"#ff8a00",inverse:"#ffffff"},
  "cool-mint":{ink:"#061d2a",accent:"#19e7d0",surface:"#ecfbff",secondary:"#0b5796",inverse:"#ffffff"},
  "food-heat":{ink:"#211000",accent:"#ffce00",surface:"#fff1dc",secondary:"#f23316",inverse:"#ffffff"},
  "lifestyle-dark":{ink:"#ffffff",accent:"#20e2bf",surface:"#101319",secondary:"#ff4738",inverse:"#080b10"},
  "natural-paper":{ink:"#221a14",accent:"#e2ba62",surface:"#f6ecdc",secondary:"#68853d",inverse:"#ffffff"},
  "sale-yellow":{ink:"#111111",accent:"#ffdf00",surface:"#fff9d9",secondary:"#ec1717",inverse:"#ffffff"},
  "ugc-black":{ink:"#ffffff",accent:"#26edbd",surface:"#111111",secondary:"#ff4c3b",inverse:"#080808"},
  "clean-proof":{ink:"#102030",accent:"#21d4af",surface:"#f5f7f8",secondary:"#2171d1",inverse:"#ffffff"},
  "season-bright":{ink:"#1e1410",accent:"#ffcd00",surface:"#fff1de",secondary:"#ff512e",inverse:"#ffffff"},
  "premium-ink":{ink:"#f9f2e5",accent:"#d8b76b",surface:"#12151b",secondary:"#815f34",inverse:"#080a0f"},
};

function escapeXml(value:string) {
  return value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}

function textSignature(value:string) {
  return value.normalize("NFKC").replace(/\s+/g,"");
}

function relativeLuminance(hex:string) {
  const value = hex.replace("#","");
  const channels = [0,2,4].map((offset) => {
    const raw = Number.parseInt(value.slice(offset,offset+2),16)/255;
    return raw <= .03928 ? raw/12.92 : ((raw+.055)/1.055)**2.4;
  });
  return channels[0]*.2126 + channels[1]*.7152 + channels[2]*.0722;
}

function contrastRatio(foreground:string, background:string) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first,second)+.05)/(Math.min(first,second)+.05);
}

const measurementCache = new Map<string,Promise<number>>();
async function measuredTextWidth(value:string, fontSize:number, family:string, fontFace:string, weight=800) {
  const key = `${family}:${fontSize}:${weight}:${value}`;
  const cached = measurementCache.get(key);
  if (cached) return cached;
  const pending = (async () => {
    if (!value) return 0;
    const svg = Buffer.from(`<svg width="2400" height="260" xmlns="http://www.w3.org/2000/svg"><style>${fontFace}</style><text x="20" y="190" font-family="${family}" font-size="${fontSize}" font-weight="${weight}" fill="#fff">${escapeXml(value)}</text></svg>`);
    const probe = await sharp(svg).trim({background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
    return (await sharp(probe).metadata()).width || value.length * fontSize;
  })();
  measurementCache.set(key,pending);
  return pending;
}

async function wrapMeasured(value:string, maxWidth:number, maxLines:number, fontSize:number, family:string, fontFace:string, weight=800) {
  const words = value.replace(/\s+/g," ").trim().split(" ").filter(Boolean);
  const lines:string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (!line || await measuredTextWidth(next,fontSize,family,fontFace,weight) <= maxWidth) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const chars = Array.from(value.replace(/\s+/g," ").trim());
  const rebuilt:string[] = [];
  let current = "";
  for (const char of chars) {
    const next = current + char;
    if (!current || await measuredTextWidth(next,fontSize,family,fontFace,weight) <= maxWidth) current = next;
    else { rebuilt.push(current.trim()); current = char; }
  }
  if (current.trim()) rebuilt.push(current.trim());
  return rebuilt.slice(0,maxLines);
}

function overlap(a:PlacementBox,b:PlacementBox) {
  return !(a.x+a.width <= b.x || b.x+b.width <= a.x || a.y+a.height <= b.y || b.y+b.height <= a.y);
}

function copyBox(plan:AdaptiveLayoutPlan):PlacementBox {
  const map:Record<AdaptiveLayoutPlan["copyAnchor"],PlacementBox> = {
    "top-left":{x:64,y:54,width:plan.headlineMaxWidth,height:370},
    "top-center":{x:(1200-plan.headlineMaxWidth)/2,y:52,width:plan.headlineMaxWidth,height:350},
    "left-center":{x:58,y:250,width:plan.headlineMaxWidth,height:420},
    "bottom-left":{x:64,y:730,width:plan.headlineMaxWidth,height:390},
    "bottom-center":{x:(1200-plan.headlineMaxWidth)/2,y:765,width:plan.headlineMaxWidth,height:350},
  };
  return map[plan.copyAnchor];
}

function productRegion(plan:AdaptiveLayoutPlan):PlacementBox {
  const width = Math.round(1200 * plan.productScale * (plan.productCount === 1 ? 1 : plan.productCount === 2 ? 1.55 : 2.2));
  const height = Math.round(1200 * Math.min(.64,plan.productScale * 1.55));
  const map:Record<AdaptiveLayoutPlan["productAnchor"],{x:number;y:number}> = {
    left:{x:55,y:350}, center:{x:(1200-width)/2,y:330}, right:{x:1200-width-55,y:310},
    "bottom-left":{x:50,y:1200-height-45}, "bottom-right":{x:1200-width-50,y:1200-height-45},
  };
  return {...map[plan.productAnchor],width,height};
}

async function isolateProduct(file:string, transparent:boolean) {
  const source = await readFile(file);
  const metadata = await sharp(source).metadata();
  const hasAlpha = transparent || Boolean(metadata.hasAlpha);
  const isolated = hasAlpha ? source : await removeBackgroundToPng(source,{extractionScope:"sales-unit",featherRadius:.55});
  return sharp(isolated).rotate().ensureAlpha().trim({background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
}

async function createProductLayers(product:Buffer, plan:AdaptiveLayoutPlan, copy:PlacementBox) {
  let region = productRegion(plan);
  if (overlap(region,copy)) {
    region = {...region,width:Math.round(region.width*.82),height:Math.round(region.height*.82)};
    if (plan.productAnchor.includes("right") || plan.productAnchor === "right") region.x = 1200-region.width-36;
    if (plan.productAnchor.includes("left") || plan.productAnchor === "left") region.x = 36;
  }
  const gap = plan.productCount === 1 ? 0 : Math.round(region.width/(plan.productCount+2));
  const singleWidth = plan.productCount === 1 ? region.width : Math.round(region.width*.52);
  const layers:OverlayOptions[] = [];
  const bounds:PlacementBox[] = [];
  for (let index=0; index<plan.productCount; index += 1) {
    const rendered = await sharp(product)
      .rotate(plan.productRotation[index] || 0,{background:{r:0,g:0,b:0,alpha:0}})
      .resize(singleWidth,region.height,{fit:"contain",background:{r:0,g:0,b:0,alpha:0}})
      .sharpen({sigma:.45,m1:.4,m2:.9}).png().toBuffer();
    const metadata = await sharp(rendered).metadata();
    const width = metadata.width || singleWidth;
    const height = metadata.height || region.height;
    const left = Math.round(region.x + (plan.productCount === 1 ? (region.width-width)/2 : index*gap));
    const top = Math.round(region.y + (plan.productCount > 1 && index !== Math.floor(plan.productCount/2) ? 42 : 0));
    const shadow = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><filter id="b"><feGaussianBlur stdDeviation="14"/></filter></defs><ellipse cx="${width/2}" cy="${height-22}" rx="${width*.3}" ry="18" fill="#000" opacity=".32" filter="url(#b)"/></svg>`);
    layers.push({input:shadow,left,top},{input:rendered,left,top});
    bounds.push({x:left,y:top,width,height});
  }
  return {layers,bounds};
}

function contrastOverlay(plan:AdaptiveLayoutPlan, box:PlacementBox, palette:(typeof paletteMap)[string]) {
  const radius = plan.contrastSurface === "paper" ? 24 : 0;
  if (plan.contrastSurface === "none") return Buffer.from(`<svg width="1200" height="1200" xmlns="http://www.w3.org/2000/svg"/>`);
  if (plan.contrastSurface === "gradient") {
    const horizontal = plan.textAlign === "left";
    return Buffer.from(`<svg width="1200" height="1200" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" ${horizontal?'x1="0" x2="1"':'y1="0" y2="1"'}><stop offset="0" stop-color="${palette.surface}" stop-opacity=".96"/><stop offset=".62" stop-color="${palette.surface}" stop-opacity=".54"/><stop offset="1" stop-color="${palette.surface}" stop-opacity="0"/></linearGradient></defs><rect width="1200" height="1200" fill="url(#g)"/></svg>`);
  }
  return Buffer.from(`<svg width="1200" height="1200" xmlns="http://www.w3.org/2000/svg"><rect x="${box.x-28}" y="${box.y-24}" width="${box.width+56}" height="${box.height+48}" rx="${radius}" fill="${palette.surface}" opacity=".92"/></svg>`);
}

function motifMarkup(plan:AdaptiveLayoutPlan, box:PlacementBox, palette:(typeof paletteMap)[string]) {
  const x=box.x, y=box.y;
  switch(plan.graphicMotif) {
    case "marker": return `<path d="M ${x+8} ${y+210} Q ${x+box.width*.45} ${y+195} ${x+box.width-10} ${y+212}" stroke="${palette.accent}" stroke-width="24" opacity=".78" fill="none" stroke-linecap="round"/>`;
    case "speech": return `<path d="M ${x+box.width-95} ${y+6} q65 0 65 50 q0 42-54 45 l-20 28 3-31 q-43-8-43-42 q0-50 64-50z" fill="${palette.accent}" opacity=".9"/>`;
    case "circle": return `<ellipse cx="${x+box.width-78}" cy="${y+64}" rx="62" ry="48" fill="none" stroke="${palette.accent}" stroke-width="10" transform="rotate(-8 ${x+box.width-78} ${y+64})"/>`;
    case "arrow": return `<path d="M ${x+box.width-95} ${y+180} q55 45 18 106 m0 0 l-28-13 m28 13 l7-30" fill="none" stroke="${palette.accent}" stroke-width="9" stroke-linecap="round"/>`;
    case "label": return `<rect x="${x}" y="${y-12}" width="126" height="40" rx="20" fill="${palette.accent}"/>`;
    case "receipt": return `<path d="M ${x+box.width-170} ${y-12} h150 v120 l-15-10-15 10-15-10-15 10-15-10-15 10-15-10-15 10z" fill="${palette.surface}" stroke="${palette.accent}" stroke-width="5"/>`;
    default:return "";
  }
}

async function textOverlay(job:GenerationJob,result:GenerationResult,plan:AdaptiveLayoutPlan,box:PlacementBox) {
  const palette = paletteMap[plan.paletteId] || paletteMap["clean-proof"];
  const fontRole = plan.typographyRole === "editorial" ? "CLEAN_EDITORIAL" : plan.typographyRole === "display" ? "DISPLAY_BLACK" : plan.typographyRole === "handwritten" ? "HANDWRITTEN_MARKER" : "HEAVY_GOTHIC";
  const [face,bodyFace,handFace] = await Promise.all([embeddedFontFace(fontRole),embeddedFontFace("ROUNDED_BOLD"),embeddedFontFace("HANDWRITTEN_MARKER")]);
  const family = creativeFontRegistry[fontRole].family;
  const bodyFamily = creativeFontRegistry.ROUNDED_BOLD.family;
  const headline = result.hookPlan.headline.trim();
  const body = result.hookPlan.body.trim();
  const price = plan.priceEmphasis ? job.productTruth.normalized.price || "" : "";
  const cta = ["PRICE_VALUE","BUNDLE_LINEUP","SEASON_URGENCY"].includes(plan.grammarId)
    ? result.hookPlan.cta.trim()
    : "";
  assertCreativeCopyAllowed([headline,body,price,cta].join(" "));
  let mainSize = plan.typographyRole === "handwritten" ? 84 : plan.typographyRole === "editorial" ? 70 : 88;
  let headlineLines = await wrapMeasured(headline,plan.headlineMaxWidth,plan.headlineMaxLines,mainSize,family,face,900);
  while ((headlineLines.length > plan.headlineMaxLines || await Promise.all(headlineLines.map((line)=>measuredTextWidth(line,mainSize,family,face,900))).then((widths)=>Math.max(...widths,0)) > plan.headlineMaxWidth) && mainSize > 54) {
    mainSize -= 4;
    headlineLines = await wrapMeasured(headline,plan.headlineMaxWidth,plan.headlineMaxLines,mainSize,family,face,900);
  }
  const bodySize = 31;
  const bodyLines = await wrapMeasured(body,plan.subCopyMaxWidth,2,bodySize,bodyFamily,bodyFace,700);
  const headlineOverflow = textSignature(headlineLines.join(" ")) !== textSignature(headline);
  const bodyOverflow = textSignature(bodyLines.join(" ")) !== textSignature(body);
  const anchor = plan.textAlign === "center" ? "middle" : "start";
  const textX = plan.textAlign === "center" ? box.x+box.width/2 : box.x;
  const headlineY = box.y+mainSize;
  const lineHeight = mainSize*1.06;
  const bodyY = headlineY + headlineLines.length*lineHeight + 40;
  const priceY = bodyY + bodyLines.length*bodySize*1.24 + 46;
  const ctaY = Math.min(1130,price ? priceY+78 : bodyY+bodyLines.length*bodySize*1.24+58);
  const text = (lines:string[],y:number,size:number,color:string,bodyFont:string,weight:number) => `<text x="${textX}" y="${y}" text-anchor="${anchor}" fill="${color}" font-family="${bodyFont}" font-size="${size}" font-weight="${weight}" paint-order="stroke" stroke="${palette.surface}" stroke-opacity=".2" stroke-width="2">${lines.map((line,index)=>`<tspan x="${textX}" dy="${index?size*1.08:0}">${escapeXml(line)}</tspan>`).join("")}</text>`;
  const priceMarkup = price ? `<g><rect x="${plan.textAlign==="center"?textX-210:box.x}" y="${priceY-59}" width="420" height="76" rx="18" fill="${palette.accent}"/><text x="${plan.textAlign==="center"?textX:box.x+22}" y="${priceY}" text-anchor="${plan.textAlign==="center"?"middle":"start"}" fill="${palette.ink}" font-family="${family}" font-size="52" font-weight="900">${escapeXml(price)}</text></g>` : "";
  const ctaWidth = Math.min(340,Math.max(170,cta.length*27));
  const ctaMarkup = cta ? `<g><rect x="${plan.textAlign==="center"?textX-ctaWidth/2:box.x}" y="${ctaY-43}" width="${ctaWidth}" height="58" rx="29" fill="${palette.ink}" opacity=".92"/><text x="${plan.textAlign==="center"?textX:box.x+24}" y="${ctaY-3}" text-anchor="${plan.textAlign==="center"?"middle":"start"}" fill="${palette.inverse}" font-family="${bodyFamily}" font-size="24" font-weight="800">${escapeXml(cta)}  ›</text></g>` : "";
  const svg = `<svg width="1200" height="1200" xmlns="http://www.w3.org/2000/svg"><style>${face}${bodyFace}${handFace}</style>${motifMarkup(plan,box,palette)}${text(headlineLines,headlineY,mainSize,palette.ink,family,900)}${text(bodyLines,bodyY,bodySize,palette.ink,bodyFamily,700)}${priceMarkup}${ctaMarkup}${plan.typographyRole==="handwritten"?`<path d="M ${box.x+20} ${bodyY-18} q120 18 245 0" stroke="${palette.accent}" stroke-width="9" fill="none" stroke-linecap="round"/>`:""}</svg>`;
  const height = Math.min(box.height,ctaY-box.y+22);
  return {
    buffer:Buffer.from(svg),palette,
    textBounds:[{x:box.x,y:box.y,width:box.width,height}],
    exactText:{headline,body,price,cta},
    mainSize,headlineLines,bodyLines,headlineOverflow,bodyOverflow,
  };
}

export async function composeAdaptiveNativeCreative(input:{
  job:GenerationJob;
  result:GenerationResult;
  backgroundPath:string;
  productImagePath:string;
  productTransparent?:boolean;
  outputPath:string;
}) {
  const plan = buildAdaptiveLayoutPlan({truth:input.job.productTruth,result:input.result,groupResults:input.job.results});
  const copy = copyBox(plan);
  const [backgroundSource,product] = await Promise.all([readFile(input.backgroundPath),isolateProduct(input.productImagePath,Boolean(input.productTransparent))]);
  const background = await sharp(backgroundSource).rotate().resize(1200,1200,{fit:"cover",position:"attention"}).modulate({brightness:.98,saturation:1.03}).png().toBuffer();
  const productComposition = await createProductLayers(product,plan,copy);
  const copyComposition = await textOverlay(input.job,input.result,plan,copy);
  await mkdir(path.dirname(input.outputPath),{recursive:true});
  await sharp(background).composite([
    {input:contrastOverlay(plan,copy,copyComposition.palette),left:0,top:0},
    ...productComposition.layers,
    {input:copyComposition.buffer,left:0,top:0},
  ]).png().toFile(input.outputPath);
  const metadata = await sharp(input.outputPath).metadata();
  if (metadata.width !== 1200 || metadata.height !== 1200) throw new Error("동적 합성 결과가 1200×1200 규격이 아닙니다.");
  const diagnostic = {
    version:ADAPTIVE_NATIVE_COMPOSER_VERSION,
    creativeGrammarId:plan.grammarId,
    layoutPlan:plan,
    paletteId:plan.paletteId,
    productSource:input.productImagePath,
    productComposed:true,
    exactText:copyComposition.exactText,
    productBounds:productComposition.bounds,
    textBounds:copyComposition.textBounds,
    minHeadlineFontSize:copyComposition.mainSize,
    headlineLines:copyComposition.headlineLines,
    bodyLines:copyComposition.bodyLines,
    headlineOverflow:copyComposition.headlineOverflow,
    bodyOverflow:copyComposition.bodyOverflow,
    minTextContrastRatio:Math.min(
      contrastRatio(copyComposition.palette.ink,copyComposition.palette.surface),
      copyComposition.exactText.price ? contrastRatio(copyComposition.palette.ink,copyComposition.palette.accent) : Number.POSITIVE_INFINITY,
      copyComposition.exactText.cta ? contrastRatio(copyComposition.palette.inverse,copyComposition.palette.ink) : Number.POSITIVE_INFINITY,
    ),
  };
  await writeFile(`${input.outputPath}.composition.json`,`${JSON.stringify(diagnostic,null,2)}\n`,"utf8");
  return diagnostic;
}
