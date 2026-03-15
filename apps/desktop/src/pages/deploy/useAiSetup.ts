import { useState } from "react";
import { AI_PROVIDERS } from "./types";

export function useAiSetup() {
  const [selectedProvider, setSelectedProvider] = useState<string>(AI_PROVIDERS[0].id);
  const [apiKey, setApiKey] = useState("");

  return {
    selectedProvider,
    setSelectedProvider,
    apiKey,
    setApiKey,
  };
}
