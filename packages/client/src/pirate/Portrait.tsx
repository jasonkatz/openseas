import { useId } from "react";
import type { PirateLookWire } from "@openseas/protocol";
import { t } from "@openseas/boards";
import { jacketHex, jacketName, headgearName } from "./look.js";

const FELT = "#2a2420";
const EDGE = "#14100d";
const SKIN = "#e0a27a";
const SHIRT = "#efe3c6";
const BRASS = "#d4a548";
const TIN = "#c3ccd4";
const LEATHER = "#6b4a2e";
const FLEECE = "#d9c9a8";

/** Each headgear is its own outline, as on deck, so a look reads without its colors (rule 6). */
function Headgear({ id }: { id: string }) {
  switch (id) {
    case "bubble-helmet":
      // A clear globe right round the head, on a collar ring, with a glint on its brow.
      return (
        <g data-headgear="bubble-helmet">
          <circle cx="32" cy="30" r="15.6" fill="rgba(191,239,255,0.16)" stroke="rgba(207,239,255,0.85)" strokeWidth="1.5" />
          <path d="M22.6 22.4 Q26 16.4 32.4 15.6" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M20.4 42 Q32 47.2 43.6 42 L44.4 45.6 Q32 51 19.6 45.6 Z" fill={TIN} stroke={EDGE} strokeWidth="1.1" strokeLinejoin="round" />
        </g>
      );
    case "goggles":
      // Spiked hair, a strap round the brow and two lenses pushed up on the forehead.
      return (
        <g data-headgear="goggles">
          <path d="M22.4 24.4 L25.4 14.6 L28.8 21.6 L32 12.8 L35.2 21.6 L38.6 14.6 L41.6 24.4 Q32 20.6 22.4 24.4 Z" fill={FELT} stroke={EDGE} strokeWidth="1.1" strokeLinejoin="round" />
          <path d="M21.4 26.6 Q32 22.4 42.6 26.6 L42.9 29.4 Q32 25.4 21.1 29.4 Z" fill="#3a2a20" stroke={EDGE} strokeWidth="0.9" strokeLinejoin="round" />
          <circle cx="27.3" cy="25.4" r="4.2" fill="#8fe6ff" stroke={BRASS} strokeWidth="1.6" />
          <circle cx="36.7" cy="25.4" r="4.2" fill="#8fe6ff" stroke={BRASS} strokeWidth="1.6" />
          <path d="M25.4 24 L27 22.6 M34.8 24 L36.4 22.6" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.1" strokeLinecap="round" />
        </g>
      );
    case "wide-brim":
      return (
        <g data-headgear="wide-brim">
          <path d="M22 22 L23.5 10.5 Q32 7.5 40.5 10.5 L42 22 Z" fill={FELT} stroke={EDGE} strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M22.6 17.5 Q32 16 41.4 17.5 L41.8 20.6 Q32 19.2 22.2 20.6 Z" fill={BRASS} />
          <path d="M5 23 Q32 15 59 23 Q32 29 5 23 Z" fill={FELT} stroke={EDGE} strokeWidth="1.2" strokeLinejoin="round" />
        </g>
      );
    case "beanie":
      // A knitted dome pulled down to a rolled brim, with a bobble on top.
      return (
        <g data-headgear="beanie">
          <circle cx="32" cy="13.6" r="3.9" fill={FLEECE} stroke={EDGE} strokeWidth="0.9" />
          <path d="M20.8 27 Q20.2 16.2 32 16.2 Q43.8 16.2 43.2 27 Z" fill="#4a5a6a" stroke={EDGE} strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M20 25.4 Q32 21.8 44 25.4 L44 29.6 Q32 26 20 29.6 Z" fill="#6a7a8a" stroke={EDGE} strokeWidth="1" strokeLinejoin="round" />
          <path d="M25 26.6 L25 23.2 M29.6 25.6 L29.6 22.2 M34.4 25.6 L34.4 22.2 M39 26.6 L39 23.2" fill="none" stroke="rgba(20,16,13,0.45)" strokeWidth="0.9" strokeLinecap="round" />
        </g>
      );
    default:
      // A flight cap: leather close over the skull, a flap down over each ear, fleece across the brow, a strap under the chin.
      return (
        <g data-headgear="flight-cap">
          <path d="M21.6 38.4 Q32 44.2 42.4 38.4" fill="none" stroke="#3a2a20" strokeWidth="1.1" strokeLinecap="round" />
          <path d="M20.8 29.5 Q20.2 18.2 32 18.2 Q43.8 18.2 43.2 29.5 Q32 25 20.8 29.5 Z" fill={LEATHER} stroke={EDGE} strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M20.9 27.6 L19.4 38.2 Q21.6 40.8 24 38.8 L24.6 28.6 Z" fill={LEATHER} stroke={EDGE} strokeWidth="1" strokeLinejoin="round" />
          <path d="M43.1 27.6 L44.6 38.2 Q42.4 40.8 40 38.8 L39.4 28.6 Z" fill={LEATHER} stroke={EDGE} strokeWidth="1" strokeLinejoin="round" />
          <path d="M22 28.4 Q32 24 42 28.4" fill="none" stroke={FLEECE} strokeWidth="2.6" strokeLinecap="round" />
        </g>
      );
  }
}

