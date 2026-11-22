"use client";

import { useEffect, useRef } from "react";
import { no2Ramp } from "@/lib/data";

type Props = { grid: (number | null)[][]; xs: number[] };

/** Campo medio de NO2 con cada dia girado para que el viento sople hacia la derecha. La mina queda al centro. */
export default function PlumeCanvas({ grid, xs }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    const n = grid.length;
    const vals = grid.flat().filter((v): v is number => v != null).sort((a, b) => a - b);
    if (!cv || !n || !vals.length) return;
    const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
    const lo = q(0.35);
    const hi = Math.max(q(0.995), lo + 1e-6);

    const off = document.createElement("canvas");
    off.width = off.height = n;
    const octx = off.getContext("2d");
    const ctx = cv.getContext("2d");
    if (!octx || !ctx) return;
    const img = octx.createImageData(n, n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const v = grid[r][c];
        const [R, G, B, A] = v == null ? [0, 0, 0, 0] : no2Ramp((v - lo) / (hi - lo));
        const k = ((n - 1 - r) * n + c) * 4; // la fila 0 es el extremo sur del marco girado: va abajo
        img.data[k] = R;
        img.data[k + 1] = G;
        img.data[k + 2] = B;
        img.data[k + 3] = A;
      }
    }
    octx.putImageData(img, 0, 0);

    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, 0, 0, W, H);

    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue("--color-ink-soft").trim() || "#cbd5e1";
    const step = xs[1] - xs[0];
    const px = (km: number) => (((km - xs[0]) / step + 0.5) / n) * W;
    const py = (km: number) => H - (((km - xs[0]) / step + 0.5) / n) * H;
    ctx.font = "10px Inter Variable, Segoe UI, sans-serif";
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;

    // zonas que se comparan: en contra del viento (izquierda) y a favor (derecha)
    ctx.setLineDash([3, 3]);
    ctx.globalAlpha = 0.55;
    for (const [a, b, label] of [[-40, -15, "en contra"], [0, 20, "a favor"]] as const) {
      ctx.strokeRect(px(a), py(10), px(b) - px(a), py(-10) - py(10));
      ctx.fillText(label, px(a) + 3, py(10) - 4);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // mina
    ctx.beginPath();
    ctx.arc(px(0), py(0), 4, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // flecha del viento
    const ax = 12, ay = 16, len = 46;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + len, ay);
    ctx.lineTo(ax + len - 6, ay - 4);
    ctx.moveTo(ax + len, ay);
    ctx.lineTo(ax + len - 6, ay + 4);
    ctx.stroke();
    ctx.fillText("viento", ax + len + 6, ay + 3);

    // escala
    const s0 = px(xs[0] + 4);
    const s1 = s0 + (px(20) - px(0));
    ctx.beginPath();
    ctx.moveTo(s0, H - 12);
    ctx.lineTo(s1, H - 12);
    ctx.stroke();
    ctx.fillText("20 km", s1 + 6, H - 9);
  }, [grid, xs]);

  return <canvas ref={ref} className="aspect-square w-full rounded-lg bg-sea ring-1 ring-inset ring-line" />;
}
