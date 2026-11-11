import { useEffect, useRef, useState } from "react";
import type { PuzzleId } from "@openseas/engine";
import { t } from "./content.js";
import type { Media } from "./guides/types.js";

export const mediaUrl = (puzzle: PuzzleId, name: string, ext: "webp" | "mp4"): string => `/media/${puzzle}/${name}.${ext}`;

const reducedMotion = (): boolean => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A picture from the real board. A clip loops silently while it is on screen and stops when it
 * scrolls away; a tap pauses it. With reduced motion asked for it waits for the reader to play it.
 */
export function Figure({ puzzle, media, eager = false }: { puzzle: PuzzleId; media: Media; eager?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [wanted, setWanted] = useState(() => !reducedMotion());
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (!wanted) {
      el.pause();
      return;
    }
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void el.play().catch(() => {});
        else el.pause();
      },
      { threshold: 0.35 },
    );
    seen.observe(el);
    return () => seen.disconnect();
  }, [wanted]);

  return (
    <figure className={`figure figure-${media.kind}`} data-testid={`media-${media.name}`}>
      {media.kind === "clip" ? (
        <button type="button" className="figure-frame" onClick={() => setWanted((w) => !w)} aria-label={t(wanted ? "docs.clip_pause" : "docs.clip_play")} aria-pressed={wanted}>
          <video
            ref={video}
            src={mediaUrl(puzzle, media.name, "mp4")}
            poster={mediaUrl(puzzle, media.name, "webp")}
            muted
            loop
            playsInline
            preload={eager ? "auto" : "metadata"}
            aria-label={media.alt}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
          <span className="figure-chip">{playing ? t("docs.clip_label") : "▶"}</span>
        </button>
      ) : (
        <span className="figure-frame">
          <img src={mediaUrl(puzzle, media.name, "webp")} alt={media.alt} loading={eager ? "eager" : "lazy"} decoding="async" />
        </span>
      )}
      <figcaption>{media.caption}</figcaption>
    </figure>
  );
}
