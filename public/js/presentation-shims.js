// Presentation Mode Shims
// Provides shared globals that view renderers depend on from app.js.
// Loaded before renderer scripts on /presentation route.

function esc(str) {
  return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

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

const PUBLIC_DIVISIONS = [
  { name: 'EXECUTIVE TEAM',         theme: '_exec',     css: 'div-exec' },
  { name: 'TECHNICAL FRUSTRATIONS', theme: 'IT',        css: 'div-it' },
  { name: 'OFFICE CULTURE',         theme: 'Office',    css: 'div-office' },
  { name: 'CORPORATE AFFAIRS',      theme: 'Corporate', css: 'div-corp' },
  { name: 'PUNK OPERATIONS',        theme: 'Punk',      css: 'div-punk' },
  { name: 'INDEPENDENT CONTRACTORS', theme: '_custom',  css: 'div-custom' },
];

const KNOWN_DEPT_THEMES = {};
DEPARTMENTS.forEach(d => { KNOWN_DEPT_THEMES[d.name] = d.theme; });

const BAND_DEPTS = new Set([
  'TICKET ESCALATION BUREAU',
  'AUDIO ENGINEERING DIVISION',
  'DEPT. OF PERCUSSIVE MAINTENANCE',
  'INFRASTRUCTURE & POWER CHORDS',
  'LOW FREQUENCY OPERATIONS',
]);

function getDivisionForDept(deptName, isBandMember) {
  if (isBandMember) return '_exec';
  const theme = KNOWN_DEPT_THEMES[deptName];
  return theme || '_custom';
}

// No-ops for presentation mode — renderers call these but they're not needed on big screen
function initDonut() {}
function showBadgeDetail() {}

// Animations always enabled on presentation display (big screen)
function animationsEnabled() { return true; }

// Shared renderer state
window._publicOrgPage = 1;
window._publicOrgDept = '';
window._tickerStats = {};
window._tickerTotalHires = 0;
