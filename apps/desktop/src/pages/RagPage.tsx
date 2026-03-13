import { RagPageContent } from "@clawno/shared/components/rag/RagPageContent";
import { readTextFile } from "../ipc";
import { useInstanceStore } from "../store/instances";

export function RagPage() {
  const { instances } = useInstanceStore();

  return (
    <div className="page-enter p-6 max-w-3xl mx-auto space-y-6">
      <RagPageContent
        instances={instances}
        onReadFile={readTextFile}
      />
    </div>
  );
}
