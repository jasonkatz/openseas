import { useId } from "react";
import type { PirateLookWire } from "@openseas/protocol";
import { t } from "@openseas/boards";
import { jacketHex, jacketName, headgearName } from "./look.js";

const FELT = "#2a2420";
const FELT_EDGE = "#14100d";
const SKIN = "#e0a27a";
const SHIRT = "#efe3c6";

/** Each headgear is its own outline, as on deck, so a look reads without its colors (rule 6). */
function Headgear({ id }: { id: string }) {
  switch (id) {
    case "bubble-helmet":
      // Seen from the front: one corner pointing at you, one out to each side, the back brim turned up behind.
      return (
        <g data-headgear="bubble-helmet">
          <path d="M6 17.5 L19 10.5 Q32 6.5 45 10.5 L58 17.5 L32 27.5 Z" fill={FELT} stroke={FELT_EDGE} strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M9.5 18 L32 25.6 L54.5 18" fill="none" stroke="#d4a548" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    case "goggles":
      return (
        <g data-headgear="goggles">
          <path d="M5 23 Q32 -3 59 23 Q32 15 5 23 Z" fill={FELT} stroke={FELT_EDGE} strokeWidth="1.2" strokeLinejoin="round" />
          <circle cx="32" cy="14.5" r="2.6" fill="#d4a548" stroke={FELT_EDGE} strokeWidth="0.8" />
        </g>
      );
    case "wide-brim":
      return (
        <g data-headgear="wide-brim">
          <path d="M22 22 L23.5 10.5 Q32 7.5 40.5 10.5 L42 22 Z" fill={FELT} stroke={FELT_EDGE} strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M22.6 17.5 Q32 16 41.4 17.5 L41.8 20.6 Q32 19.2 22.2 20.6 Z" fill="#8a5a33" />
          <path d="M5 23 Q32 15 59 23 Q32 29 5 23 Z" fill={FELT} stroke={FELT_EDGE} strokeWidth="1.2" strokeLinejoin="round" />
        </g>
      );
    case "beanie":
      return (
        <g data-headgear="beanie">
          <path d="M20.5 22 Q19 8.5 33 8 Q46 8 52 21 L47.5 23 Q45 16.5 40 15.5 Q43 18.5 43.5 22 Z" fill={FELT} stroke={FELT_EDGE} strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M20 25 Q32 28 44 25 L44 20.5 Q32 23.5 20 20.5 Z" fill="#5a4d43" stroke={FELT_EDGE} strokeWidth="1" strokeLinejoin="round" />
          <circle cx="50.5" cy="23.5" r="3.6" fill="#c94a3d" stroke={FELT_EDGE} strokeWidth="0.9" />
        </g>
      );
    default:
      return (
        <g data-headgear="flight-cap">
          <path d="M21 23 L21.5 14.5 Q32 10.5 42.5 14.5 L43 23 Q32 25.5 21 23 Z" fill={FELT} stroke={FELT_EDGE} strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M22 15.2 Q32 11.8 42 15.2" fill="none" stroke="rgba(239,227,198,0.25)" strokeWidth="1.2" strokeLinecap="round" />
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
        <path d="M24 43 L32 50 L40 43 Q32 46 24 43 Z" fill={SHIRT} />
        <path d="M24 43 L32 57 L28.5 44.2 Z M40 43 L32 57 L35.5 44.2 Z" fill="rgba(0,0,0,0.28)" />
        <circle cx="32" cy="59.5" r="1.5" fill="#d4a548" />
        <circle cx="32" cy="64" r="1.5" fill="#d4a548" />
      </g>
      <circle cx="32" cy="31" r="10.5" fill={SKIN} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
      <circle cx="28.3" cy="31.5" r="1.25" fill="#2a1d14" />
      <circle cx="35.7" cy="31.5" r="1.25" fill="#2a1d14" />
      <path d="M29.5 36 Q32 37.6 34.5 36" fill="none" stroke="#7a3f2a" strokeWidth="1.1" strokeLinecap="round" />
      <Headgear id={look.headgear} />
    </svg>
  );
}
