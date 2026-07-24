import type { Radians } from './angle'
import type { Point } from './point'
import type { Rect } from './rect'
import type { Vector2D } from './vector'

export type Transform2D = Readonly<DOMMatrix>

export interface TransformComponents {
  translateX: number
  translateY: number
  scaleX: number
  scaleY: number
  rotation: Radians
  skewX: Radians
  skewY: Radians
}

function r(n: number): Radians {
  return n as Radians
}

export function createTransform(init?: string | number[]): Transform2D {
  return new DOMMatrix(init)
}

export const identityTransform: Transform2D = new DOMMatrix()

export function transformTranslate(tx: number, ty: number): Transform2D {
  return new DOMMatrix().translateSelf(tx, ty)
}

export function transformScale(sx: number, sy: number = sx): Transform2D {
  return new DOMMatrix().scaleSelf(sx, sy)
}

export function transformRotate(angle: Radians, cx = 0, cy = 0): Transform2D {
  return new DOMMatrix()
    .translateSelf(cx, cy)
    .rotateSelf(r(((angle as number) * 180) / Math.PI))
    .translateSelf(-cx, -cy)
}

export function transformSkew(skx: Radians, sky: Radians = r(0)): Transform2D {
  return new DOMMatrix()
    .skewXSelf(r(((skx as number) * 180) / Math.PI))
    .skewYSelf(r(((sky as number) * 180) / Math.PI))
}

export function transformMultiply(a: Transform2D, b: Transform2D): Transform2D {
  return a.multiply(b)
}

export function transformInverse(t: Transform2D): Transform2D | null {
  try {
    return t.inverse()
  } catch {
    return null
  }
}

export function transformPoint(t: Transform2D, p: Point): Point {
  const pt = t.transformPoint(new DOMPoint(p[0], p[1]))
  return [pt.x, pt.y]
}

export function transformVector(t: Transform2D, v: Vector2D): Vector2D {
  // A vector has homogeneous w = 0: matrix translation must not affect it.
  const pt = t.transformPoint(new DOMPoint(v[0], v[1], 0, 0))
  return [pt.x, pt.y]
}

export function transformRect(t: Transform2D, rect: Rect): Rect {
  const corners = [
    [rect[0], rect[1]],
    [rect[0] + rect[2], rect[1]],
    [rect[0] + rect[2], rect[1] + rect[3]],
    [rect[0], rect[1] + rect[3]],
  ] as const
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const [x, y] of corners) {
    const transformed = transformPoint(t, [x, y])
    if (transformed[0] < minX) {
      minX = transformed[0]
    }
    if (transformed[0] > maxX) {
      maxX = transformed[0]
    }
    if (transformed[1] < minY) {
      minY = transformed[1]
    }
    if (transformed[1] > maxY) {
      maxY = transformed[1]
    }
  }
  return [minX, minY, maxX - minX, maxY - minY]
}

export function transformCompose(...transforms: Transform2D[]): Transform2D {
  return transforms.reduce((acc, t) => acc.multiply(t), identityTransform)
}

export function transformDecompose(t: Transform2D): TransformComponents {
  const m = t
  const sx = Math.hypot(m.a, m.b)
  const sy = Math.hypot(m.c, m.d)
  const det = m.a * m.d - m.b * m.c
  const rotation = r(Math.atan2(m.b, m.a))
  const skewX = r(Math.atan2(-m.c * sx, m.d * sx) - (rotation as number))
  return {
    translateX: m.e,
    translateY: m.f,
    scaleX: sx,
    scaleY: sy * (det >= 0 ? 1 : -1),
    rotation,
    skewX,
    skewY: 0 as Radians,
  }
}

export function transformEquals(a: Transform2D, b: Transform2D, eps = 1e-10): boolean {
  return (
    Math.abs(a.a - b.a) < eps &&
    Math.abs(a.b - b.b) < eps &&
    Math.abs(a.c - b.c) < eps &&
    Math.abs(a.d - b.d) < eps &&
    Math.abs(a.e - b.e) < eps &&
    Math.abs(a.f - b.f) < eps
  )
}

export function transformLerp(a: Transform2D, b: Transform2D, t: number): Transform2D {
  const ca = transformDecompose(a)
  const cb = transformDecompose(b)
  const lerp = (x: number, y: number) => x + (y - x) * t
  const result = new DOMMatrix()
  result.translateSelf(lerp(ca.translateX, cb.translateX), lerp(ca.translateY, cb.translateY))
  result.scaleSelf(lerp(ca.scaleX, cb.scaleX), lerp(ca.scaleY, cb.scaleY))
  result.rotateSelf(r((lerp(ca.rotation, cb.rotation) * 180) / Math.PI))
  result.skewXSelf(r((lerp(ca.skewX, cb.skewX) * 180) / Math.PI))
  return result
}
