import { ThemeMode } from "../types/theme";

const DEFAULT_DARK_RGB: [number, number, number] = [249, 115, 22]; // #f97316
const DEFAULT_LIGHT_RGB: [number, number, number] = [234, 88, 12]; // #ea580c (stronger contrast on light)

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(hn + 1 / 3) * 255),
    Math.round(hue2rgb(hn) * 255),
    Math.round(hue2rgb(hn - 1 / 3) * 255),
  ];
}

function setRootAccent(rgb: [number, number, number]): void {
  const [r, g, b] = rgb;
  const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  const root = document.documentElement.style;
  root.setProperty("--accent", hex);
  root.setProperty("--accent-rgb", `${r} ${g} ${b}`);
}

/**
 * Extracts a vibrant, WCAG-readable dominant accent color from the current album cover.
 * Uses a 24x24 offscreen canvas (<1ms, runs only when track artwork or theme changes).
 */
export function applyAccentFromThumbnail(
  thumbnailDataUrl: string | undefined,
  theme: ThemeMode
): void {
  const fallback = theme === "light" ? DEFAULT_LIGHT_RGB : DEFAULT_DARK_RGB;
  if (!thumbnailDataUrl) {
    setRootAccent(fallback);
    return;
  }

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    try {
      const size = 24;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        setRootAccent(fallback);
        return;
      }

      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;

      // Group vibrant pixels into 12 hue buckets (30deg each) so dominant mood wins over borders
      const buckets = Array.from({ length: 12 }, () => ({
        weight: 0,
        r: 0,
        g: 0,
        b: 0,
      }));

      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a < 180) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const [h, s, l] = rgbToHsl(r, g, b);

        // Ignore near-black, near-white, and dead-gray pixels
        if (s < 0.22 || l < 0.14 || l > 0.88) continue;

        const bucketIdx = Math.floor(h / 30) % 12;
        const vibrancy = s * s * (1 - Math.abs(l - 0.5) * 1.1);
        const w = Math.max(0.05, vibrancy);
        buckets[bucketIdx].weight += w;
        buckets[bucketIdx].r += r * w;
        buckets[bucketIdx].g += g * w;
        buckets[bucketIdx].b += b * w;
      }

      let best = buckets[0];
      for (const b of buckets) {
        if (b.weight > best.weight) best = b;
      }

      if (best.weight < 0.6) {
        // Monochrome / grayscale album cover -> stay on clean default accent
        setRootAccent(fallback);
        return;
      }

      const avgR = best.r / best.weight;
      const avgG = best.g / best.weight;
      const avgB = best.b / best.weight;
      const [h, s, l] = rgbToHsl(avgR, avgG, avgB);

      // Clamp saturation & lightness so accent always looks crafted and readable on both themes
      const safeS = Math.max(0.55, Math.min(0.84, s));
      const safeL =
        theme === "light"
          ? Math.max(0.36, Math.min(0.46, l))
          : Math.max(0.54, Math.min(0.66, l));

      setRootAccent(hslToRgb(h, safeS, safeL));
    } catch {
      setRootAccent(fallback);
    }
  };
  img.onerror = () => setRootAccent(fallback);
  img.src = thumbnailDataUrl;
}
