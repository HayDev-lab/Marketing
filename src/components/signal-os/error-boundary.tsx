"use client";
import { Component, type ReactNode } from "react";
import { useI18n } from "@/lib/use-i18n";
function ErrorView({ retry }: {
    retry: () => void;
}) { const { t } = useI18n(); return <div className="os-error" role="alert"><p>{t("signal.failed")}</p><button className="os-button" onClick={retry}>{t("signal.retry")}</button></div>; }
export class WorkspaceBoundary extends Component<{
    children: ReactNode;
}, {
    failed: boolean;
}> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() { return this.state.failed ? <ErrorView retry={() => this.setState({ failed: false })}/> : this.props.children; }
}
