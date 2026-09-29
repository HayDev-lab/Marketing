"use client";

import { useEffect, useState, useCallback } from "react";
import { useApp, type SessionUser } from "@/lib/store";
import { api } from "@/lib/use-i18n";
import { AuthView } from "@/components/auth-view";
import { AppShell } from "@/components/app-shell";
import { SignalCore } from "@/components/signal-core";
import { Loader2 } from "lucide-react";

interface MeResponse {
  user: SessionUser | null;
  brands?: { id: string; name: string; stage: string; website: string | null }[];
  autopilotEnabled?: boolean;
}

export default function Home() {
  const [booting, setBooting] = useState(true);
  const [brands, setBrands] = useState<{ id: string; name: string; stage: string; website: string | null }[]>([]);
  const setUser = useApp((s) => s.setUser);
  const user = useApp((s) => s.user);
  const setActiveBrand = useApp((s) => s.setActiveBrand);
  const setMode = useApp((s) => s.setMode);

  const bootstrap = useCallback(async () => {
    try {
      const data = await api<MeResponse>("/api/auth/me");
      setUser(data.user);
      if (data.brands) {
        setBrands(data.brands);
        const { activeBrandId: current } = useApp.getState();
        if (data.brands.length && !current) setActiveBrand(data.brands[0].id);
      }
      if (data.autopilotEnabled !== undefined) setMode(data.autopilotEnabled ? "autopilot" : "manual");
    } catch {
      setUser(null);
    } finally {
      setBooting(false);
    }
  }, [setActiveBrand, setMode, setUser]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const handleAuthed = () => {
    setBooting(true);
    bootstrap();
  };

  if (booting) {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden">
        <SignalCore className="absolute inset-0" />
        <div className="glass relative z-10 flex items-center gap-3 rounded-2xl px-8 py-6">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--neon)]" />
          <span className="text-sm tracking-wide text-foreground/80">ՀայDev Marketing — booting core…</span>
        </div>
      </main>
    );
  }

  if (!user) {
    return <AuthView onAuthed={handleAuthed} />;
  }

  return <AppShell brands={brands} onBrandsChanged={() => bootstrap()} />;
}
