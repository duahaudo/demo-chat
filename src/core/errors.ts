/**
 * Error classification and retry policy.
 *
 * Classified once, here, so the adapter, the hooks and the UI all agree on what an error means and
 * what may be done about it (TECHNICAL-DESIGN §3.3). Pure: no framework, no I/O, no clock — the
 * caller supplies elapsed time and randomness, which is why the backoff is testable.
 */

export type ErrorClass =
  /** Worth retrying automatically, bounded, with backoff. */
  | 'transient'
  /** Retrying changes nothing. Needs the user to act. */
  | 'permanent'
  /** The stream contradicted the protocol: unreadable frame, impossible payload. */
  | 'protocol'
  /** The failure never reached the network: offline, DNS, blocked request. */
  | 'local'
  /** The user or the app stopped it. Not a failure, and never retried. */
  | 'cancelled';

/** What went wrong, described at the point it is known. */
export type ErrorInput =
  /** A response with a status. `retryAfterSeconds` comes from the `Retry-After` header. */
  | {
      readonly kind: 'http';
      readonly status: number;
      readonly code?: number | string | undefined;
      readonly message?: string | undefined;
      readonly retryAfterSeconds?: number | undefined;
    }
  /** A frame the parser could not honour, or an error carried inside the stream body. */
  | {
      readonly kind: 'protocol';
      readonly reason: string;
      readonly code?: number | string | undefined;
    }
  /** Something thrown: an `AbortError`, a `fetch` `TypeError`, anything else. */
  | { readonly kind: 'thrown'; readonly cause: unknown };

export interface ClassifiedError {
  readonly class: ErrorClass;
  /** Whether an automatic retry is allowed at all. `false` for permanent, local and cancelled. */
  readonly retryable: boolean;
  /**
   * Ceiling on automatic attempts after the first, when `retryable`. A 500 is retried once —
   * a provider that answered with a broken response twice is not having a blip.
   */
  readonly maxRetries: number;
  readonly status: number | undefined;
  readonly code: number | string | undefined;
  /** What happened and what to do. Sentence case, no apology (DESIGN-SYSTEM §7). */
  readonly summary: string;
  /** Server-directed wait, when one was given. Overrides computed backoff. */
  readonly retryAfterMs: number | undefined;
}

/** Retries for a blip. Bounded so a persistent outage still surfaces. */
const TRANSIENT_RETRIES = 3;
/** Retries for a server error: once, then it is the provider's problem, not ours to hammer. */
const SERVER_ERROR_RETRIES = 1;

/** `AbortController` surfaces as a `DOMException` named `AbortError`; environments vary. */
export function isAbortError(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const name = (value as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

function fromStatus(input: Extract<ErrorInput, { kind: 'http' }>): ClassifiedError {
  const { status, code, retryAfterSeconds } = input;
  const retryAfterMs =
    typeof retryAfterSeconds === 'number' &&
    Number.isFinite(retryAfterSeconds) &&
    retryAfterSeconds >= 0
      ? Math.round(retryAfterSeconds * 1000)
      : undefined;

  const base = { status, code: code ?? status, retryAfterMs } as const;

  // 408, 429 and 504 are the transient boundary the design names (implement-plan §5).
  if (status === 408 || status === 504) {
    return {
      ...base,
      class: 'transient',
      retryable: true,
      maxRetries: TRANSIENT_RETRIES,
      summary: input.message ?? 'The provider timed out. Retrying.',
    };
  }

  if (status === 429) {
    return {
      ...base,
      class: 'transient',
      retryable: true,
      maxRetries: TRANSIENT_RETRIES,
      summary: input.message ?? 'Rate limited. Waiting before the next attempt.',
    };
  }

  if (status >= 500) {
    // 500 is retried once. 502 and 503 read the same way from here and are treated alike.
    return {
      ...base,
      class: 'transient',
      retryable: true,
      maxRetries: SERVER_ERROR_RETRIES,
      summary: input.message ?? 'The provider failed to answer. Retrying once.',
    };
  }

  if (status === 401 || status === 403) {
    return {
      ...base,
      class: 'permanent',
      retryable: false,
      maxRetries: 0,
      summary: input.message ?? 'The API key was rejected. Check the key in settings.',
    };
  }

  if (status === 402) {
    return {
      ...base,
      class: 'permanent',
      retryable: false,
      maxRetries: 0,
      summary: input.message ?? 'The account is out of credit. Add credit or use your own key.',
    };
  }

  if (status >= 400) {
    return {
      ...base,
      class: 'permanent',
      retryable: false,
      maxRetries: 0,
      summary: input.message ?? 'The request was rejected. Edit the message and send it again.',
    };
  }

  // A 1xx/2xx/3xx reaching this function means the transport disagreed with itself.
  return {
    ...base,
    class: 'protocol',
    retryable: false,
    maxRetries: 0,
    summary: input.message ?? 'The response did not follow the streaming protocol.',
  };
}

/**
 * Classify a failure into exactly one class, with the retry policy that goes with it.
 *
 * Total: never throws, and returns a class for every input, including a thrown value of an
 * unexpected shape.
 */
export function classifyError(input: ErrorInput): ClassifiedError {
  if (input.kind === 'http') return fromStatus(input);

  if (input.kind === 'protocol') {
    return {
      class: 'protocol',
      retryable: false,
      maxRetries: 0,
      status: undefined,
      code: input.code,
      summary: input.reason,
      retryAfterMs: undefined,
    };
  }

  const { cause } = input;

  if (isAbortError(cause)) {
    return {
      class: 'cancelled',
      retryable: false,
      maxRetries: 0,
      status: undefined,
      code: undefined,
      summary: 'Stopped.',
      retryAfterMs: undefined,
    };
  }

  // `fetch` rejects with a TypeError for every network-level failure: offline, DNS, CORS, blocked.
  const isNetwork = cause instanceof TypeError;

  return {
    class: 'local',
    retryable: false,
    maxRetries: 0,
    status: undefined,
    code: undefined,
    summary: isNetwork
      ? 'The request never left the browser. Check the connection and try again.'
      : 'Something failed before a response arrived. Try again.',
    retryAfterMs: undefined,
  };
}

/** Backoff shape. Exponential from `baseMs`, capped, with full jitter. */
export interface BackoffPolicy {
  readonly baseMs: number;
  readonly capMs: number;
}

const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 500, capMs: 8000 };

/**
 * Delay before retry `attempt` (1-based).
 *
 * Full jitter: `random` in `[0, 1)` scales the whole exponential window, so retrying clients
 * spread out instead of arriving together. Randomness is a parameter because core has no
 * source of its own — that is what makes this assertable.
 *
 * A server-directed `retryAfterMs` on the classified error wins outright; jitter is not applied
 * to an instruction.
 */
export function retryDelayMs(
  attempt: number,
  random: number,
  error?: ClassifiedError,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
): number {
  if (error?.retryAfterMs !== undefined) return error.retryAfterMs;

  const step = Math.max(1, Math.floor(attempt));
  const window = Math.min(policy.capMs, policy.baseMs * 2 ** (step - 1));
  const jitter = Math.min(Math.max(random, 0), 1);
  return Math.round(window * jitter);
}
