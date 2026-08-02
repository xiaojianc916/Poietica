import Lightbox, { type Slide, type SlideImage } from 'yet-another-react-lightbox'
import Counter from 'yet-another-react-lightbox/plugins/counter'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/plugins/counter.css'
import 'yet-another-react-lightbox/styles.css'
import { type CSSProperties, useCallback, useMemo, useState } from 'react'
import './image-lightbox.css'

/** A previewable image, typically produced from a composer attachment. */
export type PreviewableImage = {
  /** Stable identity; falls back to `src` when omitted. */
  id?: string
  /** `asset://`, `blob:`, `data:` and `https:` sources are all supported. */
  src: string
  alt?: string
  width?: number
  height?: number
  caption?: string
}

export type ImageLightboxProps = {
  images: readonly PreviewableImage[]
  /** Index of the open slide; `null` (or `-1`) keeps the lightbox closed. */
  index: number | null
  onIndexChange: (index: number | null) => void
}

/**
 * Build lightbox slides from attachments.
 *
 * `SlideImage` declares `width?: number` (without `| undefined`), and this
 * workspace compiles with `exactOptionalPropertyTypes`. An absent dimension must
 * therefore be an absent *key*, not a key holding `undefined` — hence the
 * conditional spreads instead of a cast or a widened local type.
 */
const toSlides = (images: readonly PreviewableImage[]): Slide[] =>
  images.map((image): SlideImage => {
    const { width, height, caption } = image

    return {
      src: image.src,
      alt: image.alt ?? '',
      ...(width !== undefined && { width }),
      ...(height !== undefined && { height }),
      ...(caption !== undefined && { description: caption }),
    }
  })

/**
 * Fullscreen image preview. Controlled: the caller owns the open index, so the
 * same overlay can be driven from a thumbnail grid, a keyboard shortcut, or a
 * transcript message without duplicating state.
 */
export function ImageLightbox({ images, index, onIndexChange }: ImageLightboxProps) {
  const slides = useMemo(() => toSlides(images), [images])
  const open = index !== null && index >= 0 && index < slides.length

  const handleClose = useCallback(() => {
    onIndexChange(null)
  }, [onIndexChange])

  if (slides.length === 0) {
    return null
  }

  return (
    <Lightbox
      animation={{ fade: 160, swipe: 260 }}
      carousel={{ finite: true, preload: 1 }}
      className="poietica-lightbox"
      close={handleClose}
      controller={{ closeOnBackdropClick: true, closeOnPullDown: true }}
      index={open ? index : 0}
      on={{ view: ({ index: next }) => onIndexChange(next) }}
      open={open}
      plugins={[Zoom, Counter]}
      slides={slides}
      styles={{ container: { backdropFilter: 'blur(2px)' } }}
      zoom={{ maxZoomPixelRatio: 4, scrollToZoom: true }}
    />
  )
}

export type ImageThumbnailGridProps = {
  images: readonly PreviewableImage[]
  /** Rendered thumbnail edge length in px. */
  size?: number
  label?: string
}

/**
 * Thumbnail strip with a built-in lightbox. Drop this straight into the
 * composer attachment tray or a transcript bubble.
 */
export function ImageThumbnailGrid({ images, size, label }: ImageThumbnailGridProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  if (images.length === 0) {
    return null
  }

  return (
    <>
      <ul
        aria-label={label ?? 'Attached images'}
        className="poietica-image-grid"
        style={size ? ({ ['--poietica-thumb-size']: `${size}px` } as CSSProperties) : undefined}
      >
        {images.map((image, position) => (
          <li className="poietica-image-grid__item" key={image.id ?? image.src}>
            <button
              aria-label={`Preview ${image.alt ?? `image ${position + 1}`}`}
              className="poietica-image-grid__button"
              onClick={() => setOpenIndex(position)}
              type="button"
            >
              <img
                alt={image.alt ?? ''}
                className="poietica-image-grid__thumb"
                decoding="async"
                draggable={false}
                loading="lazy"
                src={image.src}
              />
            </button>
          </li>
        ))}
      </ul>
      <ImageLightbox images={images} index={openIndex} onIndexChange={setOpenIndex} />
    </>
  )
}
