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

---
Task ID: 8
Agent: main (cron webDevReview #3)
Task: QA-проход #3 + 2 новые фичи (ASR speech-to-text, drag-and-drop week board) + стайлинг

Work Log:
- Инфраструктура: обнаружил, что dev-сервер не переживает между Bash-вызовами сандбокса (процессы реапаются) → все проверки собраны в mega-call скрипты (start server → QA → stop) в tool-results/qa*.sh; QA-проход всех 13 views: 0 консольных ошибок, 0 hydration, deep-links работают
- НОВАЯ ФИЧА: Speech-to-text (ASR) в Voice Studio:
  - src/lib/ai/zai.ts: asrTranscribe() — zai.audio.asr.create({file_base64}) с защитой от альтернативных форм ответа SDK
  - NEW /api/generate/asr: requireUser, валидация (25MB cap, whitelist расширений wav/mp3/m4a/flac/ogg/webm/aac), jobs.create kind=TRANSCRIPTION (ledger пишется внутри jobs.create), idempotency (dedup по outputJson), markCompleted(outputJson{text}), audit asr.transcribe, честная 502 GENERATION_FAILED c canRetry
  - voice.tsx: карточка ASR с dropzone (drag-and-drop файла + клик + Enter/Space a11y), выбор файла с валидацией (тип/размер тосты), результат — редактируемый textarea + word count + copy-кнопка (check-иконка после копирования), honest badge провайдера (zai-asr · IMPLEMENTED_NOT_LIVE_VERIFIED, title=statusNote)
  - VERIFIED реально: TTS сгенерил армянский аудио (306KB) → POST /api/generate/asr → провайдер вернул транскрипт (zai-asr жив); guard: evil.exe → VALIDATION 400; UI: drop bad.txt → тост «Անհայտ աուդիո ֆորմատ»
- НОВАЯ ФИЧА: Drag-and-drop reschedule в week board Publishing:
  - Чипы SCHEDULED постов draggable (cursor-grab, lift, GripVertical иконка, opacity при драге); не-SCHEDULED не перетаскиваются (weekDragLocked тост при Defensive drop)
  - Ячейки дней: onDragOver always preventDefault (drop разрешён), drop-target dashed outline + neon фон, empty-ячейка показывает «Թողեք այստեղ» во время драга; drop сохраняет время суток (HH:mm) и меняет только дату → существующий reschedule() (PATCH reschedule) → success тост
  - БАГ-ФИКС по ходу верификации: первая реализация читала postId из React state (dragPostId) — при синтетическом drag-событии state не флашится между dragstart и drop (React batching) → drop молча игнорился. ФИКС: postId читается из e.dataTransfer.getData("text/plain") в onDrop (стандартный HTML5 паттерн, устойчив к батчингу), state остался только для визуала (highlight/opacity)
  - VERIFIED браузером (синтетический DragEvent-сценарий): highlight=true во время dragover, drop → тост «Ժամը թարմացված է», scheduledAt сменился с 2026-09-30 на 2026-09-28 c сохранением времени 10:00 — DRAG-RESCHEDULE OK
- СТАЙЛИНГ: globals.css +3 утилиты: .dropzone (неоновая dashed граница + hover glow + active inset shadow), .lift (hover translateY+neon shadow, отключается при prefers-reduced-motion), .drop-target (dashed outline — ring не умеет dashed); Publishing: empty-state scheduled posts с неоновой иконкой CalendarClock вместо голого текста
- i18n: studio.ts +14 ключей (studio.voc.asr.*) ×3 локали, publishing.ts +3 (weekDragLocked/weekDropHere/weekDragA11y) + обновлён weekHint (drag-инструкция) ×3; parity-скрипт: studio 160×3 PARITY-OK, publishing 122×3 PARITY-OK
- bun run lint 0 ошибок; bunx tsc --noEmit 0 ошибок (вне pre-existing examples/skills); dev.log зелёный
- Скриншоты: tool-results/qa3-voice-desktop.png, qa3-week-desktop.png, qa3-weekboard-after.png, qa3-voice-final.png
- Тестовые данные: создан изолированный QA-аккаунт qa3@haydev.am (QA3 Brand, 1 TTS-ассет, 1 drag-тест пост Mon 28) — данные не смешиваются с основным тестовым юзером

Stage Summary:
- 2 новые фичи полностью верифицированы: ASR (реальный провайдерский вызов прошёл) + drag-and-drop week board (реальный reschedule через UI-события)
- 1 баг найден и исправлен в процессе (React state batching vs native drag events → dataTransfer как источник истины)
- Стайлинг: dropzone/lift/drop-target утилиты, publishing empty-state
- Риски: ASR качество распознавания армянского — провайдерное («Indac, Tandia High Dev Marketing Indac» для TTS-армянского); интеграция корректна
- Кандидаты next: экспорт всей контент-кампании (multi-item ZIP), A/B варианты постов, web search в Trends с реальными источниками, drag-and-drop переносы с сохранением точного времени через пикер, batch-генерация сценариев

---
Task ID: 9
Agent: main (cron webDevReview #4)
Task: QA-проход #4 + фичи (реальные источники и evidence в Trends, мост тренд→AI-драфт→Content) + honest-degradation фолбэк + retry + стайлинг

Work Log:
- Инфраструктура: dev-сервер был SIGTERM-нут; перезапущен (nohup bun run dev) и на этот раз переживает между Bash-вызовами — QA без mega-call скриптов
- QA: все 13 views — 0 консольных ошибок, deep-links работают; сессия браузера истекла (показан auth-view — ожидаемо) → зарегистрирован изолированный QA-аккаунт qa4@haydev.am (пароль HayDev-QA4-2026!, бренд QA4 Coffee Roasters) — данные предыдущих юзеров не тронуты
- Подтверждён фикс синка бренда в Trends из пред. сессии: #tr-brand показывает активный бренд сразу после reload (derived state работает)
- ФИКС (надёжность): webSearch в zai.ts — 1 retry с backoff 8s: upstream serper-зеркало жёстко рейт-лимитит (первый вызов дня ок, все последующие 429 «400 Bad Request … 42900»)
- НОВАЯ ФИЧА (honest degradation): POST /api/trends при недоступности web_search НЕ падает, а возвращает LLM-гипотезы: каждый item HYPOTHESIS, confidence ≤0.4, без evidence/metrics, sourceName «LLM hypothesis (unverified)», пустой sourceUrl (фронт рендерит span вместо ссылки), risk отмечает отсутствие верификации; ответ несёт searchFallback=true; jobs.markCompleted + audit помечают фолбэк
- НОВАЯ ФИЧА (реальные источники в Trends): POST /api/trends возвращает полный массив sources (раньше только count); GET и POST сериализуются через serializeTrend: parsed evidence[] (quote+source+observedAt, до 4) + metricsObserved, сырые JSON-строки из ответа вырезаны
- НОВАЯ ФИЧА (UI Trends): панель «Իրական աղբյուրներ/Реальные источники» после поиска — 6 карточек источников (rank-chip 01–06, host, дата, заголовок, external-link на hover, stagger-анимация, свёртывается шевроном); компактный evidence-превью на карточке тренда (quote-accent, line-clamp-2 + ссылка на host) — рендерится ТОЛЬКО у трендов из живого поиска; бейдж наблюдаемых метрик (Activity, neon-3, title=полный текст); amber-баннер фолбэка (ShieldAlert + trends.fallbackNotice)
- НОВАЯ ФИЧА (мост Trend → Content): кнопка «Ստեղծել նախագիծ / Create draft» на карточке тренда → POST /api/content {aiWrite:true, brief:suggestedAdaptation, linkTrend, trendId, meta.fromTrend} (эндпоинт уже поддерживал trendId/linkTrend — теперь их впервые использует UI) → AI пишет платформенный копирайт grounded в бренд-профиль → transient contentSeed в zustand (не persisted) → setView("content") → Content авто-открывает detail-диалог нового драфта (seed consumed once); без бренда — тост needBrand
- Верификация браузером: реальный поиск (API) вернул 4 тренда (3 VERIFIED_TREND + 1 EMERGING_SIGNAL) с evidence-цитатами и метрикой «28% of specialty coffee sales by 2026, 35% profit lift»; UI-поиск при 429 → честный фолбэк: amber-баннер + 4 × HYPOTHESIS + unverified-источник + риск, без фиктивных evidence; «Create draft» → диалог авто-открылся с AI-копирайтом (hook/caption/hashtags/script), DRAFT v1, связка trendId+meta.fromTrend подтверждена через API; sources-панель отрендерена детерминированно (fetch-stub с кэшем реального ответа провайдера): 6 rank-chip'ов + hosts javacity.com/uschamber.com/…; evidence-превью появился ровно на 4 реальных трендах и ни на одном гипотезном; mobile 390px без горизонтального overflow; консоль 0 ошибок по всем 13 views после изменений
- Стайлинг: globals.css +3 утилиты — .rank-chip (неоновый квадрат ранга), .source-card (glass + hover glow + lift 1px), .quote-accent (неоновая левая риска + курсив цитаты), все с prefers-reduced-motion
- i18n: trends.ts +12 ключей ×3 локали (sourcesTitle, sourcesHint, evidenceTitle, metrics, toDraft, drafting, toDraftDone, needBrand, fallbackNotice) — PARITY-OK 45×3
- bun run lint 0 ошибок; bunx tsc --noEmit 0 ошибок (вне pre-existing examples/skills)
- Скриншоты: tool-results/qa4-trend-draft-dialog.png, qa4-sources-panel.png, qa4-trend-evidence-card.png
- Тестовые данные: qa4-юзер + бренд + 12 трендов + 1 AI-драфт (изолированный аккаунт); onboarding-тур автостартует на новом юзере (побочно верифицирован — оверлей перехватывает клики, Escape закрывает)

Stage Summary:
- 3 фичи верифицированы: серфейс реальных источников + evidence в Trends, honest-degradation фолбэк при недоступности поиска, мост тренд→AI-драфт→Content с автооткрытием диалога
- 1 надёжностный фикс: webSearch retry/backoff (429 upstream)
- Риски: web_search провайдер (serper-зеркало) лимитирован большую часть дня — фолбэк покрывает UX, но live-данные недоступны до восстановления квоты; aiWrite может писать не на запрошенном языке (просили hy — получил en: провайдерное качество промпта)
- Кандидаты next: усилить языковую директиву aiWrite, экспорт кампании ZIP, A/B варианты постов, виджет источников на дашборде, периодический TREND_SEARCH в autopilot

---
Task ID: 10
Agent: main (cron webDevReview #5)
Task: QA-проход #5 + фичи (A/B варианты постов, экспорт кампании, evidence-карточки трендов на дашборде) + фикс языковой директивы aiWrite + стайлинг

Work Log:
- Инфраструктура: dev-сервер жив (HTTP 200), qa4-сессия активна; быстрый QA всех 13 views — 0 консольных ошибок, все переходы работают. Приоритет отдан фичам (статус стабильный, багов не найдено).
- НОВАЯ ФИЧА (A/B варианты постов): POST /api/content/[id]/variants — генерирует 2 варианта копирайта с РАЗНЫМИ креативными углами (A = эмоциональный/любопытство-хук, B = информативный/польза-хук), grounded в бренд-профиль, запрещённые клеймы соблюдаются; варианты НЕ персистятся (ephemeral) — применяются через существующий PATCH (материальное редактирование → version bump + честная инвалидация APPROVED). 502 GENERATION_FAILED с canRetry при провале провайдера. audit action=content.variants
- UI A/B (content detail dialog): секция между полями и историей — кнопка Generate/Regenerate (Sparkles/Loader2), 2 карточки со stagger-анимацией: rank-chip A/B, angle-badge, hook в quote-accent, caption line-clamp-3, hashtags neon-3, кнопка «Կիրառել» → заполняет форму (hook/caption/hashtags/script) + тост «сохраните изменения»; применённая карточка подсвечена neon-border; skeleton-загрузка; кнопка disabled в GENERATING/PUBLISHED
- НОВАЯ ФИЧА (экспорт кампании): кнопка «Արտահանել արշավը» в шапке Content — markdown-дайджест всех items под ТЕКУЩИМИ фильтрами (brand/state/search): заголовок с датой/кол-вом, на каждый item — бренд/платформа/тип/язык/стейт/версия + hook/caption/hashtags/script; скачивание campaign-{state}-{n}.md; честный тост при пустом фильтре
- ФИКС (языковая директива aiWrite): в POST /api/content и /variants — системный промпт теперь «Write EXCLUSIVELY in Armenian (Հայերեն)… ALL output fields MUST be 100% in {language}. Do NOT use any other language anywhere» с маппингом hy/ru/en → полные названия; РЕЗУЛЬТАТ: варианты реально пришли на армянском (раньше просили hy — получали en)
- ФИКС (дашборд прятал проверенные тренды): GET /api/trends?brandId=X исключал тренды с brandId=null (4 VERIFIED с evidence лежали вне бренда); дашборд теперь берёт тренды юзера без бренд-фильтра (тренды = юзер-левел сигналы) + сортировка по ценности: VERIFIED_TREND > EMERGING_SIGNAL > POPULAR_TOPIC > HYPOTHESIS, потом confidence
- UI дашборда (Trend radar upgrade): карточки трендов с честными статусами (trends.status.* локали, emerald verified / neon emerging / amber hypothesis), evidence-цитата в quote-accent (только у живых трендов), наблюдаемые метрики (Activity, neon-3), внешняя ссылка на источник-хост (ExternalLink, hover); time-aware приветствие (Բարի լույս/օր/երեկո по часам клиента)
- Верификация браузером (qa4): greeting «Բարի երեկո, QA4 Reviewer» ✓; дашборд показывает 4 verified-тренда сверху с цитатами/метриками/хостами (www.brik.ly и др.) ✓; A/B: generate → 2 армянских хука с разными углами («Ինչո՞ւ ենք մենք դեռ սիրում հին ձևով սուրճ խմել։» vs «Սուրճի համը ավելի մաքուր դարձնելու գաղտնիքը…») → Apply A → форма заполнена + тост → Save → «Փոփոխությունները պահպանված են», v1→v2 ✓; экспорт кампании → тост «({n} միավոր)» + скачивание .md ✓; RU-локаль: «A/B варианты»/«Применить» ✓; mobile 390px — без горизонтального overflow ✓; консоль 0 ошибок
- i18n: publishing.ts +10 ключей (content.variants* ×7, content.exportCampaign* ×3) ×3 локали — PARITY 132×3; core.ts +3 (dash.greet.morning/afternoon/evening) ×3 — PARITY 136×3
- bun run lint 0 ошибок; bunx tsc --noEmit 0 ошибок (вне pre-existing examples/skills); dev.log зелёный
- Скриншоты: tool-results/qa5-dashboard-greeting.png, qa5-dashboard-trends-bottom.png, qa5-ab-variants.png, qa5-ab-variants-cards.png, qa5-mobile-content.png

Stage Summary:
- 3 фичи верифицированы живьём: A/B варианты постов (реальный AI-вызов, честный ephemeral-флоу через PATCH), экспорт кампании (markdown под фильтрами), trend-evidence радар на дашборде с ранжированием по достоверности
- 2 фикса: языковая директива aiWrite (промпт вынуждает 100% язык вывода — подтверждено на армянском), дашборд больше не прячет проверенные тренды без бренда
- Стайлинг: rank-chip/quote-accent переиспользованы, время-зависимое приветствие, честная цветовая маркировка статусов трендов
- Риски: variants LLM-вызов ~20-40с (без jobs-очереди — синхронный запрос, UI показывает skeleton; при зависании провайдера фетч висит до таймаута); экспорт кампании не включает медиа-файлы (только текст + assetUrl у одиночного пакета)
- Кандидаты next: batch-генерация сценариев, A/B через jobs-очередь с историей вариантов, ZIP-экспорт с медиа, виджет источников на дашборде (полный, как в Trends), периодический TREND_SEARCH в autopilot, onboarding-тур на новые фичи

---
Task ID: 11
Agent: main (cron webDevReview #6)
Task: QA-проход #6 + фичи (batch AI-черновики из контент-плана, покрытие плана) + НАЙДЕН И ИСПРАВЛЕН краш-баг генерации плана

Work Log:
- Инфраструктура: dev-сервер жив, qa4-сессия активна; QA всех 13 views — клики по всем пунктам навигации, 0 консольных ошибок на старте
- НОВАЯ ФИЧА (batch AI-черновики): POST /api/plans/content/batch {id, indexes[], aiWrite, language} — создаёт черновики для выбранных пунктов плана (max 10 за вызов), с aiWrite=true гоняет платформенного копирайтера на каждый пункт (тот же системный промпт с жёсткой языковой директивой, grounded в бренд-профиль); при ошибке провайдера на пункте — честная деградация: черновик из данных плана без AI-копирайта; audit content.batch_create
- НОВАЯ ФИЧА (UI batch): кнопка «Ստեղծել բոլոր սևագրերը (N)» на карточке контент-плана → последовательный цикл по 1 пункту с aiWrite → прогресс-бар + счётчик «X/Y · done/total» + кнопка «Կանգնեցնել» (stop через ref, честный тост batchPartial/batchStopped); по завершении — refresh планов; не-батчевые кнопки блокируются на время прогона
- НОВАЯ ФИЧА (персистентный per-item статус): PATCH /api/plans/content и batch пишут metaJson.itemIndex; GET /api/plans/content теперь отдаёт metaJson у contentItems; фронт вычисляет coveredIndexes — пункт с существующим черновиком показывает «Ստեղծված է» с emerald-подсветкой карточки ПОСЛЕ перезагрузки страницы (раньше был только session-state, пропадал по F5)
- СТАЙЛИНГ: на карточке плана — «Ծածկույթ» (покрытие) N/M + Progress bar (неон при 100% — emerald-текст счётчика), карточка пункта с черновиком получает emerald border/tint; батч-прогресс на том же Progress; rank: coverage chip в шапке
- БАГ-ФИКС (КРАШ, воспроизведён и починен): генерация 7-дневного контент-плана из Planner валила ВСЁ приложение в белый экран. Root cause: POST /api/plans/content возвращает сырью строку БЕЗ связи contentItems, а generateContentPlan пушит её в state как есть → renderContentPlan делает cp.contentItems.length → TypeError → global-error. Документ замещался целиком (без console-ошибки в новом документе, что усложнило диагностику; "crash" сопровождался [HMR] connected от свежей загрузки). Диагностика: воспроизведение изолированно (из dashboard через API — жив; маунт planner с 4 планами — жив; именно завершение генерации на planner — краш) → единственный путь данных, попадающий в рендер без include
  - ФИКС 1 (root): setContentPlans нормализует — [{ ...created, contentItems: created.contentItems ?? [] }, ...prev]
  - ФИКС 2 (defensive): coveredIndexes итерирует cp.contentItems ?? [], шапка рендерит cp.contentItems?.length ?? 0
  - VERIFIED: генерация плана на planner-view → nav жив, карточка с «0 սևագիր», coverage 0/7, батч-кнопки на месте; прежний сценарий больше не крашит
- Верификация браузером (qa4): batch-прогон 7 пунктов → все 7 черновиков с AI-копирайтом НА АРМЯНСКОМ (hook/caption/hashtags, lang=hy), itemIndex 0..6 в metaJson; coverage 7/7 + все «Ստեղծված է»; одиночное создание на новом плане → itemIndex=0 в metaJson, статус пережил бы F5; консоль чистая
- i18n: planner.ts +8 ключей ×3 локали (batchAll/batchComplete/batchStop/batchDone/batchPartial/batchStopped/batchNone/coverage) — PARITY 71×3
- bun run lint 0; bunx tsc --noEmit 0 (вне pre-existing examples/skills); dev.log зелёный
- Скриншоты: tool-results/qa6-batch-planner.png (план 7/7, emerald-пункты), qa6-planner-fixed.png (после фикса краша)
- Тестовые данные: qa4 — 5 контент-планов (1 с 7 AI-черновиками, 1 с 1 черновиком, 3 пустых) — изолированный QA-аккаунт

Stage Summary:
- 2 фичи верифицированы живьём: batch AI-черновики из плана (прогресс+отмена+честная деградация), персистентное покрытие плана (meta.itemIndex)
- 1 КРАШ-баг найден и исправлен: генерация контент-плана из Planner роняла приложение (нормализация POST-ответа + defensive rendering)
- Риски: batch-прогон синхронный (1 LLM-вызов ~5-15с на пункт, 7 пунктов ≈ 1-2 мин; UI прогрессбар, но вкладка должна оставаться открытой) — кандидат на jobs-очередь; черновики, созданные ДО itemIndex, не покрывают пункты (dedup только для новых)
- Кандидаты next: batch через jobs-очередь с фоновым прогрессом, ZIP-экспорт кампании с медиа, полный sources-widget на дашборде, периодический TREND_SEARCH в autopilot, онбординг-тур для новых фич

---
Task ID: 12
Agent: main (cron webDevReview #7)
Task: QA-проход #7 + фичи (ZIP-экспорт кампании с медиа, copy-caption для draft-transfer) + фикс мобильного overflow в Publishing

Work Log:
- Инфраструктура: dev-сервер жив, qa4-сессия активна; QA всех 13 views — 0 консольных ошибок; статус стабильный → фичи
- НОВАЯ ФИЧА (ZIP-экспорт кампании с медиа): в Content шапке кнопка «Արտահանել արշավը» стала DropdownMenu: (1) Markdown .md — прежний дайджест, (2) «Ներբեռնել ZIP (մեդիայով)» — НОВОЕ: клиентский ZIP через fflate (bun add fflate@0.8.3): для каждого item под текущими фильтрами папка item-NN-{slug}/copy.md (полный текст: бренд/платформа/стейт/hook/caption/hashtags/script) + media.{ext} — оригинал ассета тянется с /api/assets/{id}/raw (cookie-auth), ext из content-type (png/jpg/webp/mp4/webm/mp3/wav/bin); в корне campaign.md — дайджест со ссылками на папки; честная деградация: недоступный ассет пропускается, copy.md остаётся; тост «ZIP փաթեթը պատրաստ է ({n} միավոր)» с description «{k} × media»; спиннер в menu item во время сборки
  - VERIFIED живьём: сгенерирована картинка через /api/generate/image (COMPLETED), прицеплена к item через PATCH assetId; ZIP собрался: 9 items, 1 × media (asset endpoint проверен: 200, image/png, 73992 байт)
- НОВАЯ ФИЧА (copy-caption для draft-transfer): в Publishing у каждого scheduled-поста кнопка «Պատճենել տեքստը» — копирует caption БЕЗ мутации статуса поста (в отличие от attempt_publish, который переводит пост в honest-failed); иконка меняется на Check 2с после копирования; пустой caption → info-тост; общий хелпер copyTextToClipboard в src/lib/utils.ts (navigator.clipboard → fallback document.execCommand('copy') через скрытый textarea) — clipboard API блокируется без user-activation (headless-тест это подтвердил: у нас честный error-тост, в реальном браузере работает)
- ФИКС (мобильный overflow в Publishing, 390px): docW 429 → 390. Диагностика послойно: перебор детей root-grid с display:none + замер min-content каждого → виноват scheduled-posts Card (mcs 417). Причина: shadcn v4 CardHeader — grid с @container (класс flex-row на нём не работает), внутри action-row из 4 кнопок (198+189+98+244px) в карточке px-6 → min-content 415+ раздувал auto-трек
  - ФИКС 1: CardHeader scheduled-карточки → явный flex flex-wrap items-center justify-between gap-2
  - ФИКС 2 (root): модульный root-grid → className="grid gap-5 [&>*]:min-w-0" — все дети могут сжиматься ниже min-content, overflow уходит в их собственные scroll-контейнеры
  - ФИКС 3: connection-карточки — badge-строка flex-wrap (бейдж «API-ն հասանելի չէ» не вылезает за карточку)
  - Проверено: mobile 390px hScroll=false (десктоп тоже чисто), TikTok/Instagram/Facebook карточки выглядят корректно
- Ложная тревога при диагностике: rg показал «auto-cols-inmax(138px,1fr)]» как битый класс week-board — оказалось артефактом вывода rg; в файле корректный auto-cols-[minmax(138px,1fr)] (проверено od -c)
- Тестовые данные (qa4): 2 SCHEDULED поста (1 с caption, 1 пустой — честный кейс), 1 IMAGE ассет прицеплен к item, item APPROVED через transition (подтверждён NO_MEDIA guard: без медиа approve отклоняется)
- i18n: publishing.ts +5 ключей ×3 локали (content.exportZip, content.exportZipDone, publishing.copyCaption, publishing.captionCopied, publishing.noCaption) — PARITY 137×3
- bun run lint 0; bunx tsc --noEmit 0 (вне pre-existing examples/skills); dev.log зелёный; консоль браузера чистая
- Скриншоты: tool-results/qa7-publishing-copy.png (week board с 2 постами), qa7-scheduled-copy-btn.png (кнопки Copy caption), qa7-mobile-publishing.png (ДО фикса — overflow), qa7-mobile-publishing-fixed.png (ПОСЛЕ — чисто)

Stage Summary:
- 2 фичи верифицированы: ZIP-экспорт кампании с медиа (fflate, честная деградация по ассетам), copy-caption для честного draft-transfer сценария (без мутации статуса)
- 1 QA-фикс: мобильный overflow Publishing (429→390px) — CardHeader grid-квирк + root-grid min-w-0
- Риски: clipboard в headless-браузере недоступен (нет user-activation) — фолбэк execCommand добавлен, но финальная проверка копирования возможна только в реальном браузере; ZIP собирается на клиенте — при десятках видеофайлов может съедать память (сейчас только 1 медиа в тестовых данных)
- Кандидаты next: batch через jobs-очередь с фоновым прогрессом, полный sources-widget на дашборде, периодический TREND_SEARCH в autopilot (осторожно с квотой serper), онбординг-тур для новых фич (⌘K, A/B, batch, ZIP)

---
Task ID: 13
Agent: main (cron webDevReview #8)
Task: QA-проход #8 + фичи (signal-sources виджет на дашборде, analytics pipeline overview) + фикс мобильного overflow дашборда + defensive-фикс planner

Work Log:
- Инфраструктура: dev-сервер жив (HTTP 200), qa4-сессия активна; клик-проход по всем 13 views — рендер ок, 0 свежих консольных ошибок. Приоритет — фичи (статус стабильный).
- ДИАГНОСТИКА ЛОЖНОЙ ТРЕВОГИ (полезный урок): `agent-browser errors` показывал 3 × «TypeError: cp.contentItems is not iterable» (planner) + 2 × «Parsing ecmascript source code failed» (content.tsx:333). Разбор: (1) `agent-browser errors --clear` НЕ РАБОТАЕТ (сразу после clear счётчик = 3) — буфер page-errors персистентен за всю жизнь браузер-сессии, записи были ДО фикса из раунда #6; (2) `console --clear` работает, после чистого reload — 0 ошибок компиляции; eslint/tsc/dev.log чистые. ВЫВОД: errors-буфер шумит, источник истины — console --clear + свежий reload + dev.log. ПЛЮС: класс ошибки «not iterable» реален при shape-drift — `?? []` не защищает от non-null non-iterable → defensive-фикс в planner.tsx coveredIndexes: `Array.isArray(cp.contentItems) ? cp.contentItems : []`.
- НОВАЯ ФИЧА (Signal sources на дашборде): постоянная агрегация внешних источников, стоящих за ВСЕМИ тренд-сигналами юзера (в отличие от транзиентной панели последних результатов поиска в Trends). Клиентская агрегация из уже загруженных трендов (без нового API): группировка по домену (sourceUrl, www-нормализация), счётчики signals/verified (VERIFIED_TREND), топ-6 по verified→signals; заголовок «Источники сигналов · X/Y» (Y=все сигналы, X=с живым источником); карточки source-card: rank-chip 01–06, host (truncate), «{n} сигналов», ShieldCheck + счётчик verified (neon-2), hover ExternalLink, title=имя источника + пример тренда, stagger-анимация; пустое состояние (Globe + CTA «Перейти в Тренды» → setView) и честная сноска: гипотезы без живого источника НЕ показаны — ради честности. Данные: qa4 → 4/12 сигналов с источниками (brik.ly, javacity.com, uschamber.com, coffeegreenbeans.com)
- НОВАЯ ФИЧА (Analytics pipeline overview): GET /api/analytics/overview?brandId= — честные счётчики прямо из БД: funnel по всем 8 документированным approvalState (нули показываются — честная полная картина), postStatuses (groupBy фактических статусов ScheduledPost), platforms/languages (tally по контенту), metrics из analyticsSnapshot (snapshots, postsTracked=distinct contentItemId, views, engagement=likes+comments+shares+saves, clicks). UI: 2-колоночная секция вверху Analytics — слева «Контентный конвейер» (8 строк с анимированными барами, цвет = семантика состояния: APPROVED/PUBLISHED=neon-2, SCHEDULED=neon, GENERATING/READY_FOR_REVIEW=neon-3, CHANGES_REQUESTED=amber, FAILED=red, DRAFT=muted); справа — 3 мини-карточки (Замеров/Отслеживается постов/Вовлечённость) + карточка «Платформы, языки, публикация» (бейджи платформ с иконками ×count, бейджи языков через content.lang.*, статусы постов с переиспользованными лейблами content.state./publishing.status./job.status.CANCELLED). Никаких выдуманных чисел; пустые состояния честные. VERIFIED на qa4: Черновик 6, На проверке 1 (amber), Запланировано 2 (neon); Instagram ×6, facebook ×2, telegram ×1; Армянский ×9; 0 snapshots → честные нули
- ФИКС (мобильный overflow дашборда, 390px, scrollWidth 510): послойная диагностика (hide-children) → виноват «Ближайшие публикации»: li с truncate-заголовком «Understanding different coffee brewing methods» (создан в #7 — при mobile-QA #5 этого поста не было, поэтому не ловили) — min-content grid-трека = полная nowrap-ширина. ФИКС: все 3 ul дашборда (jobs/trends/next-posts) → `grid grid-cols-[minmax(0,1fr)] gap-2` (трек может сжиматься ниже min-content, min-w-0+truncate дальше работают). Плюс source-карточки min-w-44 → min-w-40 (2×176+gap не влезало в 358px контентной ширины). ПОСЛЕ: hScroll=false, sw=390; заголовки/хосты обрезаются ellipsis корректно
- СТАЙЛИНГ: семантические цвета funnel-баров, mini-метрики с иконками в color-mix подложках, source-cards со stagger, честная сноска виджета; переиспользованы .source-card/.rank-chip/.heading-accent/.glass
- i18n: analytics.ts +11 ключей ×3 (pipeline, pipelineDesc, mix, platforms, languages, postStatus, noPublishing, emptyPipeline, snapshots, postsTracked, m.engagement) — PARITY 42×3; core.ts +5 (dash.sources, dash.sourcesEmpty, dash.sourcesCta, dash.sourceSignals{n}, dash.sourcesNote) ×3 — PARITY 141×3
- Верификация браузером (qa4): дашборд «Источники сигналов · 4/12» с 4 карточками ✓; HY/RU/EN — все новые секции локализованы (проверено скриншотами RU «Контентный конвейер/Платформы, языки, публикация» и EN «Content pipeline/Signal sources») ✓; mobile 390px дашборд+аналитика без overflow ✓; консоль после чистых reload — 0 ошибок ✓
- bun run lint 0; bunx tsc --noEmit 0 (вне pre-existing examples/skills); dev.log зелёный (только известные 429 serper + prisma:query)
- Скриншоты: tool-results/qa8-dashboard-sources.png, qa8-sources-widget.png, qa8-analytics-pipeline.png, qa8-analytics-ru.png, qa8-mobile-sources-fixed.png, qa8-mobile-dash-final.png

Stage Summary:
- 2 фичи верифицированы живьём на реальных данных: signal-sources радар на дашборде (постоянный, честный по доменам), pipeline overview в Analytics (funnel 8 состояний + платформы/языки/статусы публикации + метрики замеров)
- 1 QA-фикс: мобильный overflow дашборда (510→390) — grid-tracks minmax(0,1fr), источник — long-title пост из раунда #7
- 1 defensive-фикс: planner coveredIndexes Array.isArray (класс реальной ошибки из буфера, ?? [] не ловит non-iterable объекты)
- Инструментальная находка: `agent-browser errors --clear` не очищает буфер (записи живут всю сессию) — при диагностике опираться на `console --clear` + свежий reload
- Риски: serper по-прежнему 429 большую часть дня (фолбэк покрывает UX); sources-виджет клиентский — при сотнях трендов аггрегация в useMemo (сейчас 12 — нулевая стоимость)
- Кандидаты next: batch-черновики через jobs-очередь с фоновым прогрессом, onboarding-тур на новые фичи (⌘K, A/B, batch, ZIP, sources, pipeline), периодический TREND_SEARCH в autopilot (осторожно с квотой), экспорт overview в CSV

---
Task ID: 14
Agent: main (cron webDevReview #9)
Task: QA-проход #9 + фичи (durable batch через jobs-очередь с фоновым прогрессом и резюмом, CSV-экспорт аналитики) + тур: spotlight scrollIntoView + 2 новых шага

Work Log:
- Инфраструктура: dev-сервер жив (HTTP 200), qa4-сессия активна; QA всех 13 views кликами — 0 консольных ошибок; mobile 390px (dashboard/publishing/analytics) без overflow. Статус стабильный → фичи.
- НОВАЯ ФИЧА (durable batch через jobs-очередь) — топ-кандидат 4 раундов, батч-генерация черновиков теперь фоновая и ПЕРЕЖИВАЕТ ПЕРЕЗАГРУЗКУ:
  - jobs.ts: +kind "CONTENT_BATCH"; CreateJobInput +checkpointJson (стейт чекпойнта пишется при создании)
  - POST /api/plans/content/batch-jobs {planId, indexes?, language} — создаёт job (QUEUED, checkpoint {next:0, created:[]}, cap 30 items, план/бренд ownership-проверки, audit content.batch_job_create)
  - POST /api/plans/content/batch-jobs/[id]/step — продвигает job РОВНО на ОДИН пункт (bounded request ~1 LLM-вызов 3-7с): terminal-статы отдают прогресс без работы; QUEUED→PROCESSING; при next>=indexes.length → markCompleted + audit content.batch_job_completed; план/бренд грузятся заново на каждом шаге; cancel-guard ПОСЛЕ LLM-вызова (текущий пункт доделывается, остальные останавливаются); битые индексы скипаются честно (checkpoint растёт, без зависаний); провайдер-фейл на пункте → honest degradation (черновик из данных плана, aiWritten:false), job продолжается
  - UI Planner: заменён клиентский последовательный цикл (вкладка должна была оставаться открытой) на job-паттерн: startBatchJob → POST batch-jobs → runBatchSteps (step-луп до терминального статуса); Stop → POST /api/jobs/{id} {action:"cancel"} (обычный jobs API); после завершения — refresh планов + refreshResumable
  - РЕЗЮМ ПОСЛЕ ПЕРЕЗАГРУЗКИ: refreshResumable читает /api/jobs?limit=30, фильтрует CONTENT_BATCH в QUEUED/PROCESSING/RETRYING → на карточке плана пульсирующий chip «Շարունակել ֆոնում ({done}/{total})» ВМЕСТО кнопки батча (защита от дублей) → клик продолжает step-луп с checkpoint'а
  - VERIFIED живьём (qa4, реальный LLM): прогон 11 пунктов (12-item план) → COMPLETED 11/11 (9 aiWritten:true + 2 aiWritten:false — честная деградация при провайдер-хиккапах); reload в середине второго прогона (7-item план, PROCESSING 4/7) → на карточке chip «Resume background job (3/7)» → клик → прогон дошёл до COMPLETED 7/7; coverage 12/12 и 7/7 персистентны; оба job в фиде COMPLETED; step-роут: 22 вызова, все 200 (3-7с на LLM-шаг, 52ms на терминальном); 404 на несуществующем job; terminal-step на COMPLETED job отдаёт прогресс без работы
- НОВАЯ ФИЧА (CSV-экспорт аналитики): кнопка «Արտահանել CSV» в шапке Analytics (Download icon, label скрыт на мобиле) — клиентский CSV из тех же реальных данных, что рендерит UI: funnel (8 approval-стейтoв с нулями), postStatuses, platforms, languages, 6 метрик + snapshots/postsTracked/engagement_rate_pct, секция per-post (title,platform,views,engagement) с CSV-escaping (кавычки/запятые/;); filename haydev-analytics-YYYY-MM-DD.csv; честный info-тост при пустых данных
  - VERIFIED (blob перехвачен через URL.createObjectURL monkey-patch): 480 байт, «section,key,value / funnel,DRAFT,24 / funnel,READY_FOR_REVIEW,1 …», тост «CSV ready (25 rows)»
- ТУР/UX-фикс + 2 новых шага: у spotlight-таргета, который существует, но за пределами вьюпорта, теперь вызывается scrollIntoView({block:center, behavior:smooth}) перед замером (раньше off-screen таргет считался отсутствующим → шаг деградировал в центрированную карточку; scroll-листенер пере-меряет после smooth-scroll); STEPS 7→9: +s6 «Аղբյուրների ռադար» (spotlight на [data-tour="sources"] — атрибут добавлен на секцию Signal sources дашборда), +s9 «Ինչով է հարուստ համակարգը» (what's new: A/B, ZIP, фоновый батч, CSV) — s6/s9 вставлены между существующими, порядок: intro, nav, brand, mode, palette, sources, honesty, what's-inside, all-set
  - VERIFIED: шаг 6 — «Signal sources radar», spotlight ВИДЕН (scrollIntoView сработал, rect 225px), скриншот; шаг 9 «What's inside»; Finish закрывает, dialogs=0
- СТАЙЛИНГ: сегментированный per-item прогресс-бар во время прогона (тонкие неоновые сегменты с glow на выполненных, shimmer-переходы); пульсирующий resume-chip (animate-ping точка + neon-бордер); кнопка CSV с иконкой в neon-2; batchActive-карточка с неоновой рамкой (было) + новые чипы
- i18n: planner.ts +3 ключа ×3 (batchResume {done}/{total}, batchFailed, batchInterrupted) — 66×3; analytics.ts +3 ×3 (exportCsv, exportCsvDone {n}, exportCsvEmpty) — 45×3; core.ts +4 ×3 (tour.s8.title/text, tour.s9.title/text) — 145×3; ПОЛНАЯ парity-проверка всех 10 словарей — ALL-PARITY-OK
- bun run lint 0; bunx tsc --noEmit 0 (вне pre-existing examples/skills); dev.log: только известные serper-429 (upstream web_search квота), все step-роуты 200
- Скриншоты: tool-results/qa9-resume-chip.png, qa9-tour-sources-spotlight.png, qa9-planner-final.png, qa9-dashboard-final.png

Stage Summary:
- 2 фичи верифицированы живьём: durable batch (jobs-очередь, checkpoint, резюм после F5, cancel через jobs API, честная деградация per-item с aiWritten-флагом) и CSV-экспорт аналитики (реальные DB-цифры, escaping, честный empty-тост)
- 1 UX-фикс: тур теперь скроллит spotlight-таргет в вьюпорт (off-screen таргеты больше не деградируют в центрированную карточку) + 2 новых шага (sources radar, what's new)
- Риски: step-паттерн держит вкладку открытой во время активного прогона (резюм после reload покрывает обрыв, но авто-продолжения без пользователя нет — честно); параллельные step-вызовы из двух вкладок могут задвоить пункт (маловероятно в single-user, чекпоинт-клэйм не атомарный); 2/18 пунктов деградировали при провайдер-хиккапах (aiWritten:false — видно в job output)
- Кандидаты next: авто-резюм через dashboard job-feed polling (перенести step-луп в общий воркер-модуль), периодический TREND_SEARCH в autopilot (аккуратно с квотой serper), онбординг-тур: подсветка фич по их модулям (сейчас только дашборд-таргеты), per-item «Создано» бейджи в чекпоинте на карточке плана
