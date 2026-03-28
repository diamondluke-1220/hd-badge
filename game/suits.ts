// Suit system for Help Desk Card Battler — Executive Edition
// Suits are orthogonal to card type (attack/skill/power).
// Combat reads type+effects. Scoring reads suit+rank.
// Four flavors of corporate dysfunction.

export type Suit = 'tickets' | 'bureaucracy' | 'meetings' | 'orgchart';

export const SUITS: Suit[] = ['tickets', 'bureaucracy', 'meetings', 'orgchart'];

export const SUIT_LABELS: Record<Suit, string> = {
  tickets: '🎫 Tickets',
  bureaucracy: '📋 Bureaucracy',
  meetings: '🗓️ Meetings',
  orgchart: '👔 Org Chart',
};

export const SUIT_FLAVOR: Record<Suit, string> = {
  tickets: 'I control the queue. Your problem is now a number.',
  bureaucracy: 'The rules exist to serve me. Compliance is mandatory.',
  meetings: 'Nothing happens without my calendar invite.',
  orgchart: 'I decide who stays and who updates their LinkedIn.',
};
