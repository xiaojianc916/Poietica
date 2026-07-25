import { clsx } from 'clsx'
import type { ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/*
 * The class merger the vendored shadcn primitives expect. It lives inside the
 * vendored subtree on purpose: the design system stays the authority for our
 * own components and must not take on a Tailwind class merging contract.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
