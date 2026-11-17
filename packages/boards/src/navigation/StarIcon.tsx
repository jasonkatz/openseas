import { starDataUrl, type StarLook } from "./stars.js";

/** One Navigation star as an image, for a legend or the HUD: the same drawing the chart bakes. */
export function StarIcon(props: StarLook & { size?: number }) {
  const size = props.size ?? 26;
  const { shape, color, cut, hollow } = props;
  return <img src={starDataUrl({ shape, color, cut, hollow: hollow === true }, size)} width={size} height={size} alt="" aria-hidden="true" className="tile-icon" draggable={false} />;
}
