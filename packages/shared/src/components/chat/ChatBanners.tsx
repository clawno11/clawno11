import { GitBranch } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ChatBannersProps {
  routedTo: string | null;
  compact?: boolean;
}

export function ChatBanners({ routedTo, compact }: ChatBannersProps) {
  const { t } = useTranslation();
  const mx = compact ? "mx-3" : "mx-4";
  const rounded = compact ? "rounded-xl" : "rounded-lg";
  const iconSize = compact ? 12 : 13;

  return (
    <>
      {routedTo && (
        <div className={`${mx} mb-1 flex items-center gap-2 px-3 py-2 ${rounded} text-xs flex-shrink-0`}
          style={{ background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.2)", color: "hsl(var(--primary))" }}>
          <GitBranch size={iconSize} className="flex-shrink-0" />
          <span>{t("router.routedTo", { name: routedTo })}</span>
        </div>
      )}
    </>
  );
}
