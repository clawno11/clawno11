import { useTranslation } from "react-i18next";
import { TopBar } from "../components/TopBar";
import { RouterPageContent } from "@clawno/shared/components/router/RouterPageContent";
import { useInstanceStore } from "../store/instances";

export function RouterPage() {
  const { t } = useTranslation();
  const { instances } = useInstanceStore();

  return (
    <div className="flex flex-col h-full">
      <TopBar title={t("router.title")} subtitle={t("router.desc")} back />
      <div className="flex-1 scrollable p-4 space-y-4 pb-6">
        <RouterPageContent instances={instances} />
      </div>
    </div>
  );
}
