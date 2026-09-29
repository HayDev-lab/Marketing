# ՀայDev Marketing — Worklog

Product: ՀայDev Marketing — cloud-first AI Marketing Operating System
Source spec: /home/z/my-project/upload/HayDev_Marketing_Master_Prompt_Pack.txt
Environment constraints (sandbox):
- Next.js 16 App Router, TypeScript, single user-visible route `/` (SPA-style views)
- SQLite via Prisma (not Postgres) — file db/custom.db
- AI via z-ai-web-dev-sdk (backend only): LLM, VLM, TTS, ASR, IMAGE_GEN/EDIT, async VIDEO + polling, WEB_SEARCH, PAGE_READER
- No real social-platform API credentials → publishing adapters honest status NOT_AVAILABLE / DRAFT_TRANSFER_ONLY
- Google OAuth: BLOCKED_EXTERNAL (no credentials); Email+Password auth implemented
- Voice cloning / avatar / music cloud providers: adapter layer present, status IMPLEMENTED_NOT_LIVE_VERIFIED / BLOCKED_EXTERNAL (no external keys)

---
Task ID: 0
Agent: main
Task: PHASE 0 audit + baseline

Work Log:
- Read full master prompt pack (92 sections)
- Audited repo: fresh Next.js 16 scaffold, shadcn/ui full set, Prisma+SQLite, z-ai-web-dev-sdk 0.0.18
- Inspected SDK d.ts: chat.completions, vision, tts, asr, images.generations/edit/search, video.generations (async id) + async.result.query, functions.invoke(web_search/page_reader)

