export type Radians = number & { readonly __brand: 'Radians' }
export type Degrees = number & { readonly __brand: 'Degrees' }

function r(n: number): Radians {
  return n as Radians
}
function d(n: number): Degrees {
  return n as Degrees
}

export const Radians = {
  create(value: number): Radians {
    return r(value)
  },
  fromDegrees(deg: Degrees): Radians {
    return r(((deg as number) * Math.PI) / 180)
  },
  fromTurns(turns: number): Radians {
    return r(turns * 2 * Math.PI)
  },
  toDegrees(rad: Radians): Degrees {
    return d(((rad as number) * 180) / Math.PI)
  },
  toTurns(rad: Radians): number {
    return (rad as number) / (2 * Math.PI)
  },
  normalize(rad: Radians): Radians {
    let r = (rad as number) % (2 * Math.PI)
    if (r < 0) {
      r += 2 * Math.PI
    }
    return r as Radians
  },
  normalizeHalf(rad: Radians): Radians {
    let r = (rad as number) % (2 * Math.PI)
    if (r < -Math.PI) {
      r += 2 * Math.PI
    } else if (r > Math.PI) {
      r -= 2 * Math.PI
    }
    return r as Radians
  },
  lerp(a: Radians, b: Radians, t: number): Radians {
    const diff = Radians.normalizeHalf(r(((b as number) - a) as number))
    return Radians.normalize(r((a as number) + diff * t))
  },
  add(a: Radians, b: Radians): Radians {
    return Radians.normalize(r((a as number) + (b as number)))
  },
  sub(a: Radians, b: Radians): Radians {
    return Radians.normalize(r((a as number) - (b as number)))
  },
  sin(rad: Radians): number {
    return Math.sin(rad as number)
  },
  cos(rad: Radians): number {
    return Math.cos(rad as number)
  },
  tan(rad: Radians): number {
    return Math.tan(rad as number)
  },
  asin(v: number): Radians {
    return r(Math.asin(v))
  },
  acos(v: number): Radians {
    return r(Math.acos(v))
  },
  atan(v: number): Radians {
    return r(Math.atan(v))
  },
  atan2(y: number, x: number): Radians {
    return r(Math.atan2(y, x))
  },
}

export const Degrees = {
  create(value: number): Degrees {
    return d(value)
  },
  fromRadians(rad: Radians): Degrees {
    return d(((rad as number) * 180) / Math.PI)
  },
  toRadians(deg: Degrees): Radians {
    return Radians.fromDegrees(deg)
  },
}

export const TAU = r(2 * Math.PI)
export const PI = r(Math.PI)
export const HALF_PI = r(Math.PI / 2)
export const QUARTER_PI = r(Math.PI / 4)
