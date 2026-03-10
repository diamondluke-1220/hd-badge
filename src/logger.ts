// Help Desk Badge App — In-Memory Ring Buffer Logger
// Stores last 200 log entries for admin dashboard troubleshooting

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
}

const MAX_ENTRIES = 200;
const buffer: LogEntry[] = [];

export function log(level: LogLevel, category: string, message: string) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
  };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) {
    buffer.shift();
  }
  // Also write to console for Docker logs
  const prefix = level === 'error' ? '!!' : level === 'warn' ? '!!' : '::';
  console.log(`${prefix} [${category}] ${message}`);
}

export function getLog(): LogEntry[] {
  return [...buffer].reverse();
}

export function clearLog() {
  buffer.length = 0;
}
