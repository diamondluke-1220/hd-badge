# Frontend Deep-Dive Audit Plan

## Overview

Systematic audit of 7 frontend JS files (~7,875 lines total) focusing on XSS risk, memory leaks, animation cleanup, and SSE reconnect edge cases.

## Files by Priority

| Priority | File | Lines | innerHTML Count | Key Risks |
|----------|------|-------|----------------|-----------|
| 1 | app.js | 1,430 | ~14 | Highest innerHTML count, form handling, global state |
| 2 | view-reviewboard.js | 1,667 | ~4 | Largest file, animation lifecycle, DOM rebuilds |
| 3 | live-viz.js | 890 | ~8 | SSE reconnect edge cases, animation cleanup |
| 5 | view-arcade.js | 874 | ~4 | Timer cleanup on view destroy |
| 6 | arcade-cinematic.js | 936 | ~6 | setTimeout/setInterval cleanup |
| 7 | shared.js / badge-pool.js / badge-render.js | ~403 | ~2 | Low risk — constants and rendering |

## Focus Areas

### 1. innerHTML XSS Categorization

For each innerHTML assignment, classify as:

- **Static HTML** (safe) — hardcoded template strings with no variables
- **Server data** (review) — data from API responses (employee_id, name, department)
- **User input** (critical) — directly from form fields or URL params

Action: Convert all "user input" cases to `textContent` or DOM API. Review server data cases for injection vectors.

### 2. Animation Cleanup on View Switch

Each view module has a `destroy()` function. Verify:

- All `setTimeout` IDs tracked and cleared via `clearTimeout`
- All `setInterval` IDs tracked and cleared via `clearInterval`
- All `requestAnimationFrame` IDs tracked and cleared via `cancelAnimationFrame`
- All DOM event listeners added by the view are removed
- All CSS animations/transitions stopped (not just hidden)

### 3. SSE Reconnect Edge Cases

**live-viz.js** and **presentation.js** manage SSE connections:

- Verify reconnect uses exponential backoff (not immediate retry flood)
- Check for stale state when reconnecting (old badge data from prior session)
- Verify connection cleanup on page unload/visibility change
- Check for duplicate event handlers after reconnect

## Execution Plan

### Session 1: app.js (~45 min)
- Catalog all 14 innerHTML assignments
- Classify each as static/server/user
- Audit form handling and state management
- Check for event listener leaks

### Session 2: view-reviewboard.js (~30 min)
- Animation lifecycle verification
- View destroy() completeness check
- Split-flap DOM rebuild efficiency

### Session 3: live-viz.js + presentation.js (~45 min)
- SSE connection management audit
- Reconnect backoff verification
- Animation cleanup
- Stock ticker memory profile

### Session 4: view-arcade.js + arcade-cinematic.js (~45 min)
- Timer cleanup audit (setTimeout/setInterval)
- Fight animation lifecycle
- Boss portrait loading/cleanup
- View destroy() completeness

## Output

Each session produces:
- List of findings with severity (Critical / High / Medium / Low)
- Specific line numbers and fix recommendations
- Updated innerHTML classification table
