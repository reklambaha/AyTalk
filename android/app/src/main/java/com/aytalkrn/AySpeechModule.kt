package com.aytalkrn

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.max

class AySpeechModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val SAMPLE_RATE = 16000
    private const val CHANNEL_CONFIG =
      AudioFormat.CHANNEL_IN_MONO
    private const val AUDIO_FORMAT =
      AudioFormat.ENCODING_PCM_16BIT

    private const val SPEECH_THRESHOLD = 650
    private const val SILENCE_AFTER_SPEECH_MS = 1150L
    private const val MIN_SPEECH_MS = 350L
    private const val DEFAULT_MAX_MS = 12000L
  }

  private val recording = AtomicBoolean(false)

  @Volatile
  private var activeRecorder: AudioRecord? = null

  override fun getName(): String = "AySpeech"

  @ReactMethod
  fun capture(
    maxDurationMs: Double,
    promise: Promise,
  ) {
    if (
      ContextCompat.checkSelfPermission(
        reactContext,
        Manifest.permission.RECORD_AUDIO,
      ) != PackageManager.PERMISSION_GRANTED
    ) {
      promise.reject(
        "MIC_PERMISSION",
        "Mikrofon izni verilmedi.",
      )
      return
    }

    if (!recording.compareAndSet(false, true)) {
      promise.reject(
        "ALREADY_RECORDING",
        "AyTalk zaten ses kaydediyor.",
      )
      return
    }

    Thread {
      var recorder: AudioRecord? = null

      try {
        val requestedMax =
          maxDurationMs.toLong().coerceIn(
            1500L,
            DEFAULT_MAX_MS,
          )

        val minimumBuffer =
          AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            CHANNEL_CONFIG,
            AUDIO_FORMAT,
          )

        if (minimumBuffer <= 0) {
          throw IllegalStateException(
            "Android ses buffer'ı oluşturulamadı."
          )
        }

        val bufferSize = max(
          minimumBuffer * 2,
          SAMPLE_RATE / 2,
        )

        recorder = AudioRecord(
          MediaRecorder.AudioSource.VOICE_RECOGNITION,
          SAMPLE_RATE,
          CHANNEL_CONFIG,
          AUDIO_FORMAT,
          bufferSize,
        )

        if (
          recorder.state != AudioRecord.STATE_INITIALIZED
        ) {
          throw IllegalStateException(
            "Mikrofon başlatılamadı."
          )
        }

        activeRecorder = recorder

        val pcm = ByteArrayOutputStream()
        val buffer = ByteArray(bufferSize)

        var speechStarted = false
        var speechStartAt = 0L
        var lastSpeechAt = 0L
        val startedAt = System.currentTimeMillis()

        recorder.startRecording()

        while (recording.get()) {
          val now = System.currentTimeMillis()

          if (now - startedAt >= requestedMax) {
            break
          }

          val read = recorder.read(
            buffer,
            0,
            buffer.size,
          )

          if (read <= 0) {
            continue
          }

          pcm.write(buffer, 0, read)

          var amplitudeSum = 0L
          var samples = 0

          var index = 0
          while (index + 1 < read) {
            val sample =
              (buffer[index].toInt() and 0xFF) or
                (buffer[index + 1].toInt() shl 8)

            amplitudeSum += abs(sample.toShort().toInt())
            samples += 1
            index += 2
          }

          val averageAmplitude =
            if (samples > 0) {
              (amplitudeSum / samples).toInt()
            } else {
              0
            }

          if (averageAmplitude >= SPEECH_THRESHOLD) {
            if (!speechStarted) {
              speechStarted = true
              speechStartAt = now
            }
            lastSpeechAt = now
          }

          if (
            speechStarted &&
            now - speechStartAt >= MIN_SPEECH_MS &&
            now - lastSpeechAt >= SILENCE_AFTER_SPEECH_MS
          ) {
            break
          }
        }

        try {
          recorder.stop()
        } catch (_: Exception) {
        }

        val pcmBytes = pcm.toByteArray()

        if (pcmBytes.size < SAMPLE_RATE / 3) {
          throw IllegalStateException(
            "Konuşma algılanmadı."
          )
        }

        val wav = createWav(pcmBytes)
        val durationMs =
          (
            pcmBytes.size.toDouble() /
              (SAMPLE_RATE * 2.0) *
              1000.0
          ).toInt()

        val result = Arguments.createMap().apply {
          putString(
            "audioBase64",
            Base64.encodeToString(
              wav,
              Base64.NO_WRAP,
            ),
          )
          putInt("durationMs", durationMs)
        }

        promise.resolve(result)
      } catch (error: Exception) {
        promise.reject(
          "AUDIO_CAPTURE_ERROR",
          error.message ?: "Ses kaydedilemedi.",
          error,
        )
      } finally {
        recording.set(false)

        try {
          if (
            recorder?.recordingState ==
            AudioRecord.RECORDSTATE_RECORDING
          ) {
            recorder.stop()
          }
        } catch (_: Exception) {
        }

        try {
          recorder?.release()
        } catch (_: Exception) {
        }

        activeRecorder = null
      }
    }.start()
  }

  @ReactMethod
  fun cancel() {
    recording.set(false)

    try {
      activeRecorder?.stop()
    } catch (_: Exception) {
    }
  }

  override fun invalidate() {
    cancel()

    try {
      activeRecorder?.release()
    } catch (_: Exception) {
    }

    activeRecorder = null
    super.invalidate()
  }

  private fun createWav(
    pcm: ByteArray,
  ): ByteArray {
    val output = ByteArrayOutputStream()

    val channels = 1
    val bitsPerSample = 16
    val byteRate =
      SAMPLE_RATE * channels * bitsPerSample / 8
    val blockAlign =
      channels * bitsPerSample / 8
    val dataSize = pcm.size
    val totalSize = 36 + dataSize

    fun writeAscii(value: String) {
      output.write(
        value.toByteArray(Charsets.US_ASCII)
      )
    }

    fun writeIntLE(value: Int) {
      val bytes = ByteBuffer
        .allocate(4)
        .order(ByteOrder.LITTLE_ENDIAN)
        .putInt(value)
        .array()
      output.write(bytes)
    }

    fun writeShortLE(value: Int) {
      val bytes = ByteBuffer
        .allocate(2)
        .order(ByteOrder.LITTLE_ENDIAN)
        .putShort(value.toShort())
        .array()
      output.write(bytes)
    }

    writeAscii("RIFF")
    writeIntLE(totalSize)
    writeAscii("WAVE")

    writeAscii("fmt ")
    writeIntLE(16)
    writeShortLE(1)
    writeShortLE(channels)
    writeIntLE(SAMPLE_RATE)
    writeIntLE(byteRate)
    writeShortLE(blockAlign)
    writeShortLE(bitsPerSample)

    writeAscii("data")
    writeIntLE(dataSize)
    output.write(pcm)

    return output.toByteArray()
  }
}
