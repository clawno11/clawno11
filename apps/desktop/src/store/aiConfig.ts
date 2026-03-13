import { createAiConfigStore } from "@clawno/shared/stores/providerStore";
import { listConfiguredProviders } from "../ipc";

export const useAiConfigStore = createAiConfigStore(listConfiguredProviders);
