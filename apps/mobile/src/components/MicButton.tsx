import { useCallback, useEffect, useRef } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAudioRecorder } from "@clawno/shared/hooks/useAudioRecorder";
import { isAudioCapable } from "@clawno/shared/components/ai/types";
import { invoke } from "@tauri-apps/api/core";

export interface MicButtonProps {
  /** Current AI provider id (e.g. "openai", "zai") — determines audio vs STT mode */
  provider: string | null;
  /** Called when audio is ready to send directly to LLM (audio-capable model) */
  onAudioReady: (base64: string, format: string) => void;
  /** Called when STT produced text (non-audio model fallback) */
  onTextReady: (text: string) => void;
  disabled?: boolean;
}

export function MicButton({ provider, onAudioReady, onTextReady, disabled }: MicButtonProps) {
  const { t } = useTranslation();
  const audioMode = provider ? isAudioCapable(provider) : true;
  const {
    isRecording, error, audioFormat,
    startRecording, stopRecording, reset,
  } = useAudioRecorder();

  const sttActiveRef = useRef(false);

  // STT fallback via Tauri speech plugin (Kotlin SpeechRecognizer)
  const startStt = useCallback(async () => {
    sttActiveRef.current = true;
    try {
      const result = await invoke<{ text: string }>("plugin:speech|startRecognition", {});
      if (result?.text && sttActiveRef.current) onTextReady(result.text);
    } catch (e) {
      console.error("STT failed:", e);
    } finally {
      sttActiveRef.current = false;
    }
  }, [onTextReady]);

  const stopStt = useCallback(() => {
    sttActiveRef.current = false;
    invoke("plugin:speech|stopRecognition", {}).catch(() => {});
  }, []);

  const handlePress = useCallback(async () => {
    if (disabled) return;

    if (audioMode) {
      if (isRecording) {
        const b64 = await stopRecording();
        if (b64) onAudioReady(b64, audioFormat);
      } else {
        await startRecording();
      }
    } else {
      if (sttActiveRef.current) {
        stopStt();
      } else {
        await startStt();
      }
    }
  }, [disabled, audioMode, isRecording, stopRecording, startRecording, onAudioReady, audioFormat, startStt, stopStt]);

  useEffect(() => () => { reset(); stopStt(); }, [reset, stopStt]);

  const active = isRecording || sttActiveRef.current;
  const hasError = !!error;

  return (
    <button
      onClick={handlePress}
      disabled={disabled}
      title={active ? t("voice.tapToStop") : t("voice.tapToSpeak")}
      className={`touch-btn w-11 h-11 flex items-center justify-center rounded-2xl flex-shrink-0 transition-all ${
        active
          ? "text-white"
          : hasError
            ? "text-red-400"
            : "text-[hsl(var(--muted-foreground))]"
      } disabled:opacity-40`}
      style={active
        ? { background: "#ef4444", boxShadow: "0 0 16px rgba(239,68,68,0.4)" }
        : { background: "hsl(var(--muted))", border: "1px solid rgba(6,182,212,0.2)" }}
    >
      {active ? (
        <Loader2 size={16} className="animate-spin" />
      ) : hasError ? (
        <MicOff size={16} />
      ) : (
        <Mic size={16} />
      )}
    </button>
  );
}
