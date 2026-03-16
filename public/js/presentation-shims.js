// Presentation Mode Stubs
// No-ops for functions that renderers call but aren't needed on the big screen.
// All shared constants/utilities now live in shared.js (loaded first).

function initDonut() {}
function showBadgeDetail() {}

// Animations always enabled on presentation display (big screen)
function animationsEnabled() { return true; }
