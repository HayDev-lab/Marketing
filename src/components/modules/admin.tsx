"use client";

import { ShieldCheck, ShieldX } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useApp } from "@/lib/store";
import { useI18n } from "@/lib/use-i18n";
import { AdminTab } from "@/components/modules/settings";

/**
 * §30 standalone Admin view — platform-owner console.
 * Reuses the AdminTab surface (stats / users / switches / blacklist / providers)
 * in a dedicated view instead of a Settings tab. Server-side enforcement lives
 * in /api/admin (requireAdmin → 403 NOT_ADMIN); here we gate the nav visibility
 * client-side and render an honest 403 panel if the view is reached without rights.
 */
export function AdminModule() {
  const { t } = useI18n();
  const isAdmin = useApp((s) => s.user)?.isAdmin === true;

  if (!isAdmin) {
    return (
      <Card className="glass rounded-2xl">
        <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
          <ShieldX className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm font-medium">403 NOT_ADMIN</p>
          <p className="text-xs text-muted-foreground">{t("admin.err.load")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="grid gap-4" aria-labelledby="admin-view-title">
      <div className="glass-strong neon-border rounded-2xl p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--neon)]/15">
            <ShieldCheck className="h-5 w-5 text-[var(--neon)]" aria-hidden />
          </span>
          <div className="grid gap-1">
            <h1 id="admin-view-title" className="heading-accent text-lg font-semibold sm:text-xl">
              {t("admin.title")}
            </h1>
            <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">{t("admin.desc")}</p>
          </div>
        </div>
      </div>
      <AdminTab />
    </section>
  );
}
