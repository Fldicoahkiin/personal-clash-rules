import { type RefObject, useEffect, useRef } from "react";

// A character field behind the hero: streams of traffic drift from the left edge into the routing panel's
// request node, the pointer stirs them, and a pulse runs in when a test starts. Purely decorative.
const ramp = " .:-=+*#%@";
const font = '13px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const lineHeight = 16;
const frameMs = 1000 / 15;
const streamCount = 9;

type Rect = { c1: number; c2: number; r1: number; r2: number };

function hexToRgb(value: string): [number, number, number] {
  const hex = value.trim().replace("#", "");
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function mix(a: string, b: string, amount: number): string {
  const [x, y] = [hexToRgb(a), hexToRgb(b)];
  return `rgb(${x.map((channel, i) => Math.round(channel * amount + y[i] * (1 - amount))).join(",")})`;
}

export function AsciiField({ targetRef, clearSelector, pulse }: {
  /** The element streams converge on; its left edge and vertical centre. */
  targetRef: RefObject<HTMLElement | null>;
  /** Elements inside the host whose cells stay empty so text stays legible. */
  clearSelector: string;
  /** Changes when a test starts. */
  pulse: number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pulseAt = useRef<number | null>(null);

  useEffect(() => {
    if (pulse !== null) pulseAt.current = performance.now();
  }, [pulse]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const host = canvas.parentElement!;
    const context = canvas.getContext("2d")!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    let cols = 0;
    let rows = 0;
    let cellWidth = 8;
    let target = { x: 0, y: 0 };
    let mask = new Uint8Array(0);
    let lines: string[][][] = [];
    const centres = new Float32Array(220 * streamCount);
    const widths = new Float32Array(220 * streamCount);
    const strengths = new Float32Array(220 * streamCount);
    let starts: number[] = [];
    let colors = { low: "", mid: "", high: "", accent: "" };
    let pointer: { x: number; y: number; at: number } | null = null;
    let visible = true;
    let raf = 0;
    let last = 0;

    function readColors() {
      const style = getComputedStyle(host);
      const token = (name: string) => style.getPropertyValue(name).trim();
      const [faint, paper, accent] = [token("--faint"), token("--paper"), token("--accent")];
      colors = { low: mix(faint, paper, 0.26), mid: mix(faint, paper, 0.5), high: mix(faint, paper, 0.8), accent: mix(accent, paper, 0.85) };
    }

    function layout() {
      const box = host.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(box.width * ratio);
      canvas.height = Math.round(box.height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.font = font;
      context.textBaseline = "top";
      cellWidth = context.measureText("0").width;
      cols = Math.min(220, Math.ceil(box.width / cellWidth));
      rows = Math.min(64, Math.ceil(box.height / lineHeight));
      const toCells = (rect: DOMRect, margin: number): Rect => ({
        c1: Math.floor((rect.left - box.left) / cellWidth) - margin,
        c2: Math.ceil((rect.right - box.left) / cellWidth) + margin,
        r1: Math.floor((rect.top - box.top) / lineHeight) - Math.min(margin, 1),
        r2: Math.ceil((rect.bottom - box.top) / lineHeight) - 1 + Math.min(margin, 1),
      });
      const elements = [...host.querySelectorAll<HTMLElement>(clearSelector)];
      const cleared = elements.flatMap(element => [...element.getClientRects()].map(rect => toCells(rect, 0)));
      const feathered = elements.flatMap(element => [...element.getClientRects()].map(rect => toCells(rect, 3)));
      const inside = (r: Rect, x: number, y: number) => x >= r.c1 && x <= r.c2 && y >= r.r1 && y <= r.r2;
      // Text cells stay empty; a three-cell ring around them thins out so the field fades instead of stopping hard.
      mask = new Uint8Array(cols * rows);
      for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
        if (cleared.some(r => inside(r, x, y)) || (feathered.some(r => inside(r, x, y)) && (x * 7 + y * 13) % 10 < 6)) mask[y * cols + x] = 1;
      }
      const node = targetRef.current?.getBoundingClientRect();
      target = node
        ? { x: (node.left - box.left) / cellWidth - 1, y: (node.top + node.height / 2 - box.top) / lineHeight - 0.5 }
        : { x: cols * 0.55, y: rows * 0.3 };
      starts = Array.from({ length: streamCount }, (_, k) => 1 + (k / (streamCount - 1)) * Math.max(1, rows - 3));
      draw(performance.now());
    }

    function draw(now: number) {
      const t = reduced.matches ? 0 : now / 1000;
      const pulseAge = pulseAt.current === null ? Infinity : (now - pulseAt.current) / 1000;
      const pointerAge = pointer ? (now - pointer.at) / 1000 : Infinity;
      context.clearRect(0, 0, canvas.width, canvas.height);
      // One line of text per colour and row keeps the canvas work to a few hundred fillText calls.
      const keys = ["low", "mid", "high", "accent"] as const;
      if (lines.length !== keys.length || lines[0]?.length !== rows || lines[0]?.[0]?.length !== cols) {
        lines = keys.map(() => Array.from({ length: rows }, () => new Array<string>(cols)));
      }
      for (const grid of lines) for (const line of grid) line.fill(" ");
      // Stream centres, widths and strengths depend only on the column, so they are worked out once per column.
      const reach = Math.max(0, Math.min(cols, Math.ceil(target.x)));
      for (let x = 0; x < reach; x += 1) {
        const u = x / target.x;
        const ease = u * u * (3 - 2 * u);
        for (let k = 0; k < streamCount; k += 1) {
          const at = x * streamCount + k;
          centres[at] = starts[k] + (target.y - starts[k]) * ease + Math.sin(x * 0.11 + k * 1.7 + t * 0.7) * 0.9 * (1 - ease);
          widths[at] = 0.5 + 1.3 * (1 - ease);
          // Bright stretches travel toward the request node.
          strengths[at] = (0.3 + 0.35 * (1 + Math.sin((x - t * 10) * 0.5 + k * 2.1))) * (0.45 + 0.55 * ease);
        }
      }
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          if (mask[y * cols + x]) continue;
          let stream = 0;
          if (x < reach) {
            for (let k = 0; k < streamCount; k += 1) {
              const at = x * streamCount + k;
              const distance = (y - centres[at]) / widths[at];
              if (distance > 3 || distance < -3) continue;
              stream = Math.max(stream, Math.exp(-distance * distance) * strengths[at]);
            }
          }
          const ambient = (0.5 + 0.5 * Math.sin(x * 0.21 + y * 0.37 + t * 0.9) * Math.sin(x * 0.07 - y * 0.19 - t * 0.6)) * 0.17;
          let value = Math.max(stream, ambient);
          let lit = 0;
          if (pointerAge < 0.9 && pointer) {
            const r = Math.hypot(x - pointer.x, (y - pointer.y) * 2);
            value += (1 - pointerAge / 0.9) * Math.exp(-(r * r) / 40) * (0.55 + 0.45 * Math.sin(r * 1.3 - pointerAge * 14));
          }
          if (pulseAge < 0.9 && x < target.x) {
            const front = pulseAge / 0.75;
            lit = stream * Math.exp(-((x / target.x - front) ** 2) / 0.004);
            value += lit;
          }
          value = Math.min(1, value);
          const index = Math.min(ramp.length - 1, Math.floor(value * ramp.length));
          if (index === 0) continue;
          const bucket = lit > 0.25 ? 3 : value < 0.32 ? 0 : value < 0.6 ? 1 : 2;
          lines[bucket][y][x] = ramp[index];
        }
      }
      keys.forEach((key, bucket) => {
        context.fillStyle = colors[key];
        lines[bucket].forEach((line, y) => {
          const text = line.join("");
          if (text.trim()) context.fillText(text, 0, y * lineHeight + 1);
        });
      });
    }

    function loop(now: number) {
      raf = window.requestAnimationFrame(loop);
      if (!visible || document.hidden || reduced.matches || now - last < frameMs) return;
      last = now;
      draw(now);
    }

    const onPointer = (event: PointerEvent) => {
      const box = host.getBoundingClientRect();
      pointer = { x: (event.clientX - box.left) / cellWidth, y: (event.clientY - box.top) / lineHeight, at: performance.now() };
    };
    const onTheme = () => {
      readColors();
      draw(performance.now());
    };

    readColors();
    layout();
    raf = window.requestAnimationFrame(loop);
    const resize = new ResizeObserver(layout);
    resize.observe(host);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    intersection.observe(host);
    const themeObserver = new MutationObserver(onTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    dark.addEventListener("change", onTheme);
    reduced.addEventListener("change", layout);
    host.addEventListener("pointermove", onPointer);
    void document.fonts.ready.then(layout);
    return () => {
      window.cancelAnimationFrame(raf);
      resize.disconnect();
      intersection.disconnect();
      themeObserver.disconnect();
      dark.removeEventListener("change", onTheme);
      reduced.removeEventListener("change", layout);
      host.removeEventListener("pointermove", onPointer);
    };
  }, [clearSelector, targetRef]);

  return <canvas className="ascii-field" ref={canvasRef} aria-hidden="true" />;
}
