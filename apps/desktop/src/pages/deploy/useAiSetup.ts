import { useState } from "react";
import { AI_PROVIDERS } from "./types";

export function useAiSetup() {
  const [selectedProvider, setSelectedProvider] = useState<string>(AI_PROVIDERS[0].id);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [skipAi, setSkipAi] = useState(false);

  const currentProviderInfo = AI_PROVIDERS.find(
    (p) => p.id === selectedProvider,
  );

  return {
    selectedProvider,
    setSelectedProvider,
    apiKey,
    setApiKey,
    showApiKey,
    setShowApiKey,
    skipAi,
    setSkipAi,
    currentProviderInfo,
  };
}
