import './message-attachments.css'

import type { MessageImage } from '@poietica/agent-timeline'
import { useMemo, useState } from 'react'
import { ImageLightbox } from '../media/ImageLightbox'

/**
 * 一句话带的图，排在这句话上面。
 *
 * 不在气泡里。气泡是那句话的形状 —— 它的宽度贴着文字（timeline.css 里的
 * fit-content），把一排缩略图塞进去，气泡就被撑成一个图片框，而那句话反倒
 * 成了图片的说明文字。专业软件都是这么分的：附件是一件事，话是另一件事，
 * 挨着放，不套在一起。
 *
 * 右对齐用的是气泡同一套办法（margin-inline-start: auto + fit-content），不是
 * 在外面再包一层 flex 去接管这件事 —— 那会变成第二个说了算的地方。
 */

/** 单张图时放大一档：一张图不是一个列表，缩成同样大的方块只是白白丢掉细节。 */
export function MessageAttachments({ images }: { readonly images: readonly MessageImage[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  /* 大图那一层要的是幻灯片，不是我们的条目；转换记住，别每帧重建。 */
  const slides = useMemo(
    () => images.map((image, at) => ({ src: image.url, alt: `图片 ${String(at + 1)}` })),
    [images],
  )

  return (
    <div className="timeline-attachments">
      {images.map((image, at) => (
        <button
          className="timeline-attachments__item"
          key={image.url}
          onClick={() => {
            setOpenIndex(at)
          }}
          type="button"
        >
          {/* 缩略图不参与懒加载：它就在视口里，而且已经在内存里了。 */}
          <img
            alt={`图片 ${String(at + 1)}`}
            className="timeline-attachments__image"
            src={image.url}
          />
        </button>
      ))}

      <ImageLightbox images={slides} index={openIndex} onIndexChange={setOpenIndex} />
    </div>
  )
}
