package ai.clawno11.mobile

import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin
class SpeechPlugin(private val activity: android.app.Activity) : Plugin(activity) {

    private var recognizer: SpeechRecognizer? = null

    @Command
    fun startRecognition(invoke: Invoke) {
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
            invoke.reject("Speech recognition not available on this device")
            return
        }

        val sr = SpeechRecognizer.createSpeechRecognizer(activity)
        recognizer = sr

        sr.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle?) {
                val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                val text = matches?.firstOrNull() ?: ""
                val ret = JSObject()
                ret.put("text", text)
                invoke.resolve(ret)
                cleanup()
            }

            override fun onError(error: Int) {
                val msg = when (error) {
                    SpeechRecognizer.ERROR_AUDIO -> "audio_error"
                    SpeechRecognizer.ERROR_NETWORK -> "network_error"
                    SpeechRecognizer.ERROR_NO_MATCH -> "no_match"
                    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "speech_timeout"
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "permission_denied"
                    else -> "error_$error"
                }
                invoke.reject(msg)
                cleanup()
            }

            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }

        activity.runOnUiThread { sr.startListening(intent) }
    }

    @Command
    fun stopRecognition(invoke: Invoke) {
        cleanup()
        invoke.resolve()
    }

    private fun cleanup() {
        recognizer?.destroy()
        recognizer = null
    }
}
