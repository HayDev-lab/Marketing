# Task 25-b — §30 internal Admin view (work record)

## Files built
| File | Action | Content |
|---|---|---|
| src/lib/ai/system-config.ts | CREATE | getSystemConfig/setSystemConfig (30s TTL cache), ADMIN_CONFIG_KEYS, assertRouteAllowed (3 distinct 423 codes) |
| src/app/api/admin/route.ts | CREATE | GET stats+users+systemConfig; POST set_switch_defaults / set_model_blacklist / set_disabled_providers / set_user_admin; all audited "admin.*", 403 NOT_ADMIN gate |
| src/app/api/auth/route.ts | EDIT | isAdmin in register/login/demo payloads |
| src/app/api/auth/me/route.ts | EDIT | isAdmin in session probe user (needed for client after refresh) |
| src/app/api/generate/{image,tts,music}/route.ts | EDIT | assertRouteAllowed right after routeCapability/BLOCKED check, before quota/submit |
| src/app/api/settings/providers/route.ts | EDIT | GET merge: switchDefaults as default when no explicit user row; explicit override wins |
| src/components/modules/settings.tsx | EDIT | AdminTab (stats grid, users mgmt, provider platform switches, model blacklist chips, amber scope note); trigger+content admin-only |
| src/lib/i18n/dicts/admin.ts | EDIT | 38 keys × hy/ru/en (incl. settings.tab.admin), global parity 0×3 |

## Verification
- lint 0; tsc --noEmit (src) 0; dev.log clean
- curl: owner GET /api/admin 200 (real stats); qa4 → 403 NOT_ADMIN
- 423 proof: MODEL_BLOCKED_BY_ADMIN (blacklist image-gen-v2 → POST image 423; cleared → 200 real generation); PROVIDER_DISABLED_BY_ADMIN (platform disable zai-image); PROVIDER_DISABLED (per-user PATCH) — all distinct, all restored after
- SELF_DEMOTE 400 / BAD_ACTION 400; promote/demote qa4 → /api/auth/me isAdmin toggles true/false
- Merge proof: switchDefaults applies only when user has no explicit ProviderConfig row; override wins otherwise
- Browser E2E: owner sees «Ադմին» tab with real stats, switch toggle → toast + server state change; qa4 demo: tab hidden; mobile 390px no horizontal scroll (fixed SelectTrigger whitespace-nowrap overflow); console 0 errors
- Screenshots: /tmp/qa25b-admin-tab.png, /tmp/qa25b-admin-desktop.png, /tmp/qa25b-mobile-admin.png

## Deviations
1. 423 image-route proof used "image-gen-v2" (the model the image route actually resolves) instead of the spec's "video-gen-async" — the guard honestly checks route.modelId.
2. Edited src/app/api/auth/me/route.ts (beyond listed files) — it holds the session-probe user payload; without it isAdmin never reaches the client on refresh.
