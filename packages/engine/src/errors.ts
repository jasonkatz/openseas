/** Thrown by every engine's reducer on an illegal move. The server maps it to `illegal_move`. */
export class InvalidMoveError extends Error {
  constructor(
    message: string,
    readonly move: unknown,
  ) {
    super(message);
    this.name = "InvalidMoveError";
  }
}
