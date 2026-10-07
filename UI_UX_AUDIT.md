# UI/UX audit — HayDev Marketing
Date: 2026-10-07. Scope: repository source, build, local HTTP/API checks. Visual browser audit remains unavailable: the browser cannot access this execution environment’s localhost.

## Current UI map
Single `/` route hosts persisted view navigation. Original 16 modules: dashboard, brands, trends, planner, content, prompts, image, video, voice, music, avatar, publishing, analytics, settings, admin, MCP. 52 API route files before migration; 53 after adding authenticated asset listing.

## Findings
- Wide navigation exposes all studios and infrastructure tools at once. Duplicate Autopilot controls alter persisted client mode without persisting the policy.
- Dashboard mixes spend, sources, actions, scheduling and jobs; many similar cards compete for attention.
- AppShell eagerly imports every studio; login also imports its shell. Ambient WebGL was mounted on every workspace and on login.
- Dashboard swallows loading errors; legacy components contain untranslated API labels, explanatory strings and errors.
- Mobile originally relies on a slide-out wide sidebar. No complete viewport audit exists.
- Primary fuchsia styling, multicolour gradients, hover elevation and glow compete with actual statuses. Contrast was not measured before migration.
- WebGL reduced-motion interval originally retains a context, and cleanup omitted shader/program deletion. Canvas does not intercept pointer events.
- Original TypeScript config includes optional socket.io examples missing dependencies; Next was configured to ignore all type errors.
- Publishing connections report BLOCKED_EXTERNAL; billing uses an explicitly labelled sandbox plan switch; avatar adapter has no implemented generate call. SMTP uses dev_inline reset delivery. These are blockers, not successful integrations.
- Legacy auth supports session tokens in localStorage and token URLs for private media in cross-site previews. No new key storage is introduced by this redesign; production security review remains necessary.

## Function classification
Auth, brands, drafts, approvals, subscription usage, settings, budget policies and jobs have database-backed APIs. Registration and read APIs verified locally. Image/video/TTS/search/analysis require provider access and are NOT live-verified in this environment. Avatar, direct publishing and real billing are externally blocked or incomplete. Music supports uploads/local assembly; external generation needs credentials.

## Migration
Retain existing modules and APIs while relocating them into Create/Settings. Replace Home. Introduce scoped WebGL, lazy module loading, authenticated assets and server-persisted Autopilot controls. Preserve original stored view IDs and trend/content handoff. Do not claim full visual acceptance, direct publishing or full Golden Path success without evidence.
