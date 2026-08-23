import sharp from "sharp";

export type LogoSurfaceTone = "light" | "dark";

type SurfaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function luminance(red: number, green: number, blue: number) {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function dataUrlBuffer(value: string) {
  const matched = String(value || "").match(/^data:image\/(?:png|jpe?g|webp|avif);base64,([a-z0-9+/=]+)$/i);
  return matched ? Buffer.from(matched[1], "base64") : null;
}

export async function detectLogoSurfaceTone(surfaceBuffer: Buffer | undefined, box?: SurfaceBox, fallback: LogoSurfaceTone = "light"): Promise<LogoSurfaceTone> {
  if (!surfaceBuffer?.length) return fallback;
  try {
    let image = sharp(surfaceBuffer).rotate().resize(1200, 1200, {
      fit: "cover",
      position: "centre",
    });
    if (box) {
      const left = Math.max(0, Math.min(1199, Math.round(box.x)));
      const top = Math.max(0, Math.min(1199, Math.round(box.y)));
      const width = Math.max(1, Math.min(1200 - left, Math.round(box.width)));
      const height = Math.max(1, Math.min(1200 - top, Math.round(box.height)));
      image = image.extract({ left, top, width, height });
    }
    const { channels } = await image.removeAlpha().stats();
    const red = channels[0]?.mean ?? 255;
    const green = channels[1]?.mean ?? red;
    const blue = channels[2]?.mean ?? red;
    return luminance(red, green, blue) < 145 ? "dark" : "light";
  } catch {
    return fallback;
  }
}

export async function normalizeTransparentLogo(logoBuffer: Buffer) {
  const source = sharp(logoBuffer).rotate().ensureAlpha();
  const { data, info } = await source.raw().toBuffer({ resolveWithObject: true });
  let transparentPixels = 0;
  for (let index = 3; index < data.length; index += info.channels) {
    if (data[index] <= 8) transparentPixels += 1;
  }

  // Preserve an existing alpha matte. For opaque uploads, only a consistent
  // border-connected background is removed so enclosed white logo details stay intact.
  if (transparentPixels < info.width * info.height * 0.01) {
    const corners = [0, (info.width - 1) * info.channels, (info.height - 1) * info.width * info.channels, ((info.height - 1) * info.width + info.width - 1) * info.channels];
    const key = corners.reduce(
      (color, offset) => {
        color.r += data[offset];
        color.g += data[offset + 1];
        color.b += data[offset + 2];
        return color;
      },
      { r: 0, g: 0, b: 0 }
    );
    key.r /= corners.length;
    key.g /= corners.length;
    key.b /= corners.length;
    const visited = new Uint8Array(info.width * info.height);
    const queue: number[] = [];
    const enqueue = (pixel: number) => {
      if (pixel < 0 || pixel >= visited.length || visited[pixel]) return;
      visited[pixel] = 1;
      queue.push(pixel);
    };
    for (let x = 0; x < info.width; x += 1) {
      enqueue(x);
      enqueue((info.height - 1) * info.width + x);
    }
    for (let y = 1; y < info.height - 1; y += 1) {
      enqueue(y * info.width);
      enqueue(y * info.width + info.width - 1);
    }
    let cursor = 0;
    while (cursor < queue.length) {
      const pixel = queue[cursor++];
      const offset = pixel * info.channels;
      const distance = Math.hypot(data[offset] - key.r, data[offset + 1] - key.g, data[offset + 2] - key.b);
      if (distance > 42) continue;
      data[offset + 3] = Math.max(0, Math.min(255, Math.round((distance / 42) * 255)));
      const x = pixel % info.width;
      const y = Math.floor(pixel / info.width);
      if (x > 0) enqueue(pixel - 1);
      if (x < info.width - 1) enqueue(pixel + 1);
      if (y > 0) enqueue(pixel - info.width);
      if (y < info.height - 1) enqueue(pixel + info.width);
    }
  }

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function makeLightLogoVariant(logoBuffer: Buffer) {
  const normalized = await normalizeTransparentLogo(logoBuffer);
  const { data, info } = await sharp(normalized).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (data[offset + 3] <= 2) continue;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const saturation = max ? (max - min) / max : 0;
    if (saturation < 0.65 || max < 80) {
      data[offset] = 250;
      data[offset + 1] = 250;
      data[offset + 2] = 250;
    } else if (luminance(red, green, blue) < 112) {
      const lift = 112 / Math.max(1, luminance(red, green, blue));
      data[offset] = Math.min(255, Math.round(red * lift));
      data[offset + 1] = Math.min(255, Math.round(green * lift));
      data[offset + 2] = Math.min(255, Math.round(blue * lift));
    }
  }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function prepareLogoForSurface(params: { logoBuffer: Buffer; surfaceBuffer?: Buffer; surfaceBox?: SurfaceBox; surfaceTone?: LogoSurfaceTone; fallbackTone?: LogoSurfaceTone }) {
  const surfaceTone = params.surfaceTone || (await detectLogoSurfaceTone(params.surfaceBuffer, params.surfaceBox, params.fallbackTone || "light"));
  const buffer = surfaceTone === "dark" ? await makeLightLogoVariant(params.logoBuffer) : await normalizeTransparentLogo(params.logoBuffer);
  return { buffer, surfaceTone };
}

export async function prepareLogoDataUrlForSurface(params: { logoDataUrl: string; surfaceDataUrl?: string; surfaceBox?: SurfaceBox; fallbackTone?: LogoSurfaceTone }) {
  const logoBuffer = dataUrlBuffer(params.logoDataUrl);
  if (!logoBuffer) return params.logoDataUrl;
  const prepared = await prepareLogoForSurface({
    logoBuffer,
    surfaceBuffer: dataUrlBuffer(params.surfaceDataUrl || "") || undefined,
    surfaceBox: params.surfaceBox,
    fallbackTone: params.fallbackTone,
  });
  return `data:image/png;base64,${prepared.buffer.toString("base64")}`;
}
