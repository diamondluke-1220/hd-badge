// The server's one error-response shape: { success: false, error }.
// Messages stay generic: no internal state, paths or stack traces.

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Answers with { success: false, error: message } and the given HTTP status. */
export function fail(c: Context, status: ContentfulStatusCode, message: string) {
  return c.json({ success: false, error: message }, status);
}
