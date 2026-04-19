import { describe, it, expect } from 'bun:test';
import { isVoteBannerActive } from '../src/vote-banner';

const env = (override?: string) => (override === undefined ? {} : { BOM_VOTE_OVERRIDE: override });

describe('isVoteBannerActive', () => {
  describe('override = on', () => {
    it('returns true outside the window', () => {
      expect(isVoteBannerActive(new Date('2026-04-18T12:00:00-05:00'), env('on'))).toBe(true);
    });

    it('returns true during the window', () => {
      expect(isVoteBannerActive(new Date('2026-06-15T12:00:00-05:00'), env('on'))).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isVoteBannerActive(new Date('2026-04-18T12:00:00-05:00'), env('ON'))).toBe(true);
    });
  });

  describe('override = off', () => {
    it('returns false during the window', () => {
      expect(isVoteBannerActive(new Date('2026-06-15T12:00:00-05:00'), env('off'))).toBe(false);
    });

    it('returns false outside the window', () => {
      expect(isVoteBannerActive(new Date('2026-04-18T12:00:00-05:00'), env('off'))).toBe(false);
    });
  });

  describe('override = auto (date window)', () => {
    it('returns false one second before window opens', () => {
      expect(isVoteBannerActive(new Date('2026-05-31T23:59:59-05:00'), env('auto'))).toBe(false);
    });

    it('returns true at the exact window start', () => {
      expect(isVoteBannerActive(new Date('2026-06-01T00:00:00-05:00'), env('auto'))).toBe(true);
    });

    it('returns true mid-window', () => {
      expect(isVoteBannerActive(new Date('2026-06-15T12:00:00-05:00'), env('auto'))).toBe(true);
    });

    it('returns true near the end (June 30 noon CT)', () => {
      expect(isVoteBannerActive(new Date('2026-06-30T12:00:00-05:00'), env('auto'))).toBe(true);
    });

    it('returns false at the exact window end (July 1 midnight CT, exclusive)', () => {
      expect(isVoteBannerActive(new Date('2026-07-01T00:00:00-05:00'), env('auto'))).toBe(false);
    });

    it('returns false well after the window', () => {
      expect(isVoteBannerActive(new Date('2026-08-01T00:00:00-05:00'), env('auto'))).toBe(false);
    });
  });

  describe('override defaulting', () => {
    it('defaults to auto when env var is unset', () => {
      expect(isVoteBannerActive(new Date('2026-04-18T12:00:00-05:00'), env(undefined))).toBe(false);
      expect(isVoteBannerActive(new Date('2026-06-15T12:00:00-05:00'), env(undefined))).toBe(true);
    });

    it('treats garbage values as auto', () => {
      expect(isVoteBannerActive(new Date('2026-04-18T12:00:00-05:00'), env('yes'))).toBe(false);
      expect(isVoteBannerActive(new Date('2026-06-15T12:00:00-05:00'), env('maybe'))).toBe(true);
    });
  });
});
