/**
 * What turri throws when a call cannot be made as asked - a broken precondition, never an expected outcome (those are
 * returned). A front end tells them apart by `code`, and recognises one with `isTurriError` rather than `instanceof`:
 * a front end and a package it depends on can each have their own copy of turri installed.
 */

export type TurriErrorCode =
  /** A config.turri.yaml that does not parse: nothing is started on it. */
  | "config-invalid"
  /** Asked of turri but refused: a module that cannot be built as it is, conformance tests turned off, two options that exclude each other. */
  | "refused"
  /** No room for another chat. */
  | "chat-limit"
  /** A chat asked of a session with no front end, which has none. */
  | "no-chat"
  /** A handle to a chat that has been closed. */
  | "chat-closed"
  /** A chat, a job, a notice or a module that is not there. */
  | "not-found"
  /** A front end's session made without turri's extension built into it. */
  | "extension-not-built"
  /** A second session opened in a process that has one open. */
  | "session-open"
  /** Stopped through its signal before it was done. */
  | "aborted";

const BRAND = Symbol.for("turri.error");

export class TurriError extends Error {
  readonly code: TurriErrorCode;

  constructor(code: TurriErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TurriError";
    this.code = code;
  }
}

// The brand any copy of turri recognises, on the prototype - kept out of the class's type.
Object.defineProperty(TurriError.prototype, BRAND, { value: true });

/** Whether `error` is a TurriError - from this copy of turri or another - and, given `code`, one with that code. */
export function isTurriError(error: unknown, code?: TurriErrorCode): error is TurriError {
  if (typeof error !== "object" || error === null || (error as Record<symbol, unknown>)[BRAND] !== true) return false;
  return code === undefined || (error as TurriError).code === code;
}
