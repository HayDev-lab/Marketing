# UI migration plan
1. Preserve database schema and existing workflows. No destructive migration.
2. New shell: Home / Create / Trends / Planner / Publish / Analytics / Settings. Retain legacy view IDs.
3. Create groups Image / Video / Post / Music / Voice / Avatar. Existing studios remain operational inside the new context. Video editor now positions script, private-media canvas and context properties in three columns with scenes/assembly underneath. Frame-accurate timeline editing and scene ordering remain outstanding.
4. Home brief hands off to image/video studios; Post creates a persisted manual draft with no paid AI call. Brands without a selection route to brand setup.
5. Settings groups account/language, businesses, provider settings, budgets/subscriptions/audit, Autopilot, MCP, assets and admin. Admin continues to use server authorization.
6. Autopilot enabled flag persists server-side. STOP disables enabled, generation permissions and trend scheduler. Supervised cycle rechecks enabled before external actions. Already submitted jobs retain existing tracking. A strict atomic stop-vs-dispatch guarantee remains unresolved.
7. Asset listing is owner-scoped and avoids storage keys; downloads use existing private raw endpoint. No delete/archive action is invented. Metadata filters, archive schema, campaign linkage and pagination remain outstanding.
8. Browser QA: all 7 requested viewports, HY/RU/EN, keyboard, reduced motion, failures and complete paid Golden Path. Requires reachable browser preview and real provider/social setup.
