# Google media integration

Server-only models: gemini-3.1-flash-lite-image (1K), gemini-3.8-flash-lite-tts, veo-3.1-lite-generate-preview (720p, 4/6/8-second clips). No Pro/Standard/Fast fallback. Existing plan, admin, ownership and budget guards apply. Video cost estimate is $0.05/second; image allowance is $0.05 including prompt overhead. TTS reserves a conservative estimate based on text length; estimates are not provider invoices.

Images support reference editing and return the provider MIME type. TTS returns browser-playable WAV and offers Kore/Puck/Charon/Aoede/Fenrir/Leda/Orus/Zephyr. Requested speed is a spoken instruction, not an exact DSP guarantee. Armenian voice quality has not been evaluated.

Veo operation names persist in GenerationJob; refresh polls the existing operation without resubmitting. Only API video URLs and validated Google redirect hosts are accepted. API keys never go to redirected storage hosts. Duplicate active image/TTS/video jobs are rejoined; ambiguous submission failures require user action.

MediaAsset metadata remains lightweight. Private MediaPayload stores binary results in PostgreSQL so Vercel cold starts do not lose files. Maximum 25 MB per file. Database storage and egress count toward Supabase limits; large-scale media should move to private object storage. Old local files cannot be recovered if a prior deployment lost them. Assembly materializes media in temporary storage; ffmpeg availability and durable assembly workers remain existing deployment limitations.

Database rollout: scripts/prepare-media-database.cjs creates only the new payload table, enables RLS and revokes anon/authenticated access inside a transaction. Run prisma generate, this script and protect-database.cjs before next build. Runtime uses the Supabase transaction pooler with pgbouncer=true and connection_limit=1.

Checks: TypeScript, existing cloud contract tests, and new Google media tests passed. Real TTS request returned WAV. Real image request returned HTTP 429 with free-tier quota limit 0. Real Veo Lite submission returned HTTP 429. Paid billing/quota must be enabled in this Google project before image/video generation can be live verified. No automatic retry or expensive fallback was attempted.
