import { RouterPageContent } from "@clawno/shared/components/router/RouterPageContent";
import { useInstanceStore } from "../store/instances";

export function RouterPage() {
  const { instances } = useInstanceStore();

  return (
    <div className="page-enter p-6 max-w-3xl mx-auto space-y-6">
      <RouterPageContent instances={instances} />
    </div>
  );
}
