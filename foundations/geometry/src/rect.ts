import type { Point } from './point'
import type { Size } from './size'

export type Rect = readonly [number, number, number, number]

export const Rect = {
  create(x: number, y: number, w: number, h: number): Rect {
    return [x, y, w, h]
  },
  fromPoints(p1: Point, p2: Point): Rect {
    return [
      Math.min(p1[0], p2[0]),
      Math.min(p1[1], p2[1]),
      Math.abs(p2[0] - p1[0]),
      Math.abs(p2[1] - p1[1]),
    ]
  },
  fromPointSize(p: Point, s: Size): Rect {
    return [p[0], p[1], s[0], s[1]]
  },
  zero(): Rect {
    return [0, 0, 0, 0]
  },
  infinite(): Rect {
    return [
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ]
  },
}

export function createRect(x: number, y: number, w: number, h: number): Rect {
  return [x, y, w, h]
}
export function rectFromPoints(p1: Point, p2: Point): Rect {
  return Rect.fromPoints(p1, p2)
}
export function rectFromPointSize(p: Point, s: Size): Rect {
  return Rect.fromPointSize(p, s)
}

export function rectX(r: Rect): number {
  return r[0]
}
export function rectY(r: Rect): number {
  return r[1]
}
export function rectWidth(r: Rect): number {
  return r[2]
}
export function rectHeight(r: Rect): number {
  return r[3]
}
export function rectLeft(r: Rect): number {
  return r[0]
}
export function rectRight(r: Rect): number {
  return r[0] + r[2]
}
export function rectTop(r: Rect): number {
  return r[1]
}
export function rectBottom(r: Rect): number {
  return r[1] + r[3]
}
export function rectCenter(r: Rect): Point {
  return [r[0] + r[2] / 2, r[1] + r[3] / 2]
}
export function rectTopLeft(r: Rect): Point {
  return [r[0], r[1]]
}
export function rectTopRight(r: Rect): Point {
  return [r[0] + r[2], r[1]]
}
export function rectBottomLeft(r: Rect): Point {
  return [r[0], r[1] + r[3]]
}
export function rectBottomRight(r: Rect): Point {
  return [r[0] + r[2], r[1] + r[3]]
}

export function rectTranslate(r: Rect, dx: number, dy: number): Rect {
  return [r[0] + dx, r[1] + dy, r[2], r[3]]
}
export function rectScale(r: Rect, sx: number, sy: number = sx): Rect {
  return [r[0] * sx, r[1] * sy, r[2] * sx, r[3] * sy]
}
export function rectInset(
  r: Rect,
  t: number,
  rInset: number = t,
  b: number = t,
  l: number = rInset,
): Rect {
  return [r[0] + l, r[1] + t, r[2] - l - rInset, r[3] - t - b]
}
export function rectUnion(a: Rect, b: Rect): Rect {
  const left = Math.min(a[0], b[0])
  const top = Math.min(a[1], b[1])
  const right = Math.max(a[0] + a[2], b[0] + b[2])
  const bottom = Math.max(a[1] + a[3], b[1] + b[3])
  return [left, top, right - left, bottom - top]
}
export function rectIntersect(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a[0], b[0])
  const top = Math.max(a[1], b[1])
  const right = Math.min(a[0] + a[2], b[0] + b[2])
  const bottom = Math.min(a[1] + a[3], b[1] + b[3])
  if (left >= right || top >= bottom) {
    return null
  }
  return [left, top, right - left, bottom - top]
}
export function rectContainsPoint(r: Rect, p: Point): boolean {
  return p[0] >= r[0] && p[0] <= r[0] + r[2] && p[1] >= r[1] && p[1] <= r[1] + r[3]
}
export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner[0] >= outer[0] &&
    inner[1] >= outer[1] &&
    inner[0] + inner[2] <= outer[0] + outer[2] &&
    inner[1] + inner[3] <= outer[1] + outer[3]
  )
}
export function rectIntersects(a: Rect, b: Rect): boolean {
  return a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1]
}
export function rectEquals(a: Rect, b: Rect, eps = 1e-10): boolean {
  return (
    Math.abs(a[0] - b[0]) < eps &&
    Math.abs(a[1] - b[1]) < eps &&
    Math.abs(a[2] - b[2]) < eps &&
    Math.abs(a[3] - b[3]) < eps
  )
}
export function rectArea(r: Rect): number {
  return r[2] * r[3]
}
export function rectAspectRatio(r: Rect): number {
  return r[3] === 0 ? Number.POSITIVE_INFINITY : r[2] / r[3]
}
export function rectNormalize(r: Rect): Rect {
  return [Math.min(r[0], r[0] + r[2]), Math.min(r[1], r[1] + r[3]), Math.abs(r[2]), Math.abs(r[3])]
}
export function rectInflate(r: Rect, dx: number, dy: number = dx): Rect {
  return [r[0] - dx, r[1] - dy, r[2] + 2 * dx, r[3] + 2 * dy]
}
export function rectClamp(r: Rect, bounds: Rect): Rect {
  const x = Math.max(bounds[0], Math.min(bounds[0] + bounds[2] - r[2], r[0]))
  const y = Math.max(bounds[1], Math.min(bounds[1] + bounds[3] - r[3], r[1]))
  return [x, y, r[2], r[3]]
}