export interface PortraitProps {
  look: PirateLookWire;
  size?: number;
  /** The pirate's name, for the label; leave out when the picture sits beside the name already. */
  name?: string;
  className?: string;
}

/** A pirate's likeness, head and shoulders, in the jacket and headgear they picked (DESIGN.md 3.6). */
export function Portrait({ look, size = 64, name, className }: PortraitProps) {
  const clip = `portrait-${useId().replace(/:/g, "")}`;
  const jacket = jacketHex(look.jacket);
  const label = name ? t("sheet.portrait", { name, jacket: jacketName(look.jacket).toLowerCase(), headgear: headgearName(look.headgear).toLowerCase() }) : undefined;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`portrait ${className ?? ""}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-jacket={look.jacket}
      data-headgear-id={look.headgear}
    >
      <circle cx="32" cy="32" r="31" fill="#1d3550" />
      <circle cx="32" cy="32" r="30.2" fill="none" stroke="rgba(239,227,198,0.18)" strokeWidth="1.2" />
      <clipPath id={clip}>
        <circle cx="32" cy="32" r="31" />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect x="28" y="36" width="8" height="9" fill={SKIN} />
        <path d="M7 66 Q8 47 24 43 L32 50 L40 43 Q56 47 57 66 Z" fill={jacket} stroke="rgba(0,0,0,0.45)" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M26 43.4 L32 49.4 L38 43.4 Q32 45.6 26 43.4 Z" fill={SHIRT} />
        {/* A jacket: a stand collar open at the throat and a zip down the front. */}
        <path d="M23.4 42.6 L27.8 43.6 L31.4 50.6 L24.6 47.6 Z M40.6 42.6 L36.2 43.6 L32.6 50.6 L39.4 47.6 Z" fill="rgba(255,255,255,0.3)" stroke="rgba(0,0,0,0.4)" strokeWidth="0.9" strokeLinejoin="round" />
        <path d="M32 50.4 L32 66" fill="none" stroke={BRASS} strokeWidth="1.5" />
        <rect x="30.6" y="51.2" width="2.8" height="3.6" rx="0.8" fill={BRASS} stroke="rgba(0,0,0,0.4)" strokeWidth="0.6" />
      </g>
      <circle cx="32" cy="31" r="10.5" fill={SKIN} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
      <circle cx="28.3" cy="31.5" r="1.25" fill="#2a1d14" />
      <circle cx="35.7" cy="31.5" r="1.25" fill="#2a1d14" />
      <path d="M29.5 36 Q32 37.6 34.5 36" fill="none" stroke="#7a3f2a" strokeWidth="1.1" strokeLinecap="round" />
      <Headgear id={look.headgear} />
    </svg>
  );
}
