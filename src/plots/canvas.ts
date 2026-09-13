/**
 * Canvas surface management.
 *
 * Two jobs, both of which are easy to get subtly wrong and hard to notice:
 *
 *  1. Device pixel ratio. A canvas has a CSS size and a backing-store size, and if
 *     they are not related by the display's DPR then every trace on the site is
 *     softly blurred on the machines most engineers actually use. The fix is to size
 *     the backing store in device pixels and scale the context once, so all drawing
 *     code can then work in CSS pixels and forget about it.
 *  2. Crisp hairlines. A 1px line drawn at an integer coordinate straddles the pixel
 *     boundary and renders as two half-intensity rows. Grid lines and axes therefore
 *     snap to a half-pixel offset. Traces do not: a waveform is a real curve and
 *     should be antialiased where it falls.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { surface, font, fontSize } from '../design/tokens';

/** Margins reserved for axis labels and titles, in CSS pixels. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_INSETS: Insets = { top: 12, right: 16, bottom: 34, left: 62 };

/** A rectangle in CSS pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Surface {
  ctx: CanvasRenderingContext2D;
  /** Full canvas size in CSS pixels. */
  width: number;
  height: number;
  /** Device pixel ratio the backing store was sized for. */
  dpr: number;
  /** The area inside the insets, where data is drawn. */
  plot: Rect;
  insets: Insets;
}

/**
 * Size a canvas's backing store for the display and return a drawing surface.
 *
 * Call this at the top of every paint. It is cheap when nothing has changed
 * (assigning the same value to canvas.width is a no-op in every engine that matters,
 * and the guard below skips it anyway) and it is the only place DPR is handled.
 */
export function prepare(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  insets: Partial<Insets> = {},
): Surface | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const w = Math.max(1, Math.round(cssWidth * dpr));
  const h = Math.max(1, Math.round(cssHeight * dpr));
  // Reassigning width clears the canvas, so only do it when it actually changed.
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const ins: Insets = { ...DEFAULT_INSETS, ...insets };
  const plot: Rect = {
    x: ins.left,
    y: ins.top,
    width: Math.max(1, cssWidth - ins.left - ins.right),
    height: Math.max(1, cssHeight - ins.top - ins.bottom),
  };

  ctx.font = `${fontSize.tick}px ${font.mono}`;
  ctx.textBaseline = 'middle';
  return { ctx, width: cssWidth, height: cssHeight, dpr, plot, insets: ins };
}

/** Paint the plot background. Separate from prepare() so an overlay can skip it. */
export function paintBackground(s: Surface, color: string = surface.ink800): void {
  s.ctx.fillStyle = color;
  s.ctx.fillRect(0, 0, s.width, s.height);
}

/**
 * Snap a coordinate so a 1px stroke lands on one row of pixels rather than two.
 * Only for axis-aligned hairlines - grid, axes, cursors, mask edges.
 */
export function crisp(v: number): number {
  return Math.round(v) + 0.5;
}

/** Run a callback with the plot area clipped, so a trace cannot spill onto the axes. */
export function withClip(s: Surface, fn: () => void): void {
  const { ctx, plot } = s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y, plot.width, plot.height);
  ctx.clip();
  try {
    fn();
  } finally {
    ctx.restore();
  }
}

/** Is a point inside the plot area? For hit-testing hover and cursor drags. */
export function inPlot(plot: Rect, x: number, y: number): boolean {
  return x >= plot.x && x <= plot.x + plot.width && y >= plot.y && y <= plot.y + plot.height;
}

/* ------------------------------------------------------------- React glue */

/**
 * Observe an element's size. Returns [ref, size]; size is null until the first
 * measurement, so a caller can avoid painting at a nonsense aspect ratio on the
 * first frame.
 */
export function useElementSize<T extends HTMLElement>(): [
  React.RefCallback<T>,
  { width: number; height: number } | null,
] {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    if (typeof ResizeObserver === 'undefined') {
      setSize({ width: node.clientWidth, height: node.clientHeight });
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      // Round to whole CSS pixels: a fractional width makes the DPR arithmetic
      // produce a different backing size on every scroll on some browsers.
      setSize({ width: Math.round(box.width), height: Math.round(box.height) });
    });
    ro.observe(node);
    observerRef.current = ro;
    setSize({ width: node.clientWidth, height: node.clientHeight });
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);
  return [ref, size];
}

/**
 * Schedule a paint on the next animation frame, coalescing repeated requests.
 *
 * A slider fires far faster than the display refreshes. Painting on every event
 * wastes work and, worse, makes the drag feel laggy because the main thread is busy
 * drawing frames nobody will see.
 */
export function useAnimationFrame(callback: () => void): () => void {
  const cbRef = useRef(callback);
  cbRef.current = callback;
  const handle = useRef(0);

  const request = useCallback(() => {
    if (handle.current) return;
    handle.current = requestAnimationFrame(() => {
      handle.current = 0;
      cbRef.current();
    });
  }, []);

  useEffect(
    () => () => {
      if (handle.current) cancelAnimationFrame(handle.current);
      handle.current = 0;
    },
    [],
  );

  return request;
}

/** True when the reader has asked the OS for reduced motion. */
export function prefersReducedMotion(): boolean {
  if (typeof matchMedia !== 'function') return false;
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}
