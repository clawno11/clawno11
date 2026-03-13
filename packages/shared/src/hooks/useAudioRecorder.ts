import { useState, useRef, useCallback } from "react";

export interface AudioRecorderState {
  isRecording: boolean;
  audioBase64: string | null;
  audioFormat: string;
  durationMs: number;
  error: string | null;
}

export interface AudioRecorderActions {
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string | null>;
  reset: () => void;
}

const PREFERRED_MIME = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  for (const mime of PREFERRED_MIME) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "audio/webm";
}

function mimeToFormat(mime: string): string {
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Hook wrapping the Web MediaRecorder API.
 * Returns base64-encoded audio suitable for multimodal LLM input.
 */
export function useAudioRecorder(): AudioRecorderState & AudioRecorderActions {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [audioFormat, setAudioFormat] = useState("webm");
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    setAudioBase64(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      setAudioFormat(mimeToFormat(mime));

      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = recorder;
      chunksRef.current = [];
      startTimeRef.current = Date.now();

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(250);
      setIsRecording(true);
    } catch (e) {
      cleanup();
      const msg = e instanceof DOMException && e.name === "NotAllowedError"
        ? "permission_denied"
        : String(e);
      setError(msg);
    }
  }, [cleanup]);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      cleanup();
      setIsRecording(false);
      return null;
    }

    return new Promise<string | null>((resolve) => {
      recorder.onstop = async () => {
        setDurationMs(Date.now() - startTimeRef.current);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        cleanup();
        setIsRecording(false);

        if (blob.size === 0) { resolve(null); return; }

        try {
          const b64 = await blobToBase64(blob);
          setAudioBase64(b64);
          resolve(b64);
        } catch {
          setError("encode_failed");
          resolve(null);
        }
      };
      recorder.stop();
    });
  }, [cleanup]);

  const reset = useCallback(() => {
    if (recorderRef.current?.state !== "inactive") {
      try { recorderRef.current?.stop(); } catch { /* already stopped */ }
    }
    cleanup();
    setIsRecording(false);
    setAudioBase64(null);
    setDurationMs(0);
    setError(null);
  }, [cleanup]);

  return {
    isRecording, audioBase64, audioFormat, durationMs, error,
    startRecording, stopRecording, reset,
  };
}