Stage Summary:
- Baseline clean. No duplicate subsystems. Proceeding to PHASE 1 foundation.
- Architecture decision: Application core = /src/lib (auth, ai registry, jobs engine, ledger, audit, i18n, platform rules), API routes = /api/*, UI = single-page shell at `/` with view registry components. Three interfaces (Web UI, Autopilot, MCP) call the same core services.

---
Task ID: 2-a
Agent: full-stack-developer
Task: Brand Intelligence modules (Brands/Trends/Planner)

Work Log:
- Read worklog, use-i18n/store patterns, dashboard reference module, and verified all target API routes (brands, brands/[id], analyze, facts, trends, trends/[id], plans/marketing, plans/content) against actual route implementations + Prisma schema
- Implemented BrandsModule (src/components/modules/brands.tsx): brand cards grid (name, stage badge DRAFT/ANALYZED/READY color-coded, website, facts/content counts) with set-as-active via useApp.setActiveBrand; 4-step create wizard dialog (name+description → website with http(s) hint+client validation → extra materials+social profiles → review + "Run Business Analyzer" CTA + "Create without analysis" fallback) with step Progress bar; on create POST /api/brands → optional POST /api/brands/[id]/analyze with extraContext, pulseCore(ANALYZING→SUCCESS/ERROR), setActiveBrand + onBrandsChanged(); detail view = Brand Profile (summary, positioning, tone, USP/opportunities/risks/content-opportunities color-coded chips, profile version badge) + Business Facts grouped by kind SOURCE_FACT (emerald, provenance link target=_blank)/AI_INFERENCE (fuchsia)/USER_PROVIDED (amber), add-fact inline form with category select, delete fact, re-run analyzer with spinner
- Implemented TrendsModule (src/components/modules/trends.tsx): search form (brand select synced to activeBrandId + /api/brands, niche, region, language select defaulting to locale) → POST /api/trends with pulseCore(TREND_SEARCH→SUCCESS/ERROR) + toast with found count; trend cards with color-coded status badges (VERIFIED_TREND emerald / POPULAR_TOPIC amber / EMERGING_SIGNAL fuchsia / HYPOTHESIS muted), platform badge, confidence %, brandFit progress bar + reason, suggested adaptation block, risk warning (role=alert), external source link, "Adapt to brand" → PATCH /api/trends/[id] {action:"adapt",language} with pulseCore(GENERATING) and expandable concept/hook/script panel with per-field copy buttons; initial GET /api/trends on mount with skeletons + empty state
- Implemented PlannerModule (src/components/modules/planner.tsx): brand selector (writes back to store), "Generate marketing plan" POST /api/plans/marketing with pulseCore(PLANNING), plan header (version, DRAFT/APPROVED badge, approve → PATCH status APPROVED); 9 editable section cards (objectives, pillars, channels, funnel, weekly table, monthly, kpis, experiments, campaigns) with JSON-lite line-per-item editing (columns split by |, e.g. "name | share% | description"), per-section codec layer incl. campaigns→campaignIdeasJson field mapping, lock/unlock per section (PATCH lockSection/unlockSection), 423 SECTION_LOCKED surfaced via toast err.message; content plan section: POST /api/plans/content {brandId, language} (pulseCore PLANNING), blueprint item cards (day/platform/contentType badges, hook, pillar/goal) with "Create content item" → PATCH /api/plans/content {id,itemIndex}, refresh GET content plans, local created-marks disable button
- Added i18n keys to my three dict files (brands/trends/planner), full parity across hy/ru/en (~90 keys per namespace); every visible string via t(), Armenian/Russian translations written natively; common.* keys reused from core dict
- Verified: bun run lint → 0 errors (warnings only in other agents' files), bunx tsc --noEmit → no errors in my files, dev server compiles + GET / returns 200, automated key-existence check: no missing keys, identical key sets across locales

Stage Summary:
- BrandsModule, TrendsModule, PlannerModule fully implemented as exclusive files (brands.tsx, trends.tsx, planner.tsx) + dict files brands.ts/trends.ts/planner.ts; no other files touched
- API routes consumed (all existing, none recreated): GET/POST /api/brands, GET /api/brands/[id], POST /api/brands/[id]/analyze, GET/POST/DELETE /api/brands/[id]/facts, GET/POST /api/trends, PATCH /api/trends/[id], GET/POST/PATCH /api/plans/marketing, GET/POST/PATCH /api/plans/content; no new API routes needed
- Design: glass/neon-border/neon-text/scrollbar-thin utilities, only var(--neon)/--neon-2/--neon-3 accents (fuchsia/emerald/amber, no blue), p-4/p-6 cards, max-h-64/96 scroll lists, motion fade/slide entries, Loader2 spinners + Skeletons, sonner toasts with err.message, h-10/h-11 touch targets, aria-labels on icon buttons, role=alert/note for errors/hints, responsive sm:/lg: collapses
- Issues: server-side analysis errors (e.g. NOTHING_TO_ANALYZE, UNSAFE_URL) are surfaced via toast description err.message as specified; brand creation is not rolled back if the follow-up analyze call fails (brand remains, error shown) — intentional so user can retry "Re-run analyzer"
---
Task ID: 2-b
Agent: full-stack-developer
Task: Generation studios (Image/Video/Voice/PromptLibrary)

Work Log:
- Read worklog, use-i18n/store/dashboard patterns, registry; audited backend contracts (/api/generate/image|video|tts, /api/prompts(+/compile), /api/jobs, ledger 402 codes DAILY_BUDGET_EXCEEDED/MONTHLY_BUDGET_EXCEEDED)
- Wrote studio.ts i18n dict: 147 keys × hy/ru/en, parity-verified via script (0 missing), namespaced studio.{err,copilot,img,vid,voc,pr}.*
- Created /api/video-projects route: GET (list with _count, or ?id= single with scenes, ownership check mirroring generate/video), PATCH {sceneId prompt / reset:true for regenerate (version+1, retries+1) / scenes reorder / title,script,characterBible,styleBible} with audit logging
- image-studio.tsx: idea textarea → Prompt Copilot panel (optimizedPrompt + whyChosen + estimatedCost + "Use this prompt"), editable final prompt, visual aspect selector (mini-ratio shapes 1:1/9:16/3:4/16:9/4:3), reference picker from localStorage-persisted recent gallery ("use as reference" via assetId), generate → result card with provider/model/routedBecause metadata + download; reads "haydev-prompt-to-studio" hand-off key; pulseCore GENERATING/SUCCESS/ERROR; 402 budget toasts
- video-studio.tsx: project list + create form (duration 15/30/60 cards, aspect visual cards, language select via localeLabels, brand from activeBrandId, brief) → create_project autoShotPlan; editor: script panel with regenerate (generate_script), scenes horizontal strip (editable prompt via PATCH, per-scene Generate/regenerate-with-reset, polling GET /api/jobs/[id] every 6s with 1s elapsed display, Resume/Cancel on FAILED jobs), timeline summary bar (✓/⟳/✗/· chips + est. total cost), Character/Style Bible key:value editors saved via PATCH; auto-reopens last project (localStorage) and resumes polling for in-flight GENERATING scenes; reads "haydev-prompt-to-video" hand-off
- voice.tsx: TTS composer (2000-char counter, list_voices selector, speed slider 0.5–2), audio result + recent list (localStorage), save_voice_profile dialog + local profiles list, honest BLOCKED_EXTERNAL status cards for Music (elevenlabs) and Avatar (heygen) with raw registry statusNote + localized explanation + disabled inputs
- prompt-library.tsx: debounced search + niche chips + All/Image/Video segmented toggle + favorites filter, template cards (niche/type/custom badges, line-clamp-3 preview, favorite toggle optimistic, duplicate, copy), detail dialog with {{variable}} neon highlighting + variables list + "Open in Image/Video Studio" hand-off (setView), create-custom dialog (niche/type/title/body)
- Verified: eslint on my 6 files → 0 problems; tsc --noEmit → 0 errors in my files (remaining errors pre-exist in other agents' files); /api/video-projects smoke-tested → 401 envelope; dev.log compiles clean

Stage Summary:
- Implemented: ImageStudioModule, VideoStudioModule, VoiceModule, PromptLibraryModule + studio dict (147 keys × 3 locales) + new GET/PATCH /api/video-projects route
- API used: POST /api/generate/image, POST /api/generate/video (create_project/generate_script/generate_scene), GET+POST /api/jobs(/id), POST /api/generate/tts (list_voices/generate/save_voice_profile), GET+POST+PATCH /api/prompts, POST /api/prompts/compile, GET /api/assets/[id]/raw, new /api/video-projects
- Patterns: glass/glass-strong/neon-border/neon-text/scrollbar-thin, motion transitions, Skeleton loading, sonner toasts (402-specific), min-h-11 touch targets, aria-labels, localStorage hand-off keys haydev-prompt-to-studio / haydev-prompt-to-video
- Issues: regenerate of COMPLETED scene needs explicit reset (added reset:true to PATCH route); list_voices has no GET → used POST action; scene-video <video> relies on job reconciliation syncing scene.assetId server-side
---
Task ID: 3
Agent: full-stack-developer
Task: Content pipeline + Publishing + Analytics + Settings + MCP modules

Work Log:
- Read worklog, use-i18n/store patterns, dashboard example, platform-rules, transition state machine, all relevant API routes (content, schedule, publishing/connections, analytics, settings/providers, autopilot, audit, costs, mcp/tokens), Prisma schema models
- Filled i18n dicts (hy/ru/en, same export shape): publishing.ts (content.* 60+ keys + publishing.* 50+ keys), NEW analytics.ts (analytics.* 33 keys), settings.ts (settings.* 50 keys), mcp.ts (mcp.* 55 keys), autopilot.ts (autopilot.* 60 keys); verified every used key defined ×3 locales via scripted cross-check
- Minimal edit to src/lib/i18n/index.ts: appended analytics import + added `analytics` to MODULES array (nothing else touched)
- content.tsx: state chips with live counts (8 states), brand scope select (init from activeBrandId), search, responsive card grid with color-coded state badges (emerald=approved, amber=review, red=problem, fuchsia=scheduled), detail dialog with full editable fields (title/hook/caption/hashtags/script/platform/language/type), Save via PATCH with approval-invalidation notice when APPROVED→CHANGES_REQUESTED (version shown), approval action buttons per state machine (submit→approve/request-changes/back-to-draft), approval history timeline (GET transition), asset preview img/video/audio from /api/assets/{id}/raw + videoProject scene list, delete with AlertDialog confirm
- publishing.tsx: 4 platform connection cards with honest mode badges + per-mode explanations, Connect dialog → POST → amber BLOCKED_EXTERNAL alert with reason + requiredSetup (never fakes Connected), Disconnect for real connections; scheduled posts list with status accents, preflight issue display (red), cancel/reschedule (datetime-local guards), "Attempt publish now" → honest USER_ACTION_REQUIRED panel with export caption + media download link; schedule dialog fed by GET /api/content?state=APPROVED with platform select, datetime-local, timezone (Asia/Yerevan default) → POST shows preflight result
- analytics.tsx: 6 aggregate metric cards (views/likes/comments/shares/saves/clicks) + engagement %, per-post engagement bar list grouped from snapshots, manual entry form (POST /api/analytics) with always-visible MANUAL_ENTRY honest note, OBSERVED_DATA vs AI_INTERPRETATION learning panel
- settings.tsx: Tabs Providers/Autopilot/Audit/Budget. Providers grouped by category (10 categories), status badges with statusNote tooltips (LIVE_VERIFIED emerald / IMPLEMENTED_NOT_LIVE_VERIFIED amber / DEGRADED red / BLOCKED_EXTERNAL muted+disabled switch), enable/disable switch with 423 BLOCKED_EXTERNAL honest error toast, health check button → newStatus + latency toast. Autopilot: full policy form (8 switches with descriptions, 7 budget/limit numbers, platform+language chips, forbidden topics/claims comma inputs), save via PATCH (arrays as platforms/languages/forbiddenTopics/forbiddenClaims), "Run one supervised cycle" with brand select → steps timeline + humanApprovalRequired note (or honest warning when gate off), recent cycles list. Audit: actorType chips (All/WEB_UI/MCP/AUTOPILOT/SYSTEM) + scrollable log. Budget: today/week/month/total progress bars vs autopilot policy limits + byProvider/byCapability breakdowns
- mcp.tsx: explanation card (POST /api/mcp, JSON-RPC 2.0, IMPLEMENTED_NOT_LIVE_VERIFIED badge, honest note), token create form (name, 4 presets with descriptions, paid/schedule/publish toggles, maxSpend) → raw token shown ONCE in copyable highlighted box with "copy now" warning, token list (prefix only, preset badges, capability chips, lastUsedAt, revoke), static tool registry grouped by preset requirement (READ_ONLY/CREATE_DRAFTS/EXECUTE_GENERATIONS/PUBLISH_ALLOWED) as compact mono badges
- Fixed lint react-hooks/set-state-in-effect in Audit/Budget tabs (promise-callback setState + reloadKey pattern); removed date input RangeError risk with isNaN guards

Stage Summary:
- Implemented all 5 modules (content/publishing/analytics/settings/mcp) + 5 dict files + 1-line-scope index.ts analytics addition. Only owned files touched.
- APIs used: /api/content(+[id],+transition), /api/publishing/connections (GET/POST/PATCH), /api/schedule (GET/POST/PATCH cancel|reschedule|attempt_publish), /api/analytics (GET/POST), /api/settings/providers (GET/PATCH/POST), /api/autopilot (GET/PATCH/POST), /api/audit, /api/costs, /api/mcp/tokens (GET/POST/PATCH), /api/brands, /api/assets/[id]/raw
- Honesty rules enforced: no fake Connected/Published anywhere; BLOCKED_EXTERNAL connect result surfaced in amber alert; attempt_publish always renders USER_ACTION_REQUIRED + export package; MANUAL_ENTRY note on analytics; provider BLOCKED_EXTERNAL switch disabled with tooltip; MCP badge IMPLEMENTED_NOT_LIVE_VERIFIED
- Verify: bun run lint → 0 errors; bunx tsc --noEmit → 0 errors in task-3 files (remaining repo errors belong to other agents' files: examples/, skills/, api/auth, api/trends, api/mcp, app-shell TS1355 pre-existing etc.); dev.log compiles green, GET / 200
- Design: glass/glass-strong/neon-border/neon-text/scrollbar-thin, fuchsia+emerald+amber neon accents (no blue/indigo), p-4/p-6 cards, max-h-64/96 scroll lists, Loader2/Skeleton states, sonner toasts with actionable descriptions, ≥44px targets, aria labels, semantic headings, 1-col mobile → xl grids
- Issues: none blocking. Note: tsc errors in unrelated files (src/app/api/auth/route.ts, src/app/api/trends/route.ts, src/components/app-shell.tsx TS1355, src/lib/jobs.ts missing @/lib/audit) pre-existed / belong to other task owners — flagged here for visibility

---
Task ID: 4
Agent: main
Task: Интеграция результатов агентов 2-a/2-b/3, исправление TS-ошибок, подготовка к E2E

Work Log:
- Все 3 субагента завершили модули UI (Brands/Trends/Planner, Studios/Prompts, Content/Publishing/Analytics/Settings/MCP) + i18n dict файлы (hy/ru/en)
- Исправлены TS-ошибки: auth route (skipDuplicates), video route (llmCompleteJson import + generic), jobs route (null check), mcp PRESETS typing, plans/content (plan.brand), trends (brand typing), auth-view/dashboard (index typing), jobs.ts import @/lib/audit → ledger
- bun run lint: 0 errors; bunx tsc --noEmit (excl. pre-existing examples/skills): 0 errors
- Dev server: компиляция зелёная, GET / → 200

Stage Summary:
- Полное приложение собрано: 13 модулей, все API маршруты, i18n 3 языка
- Следующий шаг: agent-browser E2E верификация golden flow (register → dashboard → brand → analyze → trends → image → content → schedule)

---
Task ID: 5
Agent: main
Task: E2E-верификация через agent-browser, фикс бага синка бренда, новые фичи (Command Palette, cost sparkline)

Work Log:
- E2E-верификация всех 13 модулей через agent-browser (register/session → dashboard → brands → trends → planner → content → prompt library → image studio → video studio → publishing → analytics → settings → mcp)
- Image Studio golden path подтверждён: POST /api/generate/image 200 in 84s, результат отрисован (provider zai-image, model image-gen-v2, download, recent gallery)
- Мобильная верификация (390×844): hamburger sheet-меню, одноколоночная сетка, sticky footer — OK
- Консоль браузера чистая (0 ошибок); "2 Issues" в Next.js DevTools — старые транзиентные 502 TTS из ранних сессий (TTS response_format баг уже был исправлен ранее — err 1214)
- БАГ: в Trends селектор бренда показывал "No brand (generic)" при установленном activeBrandId. Глубокая диагностика через React fiber инспекцию (hooks dump, effect deps, Radix bubble input): useEffect-синк не успевал отработать при монтировании (тайминги zustand persist гидрации). ФИКС: эффект заменён на производное состояние `brandId = pickedBrandId ?? activeBrandId ?? "none"` (эффект-фри синк, явный выбор пользователя приоритетен) — trends.tsx
- ФИКС page.tsx: bootstrap useCallback зависел от activeBrandId → повторный /api/auth/me при каждой смене бренда; теперь читает useApp.getState() внутри — bootstrap стабилен
- НОВАЯ ФИЧА: Command Palette (⌘K/Ctrl+K) — command-palette.tsx на shadcn CommandDialog: навигация по 13 модулям с иконками + G→<letter> hotkeys (G D, G B, G T...), переключение Manual/Autopilot, смена языка HY/RU/EN с пометкой текущего, i18n ключи cmd.* ×3 локали, кнопка-триггер в топбаре с ⌘K kbd
- НОВАЯ ФИЧА: 14-дневный спарклайн расходов на Dashboard Budget карточке — ledger.ts usage() расширен daily14 рядом (UTC-дневные бакеты), неоновые бары с градиентом по уровню трат, motion-анимация появления, title-тултипы, i18n dash.costTrend ×3
- Проверено: bun run lint 0 ошибок, tsc --noEmit 0 ошибок (вне pre-existing examples/skills), Ctrl+K/G-hotkeys/смена языка/навигация/спарклайн верифицированы в браузере, dev.log компилится зелёным
- Тестовый бренд "Test Brand B" (создан для диагностики) удалён

Stage Summary:
- Приложение полностью функционально и верифицировано E2E; багфикс синка бренда надёжнее прежней реализации (не зависит от таймингов эффектов)
- Новые фичи: Command Palette (power-user навигация) + cost sparkline (аналитика расходов)
- Следующие кандидаты: календарная неделя для scheduled posts в Publishing, PWA manifest, onboarding-тур для новых пользователей, экспорт контент-пакета (ZIP), дедупликация бренд-фактов

---
Task ID: 6
Agent: main (cron webDevReview #1)
Task: QA-проход, фикс hydration-бага (nested button), PWA manifest, недельный календарь Publishing

Work Log:
- QA через agent-browser: обнаружен REAL hydration-баг «<button> cannot be a descendant of <button>» — PromptLibraryModule рендерил карточки-шаблоны как motion.button с тремя <Button> (favorite/copy/duplicate) внутри. Статический scan по всем модулям: аналогичные паттерны в brands/content/dashboard валидны (span role=button). ФИКС: motion.button → motion.div с role="button", tabIndex=0, onKeyDown Enter/Space, focus-visible ring — a11y сохранён. Верифицировано: 0 hydration ошибок после reload
- НОВАЯ ФИЧА PWA: public/manifest.webmanifest (standalone, theme #0d0b14, категории, shortcuts Image/Content/Analytics с deep-link ?view=), иконки 512/192/apple-touch-180 сгенерированы из logo.svg (Playwright screenshot + PIL resize), layout.tsx: metadata.manifest + appleWebApp + icons; page.tsx bootstrap читает ?view= param (deep-link PWA шорткатов) с whitelist ViewId
- НОВАЯ ФИЧА: Week board в Publishing — 7-дневная сетка Пн–Вс (Intl weekday по текущей локали), навигация prev/next/This week, сегодня подсвечен neon-border, чипы постов со статусными цветами + время + платформенная иконка, клик по чипу → диалог деталей (статус, preflight issues, reschedule через datetime-local, cancel, attempt publish) — переиспользует существующие handlers; reschedule(post, value) рефакторнут на явный параметр; мобильный layout: horizontal snap-scroll с auto-cols, десктоп: grid-cols-7
- i18n: +7 ключей publishing.week* ×3 локали (hy/ru/en) через скрипт с anchor по scheduledPosts
- Тестовый флоу создан через API: content draft → PATCH assetId (переиспользована генерация из Task 5) → READY_FOR_REVIEW → APPROVED → POST /api/schedule (завтра, preflight ok) → пост отображается на week board; deep-link /?view=publishing верифицирован
- bun run lint 0 ошибок; tsc --noEmit 0 ошибок (вне examples/skills); dev.log зелёный

Stage Summary:
- Исправлен hydration-баг Prompt Library (invalid HTML nested buttons)
- PWA: устанавливаемое приложение с иконками и шорткатами (deep links работают)
- Publishing: визуальное недельное планирование с actions-диалогом
- Демо-пост "Week board demo post" оставлен в календаре (завтра, SCHEDULED) — можно отменить через UI
- Риски: нет; кандидаты next: onboarding-тур, экспорт контент-пакета, brand facts dedup, дашборд-виджет недели

---
Task ID: 7
Agent: main (cron webDevReview #2)
Task: QA-проход #2 + 4 новые фичи (onboarding-тур, экспорт контент-пакета, дедуп фактов, week-виджет) + стайлинг-полиш

Work Log:
- QA через agent-browser: все 13 views рендерятся, консоль чистая (0 ошибок), hydration-ошибок нет, ⌘K палитра работает, deep-links ?view= работают с корректными ID (image/video/voice/prompts — не studio-*). Блокирующих багов не найдено → перешёл к фичам
- НОВАЯ ФИЧА: Onboarding-тур (src/components/onboarding-tour.tsx) — 7 шагов со спотлайт-подсветкой целевых элементов: приветствие (центр) → навигация [data-tour=nav] → активный бренд [data-tour=brand] → режим Manual/Autopilot [data-tour=mode] → командный пульт [data-tour=palette] → честность по дизайну (центр) → финал (центр). Механика: DOMRect таргета + box-shadow 0 0 0 9999px вырезает «прожектор», карточка позиционируется под/над таргетом с клампом во вьюпорт; graceful fallback в центр если таргет скрыт (мобайл: nav x=-240 → центр, проверено на 390px). Автостарт при первом визите (localStorage haydev-tour-done, lazy useState init — без setState в эффекте, react-hooks/set-state-in-effect чист); replay из футера (кнопка «Тур» с LifeBuoy, window event haydev:tour); Escape/стрелки/клик по точкам прогресса; a11y role=dialog aria-modal, aria-selected точки
- НОВАЯ ФИЧА: Экспорт контент-пакета в Content (content.tsx) — DropdownMenu в детальном диалоге: «Копировать Markdown» (clipboard с fallback на скачивание), «Скачать .md», «Скачать .json». Markdown: заголовок, метаданные (бренд/платформа/тип/язык/статус/версия), hook/caption/hashtags/script, видео-сцены по порядку, ссылка на media-ассет; JSON: полный detail + brand + assetUrl + exportedAt. safeFileStem поддерживает армянские/кириллические символы; тосты exportCopied/exportDone
- НОВАЯ ФИЧА: Дедупликация бренд-фактов (brands.tsx) — useMemo-группа по нормализованному тексту (lowercase + collapse whitespace): дубликаты подсвечены amber-рамкой + бейдж «×N» (размер группы), кнопка «Убрать дубликаты» в шапке фактов (появляется только при наличии дублей) удаляет старые копии через DELETE /api/brands/[id]/facts (новейшая остаётся), тост brands.dedupDone с числом
- НОВАЯ ФИЧА: «Моя неделя» на Dashboard — 7-дневная полоса (Пн..Вс по Intl локали): ячейки-кнопки с датой + неоновые точки постов (до 3 + «+N»), сегодняшний день подсвечен neon-border, клик → view publishing; scheduled теперь полный список (slice(0,5) только для списка «следующие публикации»)
- СТАЙЛИНГ: globals.css + — .focus-glow (неоновый focus-visible ring для glass-элементов), .shimmer (бегущий блик на скелетонах dashboard), .gradient-hr, .heading-accent (неоновая вертикальная риска у секционных заголовков), глобальный стиль kbd (кностям ⌘K); app-shell — focus-glow на nav-кнопках и селекторах, иконки навигации micro-scale на hover (group/nav)
- i18n: core.ts +33 ключа (tour.* 30 + dash.week/weekEmpty), publishing.ts +18 (content.export* 6), brands.ts +12 (brands.dedup* 4) — все ×3 локали, parity-проверка скриптом: 399/357/228 = 133×3/119×3/76×3 PARITY-OK
- Верификация браузером: тур автостарт (Шаг 1 из 7) → спотлайты на nav/brand/mode/palette с корректными координатами (S3 x=1084, S4 x=374, S5 x=872) → «Начать работу» закрывает и пишет флаг; replay из футера переоткрывает на шаге 1; mobile 390px — центр без спотлайта; week-виджет 7 ячеек + точка демо-поста, клик уводит в Publishing; export-меню 3 пункта, «Скачать .md» → тост «Пакет готов»; дедуп: созданы 2 near-dupe факта через API → ×2 бейдж + кнопка → тост «Удалено дубликатов: 1» → UI чист; тестовые данные убраны (QA-факт удалён, Tour-флаг сброшен не был — автостарт не повторится)
- bun run lint → 0 ошибок; bunx tsc --noEmit → 0 ошибок (вне pre-existing examples/skills); dev.log зелёный

Stage Summary:
- 4 новые фичи: onboarding-тур со спотлайтом (replayable), экспорт контент-пакета (MD/JSON/clipboard), дедуп бренд-фактов (×N + cleanup), week-виджет на дашборде
- Стайлинг-полиш: focus-glow, shimmer-скелетоны, heading-accent, kbd-стиль, nav micro-анимации
- Скриншоты: tool-results/qa-week-widget.png, qa-export-menu.png, qa-export-toast.png, qa-dedup.png
- Риски: нет известных; тур-флаг уже записан у тестового пользователя (автостарт не повторится — это ожидаемо)
- Кандидаты next: экспорт всей контент-кампании (multi-item ZIP), drag-and-drop в week board Publishing, тёмная/светлая тема toggle, A/B варианты постов, интеграция ASR в голосовой модуль
