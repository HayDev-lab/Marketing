# CURRENT_STATE.md — ՀայDev Marketing (аудит по MASTER PROMPT §0)

Дата: 2026-09-30 (после Round 11 / Task 19). Источник требований: `upload/Pasted Content_1790802969188.txt` (Master Prompt Pack) + `upload/HayDev_Marketing_Master_Prompt_Pack.txt`.

## Что уже работает (проверено в браузере/API)

| Раздел спеки | Статус | Где |
|---|---|---|
| §3 Auth (login/register/logout/reset) | ✅ работает | `src/app/api/auth`, `auth-view.tsx`; + token-фолбэк для iframe (Task 19) |
| §4 Languages HY/RU/EN | ✅ | `src/lib/i18n`, parity проверяется |
| §5 HayDevOS design system, WebGL core | ✅ | `signal-core.tsx`, `globals.css`, self-hosted fonts |
| §7 Onboarding tour | ✅ | `onboarding-tour.tsx` |
| §8 Website Business Analyzer | ✅ | `brands/[id]/analyze`, LLM-пайплайн |
| §9 Brand Memory (facts/profile) | ✅ | `BusinessFact`, `BrandProfile` |
| §10-11 Trend Intelligence + Trend→Generation | ✅ | `src/lib/trends/*` (engine/scoring/dedup/providers/adapt/draft-bridge), SIGNAL RADAR UI, honest HYPOTHESIS-guard |
| §12 Marketing Strategy | ✅ | `plans/marketing` |
| §7 Planner + batch content jobs | ✅ durable jobs | `plans/content/batch*` |
| §14 Prompt Library | ✅ 200 шаблонов | `PromptTemplate` |
| §15 Prompt Compiler chatbot | ✅ | `prompts/compile`, `trends/prompt-compiler.ts` |
| §17 Image Studio | ✅ | `generate/image`, routing по провайдерам |
| §18 Video Studio + durable jobs + resume | ✅ | `VideoProject/VideoScene`, `jobs/[id]` step API |
| §22 Voice / TTS | ✅ | `generate/tts` (z-ai), voice profiles |
| §23 Subtitles | ⚠️ частично | модель `SubtitleTrack` есть; UI-генерация — в video-пайплайне, отдельного менеджера нет |
| §16 Publishing + Calendar | ✅ | `ScheduledPost`, `publishing.tsx` (calendar) |
| §Analytics | ✅ | `analytics.tsx`, `CostLedger` спарклайны |
| §19 MCP Server | ✅ | `api/mcp` + tokens |
| Durable jobs queue | ✅ | `GenerationJob` claim/attempt/checkpoint |
| Cost ledger + budgets | ✅ | `ledger.assertBudget`, AutopilotPolicy |

## Что отсутствует (gap против спеки)

1. ~~§31 Subscriptions (FREE/CREATOR/PRO/BUSINESS) + SubscriptionModelPolicy + кредитные квоты~~ — ✅ РЕАЛИЗОВАНО (Task 20): модель `Subscription`, `src/lib/subscription.ts` (PLANS + assertQuota/assertBrandQuota), `/api/subscription` GET/switch, UI-вкладка «Տարիֆ» в Settings, квоты встроены в image/video/tts/brands, i18n ×3. Billing-процессора нет — переключение честное sandbox-switch.
2. §24 Talking Avatar Studio — ❌ нет (нужен plugin-провайдер; след. раунд).
3. §20-21 Music (own upload + generation) — ⚠️ модель `MusicAsset` есть, генерации/загрузки нет.
4. §30 Внутренний админ-конфиг (switch defaults, disable models) — ⚠️ частично через `settings/providers`; отдельного admin-view нет.
5. Email-доставка (SMTP) для reset — dev_inline честный режим.

## Что опасно менять

- Схема `GenerationJob` (durable jobs) — живёт продакшн-логика пайплайнов.
- `src/lib/auth.ts` — token-фолбэк критичен для preview-iframe (Task 19).
- `page.tsx` bootstrap self-heal activeBrandId (Task 18).

## Переиспользуемое

- `ledger.usage()` — уже считает месячный расход → база кредитных квот.
- `ApiError(402, ...)` паттерн — квоты встраиваются туда же, где assertBudget.
- `Tabs` в settings.tsx + i18n-конвейер dicts/core.ts ×3 локали.

## Миграции, планируемые в этом раунде

- + модель `Subscription` (userId unique, plan, status, renewsAt, metaJson) — additive, без разрушений.
