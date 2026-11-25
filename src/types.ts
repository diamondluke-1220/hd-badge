// Types shared by the server, the route modules and tests.

import type { BadgeRow } from './db';

/** The badge fields the renderer reads. A full row works; so does a placeholder with only an ID. */
export type RenderableBadge = Pick<BadgeRow, 'employee_id'> & Partial<BadgeRow>;

/** Which variant of a badge to render. */
export interface RenderOptions {
  withPhoto?: boolean;
  print?: boolean;
  klayer?: boolean;
  colorlayer?: boolean;
  calibration?: boolean;
}

export type RenderBadge = (badge: RenderableBadge, options?: RenderOptions) => Promise<Buffer>;

/** Sends one server-sent event to every live-stream client. */
export type BroadcastSSE = (event: string, data: unknown) => void;
