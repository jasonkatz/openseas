/**
 * What a host or the rules refuse: settings out of their bounds, an entry the round does not allow,
 * a log past its cap. It is the caller's fault, never a bug: a bug throws a plain `Error`.
 */
export class Refused extends Error {
  constructor(
    /** What was refused: `settings`, `entry`, `log` or `round`. */
    readonly what: "settings" | "entry" | "log" | "round",
    readonly reasons: readonly string[],
  ) {
    super(`${what} refused: ${reasons.join("; ")}`);
    this.name = "Refused";
  }
}
