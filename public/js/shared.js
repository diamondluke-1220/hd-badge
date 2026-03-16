// ─── Shared Constants & Utilities ─────────────────────────
// Loaded before all view renderers and app.js on both
// index.html and presentation.html pages.

/** HTML-escape a string for safe insertion */
function esc(str) {
  return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Fan departments (11 options)
const DEPARTMENTS = [
  { name: 'PRINTER JAMS',                  theme: 'IT' },
  { name: 'PASSWORD RESET SERVICES',       theme: 'IT' },
  { name: 'BLUE SCREEN RESPONSE TEAM',     theme: 'IT' },
  { name: 'WATERCOOLER SERVICES',           theme: 'Office' },
  { name: 'MEETING RECOVERY DEPT.',        theme: 'Office' },
  { name: 'MANDATORY FUN COMMITTEE',       theme: 'Corporate' },
  { name: 'MORALE SUPPRESSION UNIT',       theme: 'Corporate' },
  { name: 'TEAM BUILDING AVOIDANCE',       theme: 'Corporate' },
  { name: 'MOSH PIT HR',                   theme: 'Punk' },
  { name: 'ENTERPRISE GUITAR WORSHIP',     theme: 'Punk' },
  { name: 'STAGE DIVE RISK ASSESSMENT',    theme: 'Punk' },
];

// Org chart division groupings
const PUBLIC_DIVISIONS = [
  { name: 'EXECUTIVE TEAM',         theme: '_exec',     css: 'div-exec' },
  { name: 'TECHNICAL FRUSTRATIONS', theme: 'IT',        css: 'div-it' },
  { name: 'OFFICE CULTURE',         theme: 'Office',    css: 'div-office' },
  { name: 'CORPORATE AFFAIRS',      theme: 'Corporate', css: 'div-corp' },
  { name: 'PUNK OPERATIONS',        theme: 'Punk',      css: 'div-punk' },
  { name: 'INDEPENDENT CONTRACTORS', theme: '_custom',  css: 'div-custom' },
];

// Department → division theme lookup
const KNOWN_DEPT_THEMES = {};
DEPARTMENTS.forEach(d => { KNOWN_DEPT_THEMES[d.name] = d.theme; });

// Band member exclusive departments (not selectable by fans)
const BAND_DEPTS = new Set([
  'TICKET ESCALATION BUREAU',
  'AUDIO ENGINEERING DIVISION',
  'DEPT. OF PERCUSSIVE MAINTENANCE',
  'INFRASTRUCTURE & POWER CHORDS',
  'LOW FREQUENCY OPERATIONS',
]);

/** Map a department name to its division theme */
function getDivisionForDept(deptName, isBandMember) {
  if (isBandMember) return '_exec';
  const theme = KNOWN_DEPT_THEMES[deptName];
  return theme || '_custom';
}

// Division accent colors — vivid neon for dark-background views (renderers)
const DIVISION_ACCENT_COLORS = {
  '_exec':     '#ffffff',
  'IT':        '#00d4ff',
  'Office':    '#ff3366',
  'Corporate': '#ff6b35',
  'Punk':      '#00ff41',
  '_custom':   '#ffd700',
};

// Shared renderer state (accessed by renderers via window._)
window._publicOrgPage = 1;
window._publicOrgDept = '';
window._tickerStats = {};
window._tickerTotalHires = 0;

/** Common renderer stats initialization — call in each renderer's init() */
function initRendererStats(stats) {
  window._tickerTotalHires = stats.visible || 0;
  if (stats.byDepartment) {
    window._tickerStats = Object.assign({}, stats.byDepartment);
  }
  initDonut(stats);
}
