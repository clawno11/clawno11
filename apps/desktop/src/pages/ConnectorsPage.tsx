import { Plug } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useInstanceStore } from "../store/instances";
import { FeishuWizard } from "./connectors/FeishuWizard";
import { TailscalePanel } from "./connectors/TailscalePanel";
import { XEdgePanel } from "./connectors/XEdgePanel";
import { MobileQrPanel } from "./connectors/MobileQrPanel";
import { TelegramPanel } from "./connectors/TelegramPanel";
import { DiscordPanel } from "./connectors/DiscordPanel";
import { WeixinPanel } from "./connectors/WeixinPanel";

export function ConnectorsPage() {
  const { t } = useTranslation();
  const { instances } = useInstanceStore();
  const onlineInstance = instances.find((i) => i.health === "online");
  const activePort = onlineInstance?.port ?? 18789;

  return (
    <div className="page-enter p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Plug size={22} className="text-primary" />
          {t("connectors.title")}
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          {t("connectors.desc")}
        </p>
      </div>

      {/* 手机 App 连接 */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-0.5">
          {t("connectors.mobileConnTitle")}
        </p>
        <MobileQrPanel />
      </div>

      {/* 国内 IM：微信 + 飞书 */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-0.5">
          {t("connectors.imTitle")}
        </p>
        <div className="space-y-3">
          <WeixinPanel />
          <FeishuWizard />
        </div>
      </div>

      {/* 国际 IM：Telegram + Discord */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-0.5">
          {t("connectors.intlImTitle")}
        </p>
        <div className="space-y-3">
          <TelegramPanel activePort={activePort} />
          <DiscordPanel activePort={activePort} />
        </div>
      </div>

      {/* 远程访问：xEdge（国内）+ Tailscale（国际） */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-0.5">
          {t("connectors.remoteAccessTitle")}
        </p>
        <div className="space-y-3">
          <XEdgePanel />
          <TailscalePanel />
        </div>
      </div>
    </div>
  );
}
