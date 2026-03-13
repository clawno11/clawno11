import { useTranslation } from "react-i18next";
import { TopBar } from "../components/TopBar";
import { RagPageContent } from "@clawno/shared/components/rag/RagPageContent";
import { readTextFile } from "../ipc";
import { useInstanceStore } from "../store/instances";

export function RagPage() {
  const { t } = useTranslation();
  const { instances } = useInstanceStore();

  return (
    <div className="flex flex-col h-full">
      <TopBar title={t("rag.title")} subtitle={t("rag.desc")} back />
      <div className="flex-1 scrollable p-4 space-y-4 pb-6">
        <RagPageContent
          instances={instances}
          onReadFile={readTextFile}
        />
      </div>
    </div>
  );
}
