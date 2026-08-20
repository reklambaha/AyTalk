package com.aytalkrn

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import kotlin.math.max

class AyAudioRouteModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  private val audioManager =
    reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  override fun getName(): String = "AyAudioRoute"

  private fun boostVoiceCallVolumeForSpeaker() {
    val stream = AudioManager.STREAM_VOICE_CALL
    val maximum = audioManager.getStreamMaxVolume(stream)
    val current = audioManager.getStreamVolume(stream)
    val minimumSpeakerLevel = (maximum * 0.82f).toInt()

    if (current < minimumSpeakerLevel) {
      audioManager.setStreamVolume(
        stream,
        max(current, minimumSpeakerLevel),
        0,
      )
    }
  }


  @ReactMethod
  fun setSpeakerEnabled(enabled: Boolean, promise: Promise) {
    try {
      audioManager.mode = AudioManager.MODE_IN_COMMUNICATION

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val targetType =
          if (enabled) {
            AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
          } else {
            AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
          }

        val targetDevice =
          audioManager.availableCommunicationDevices.firstOrNull {
            it.type == targetType
          }

        if (targetDevice != null) {
          val changed = audioManager.setCommunicationDevice(targetDevice)
          if (!changed) {
            throw IllegalStateException("Ses çıkışı değiştirilemedi.")
          }
        } else if (enabled) {
          @Suppress("DEPRECATION")
          audioManager.isSpeakerphoneOn = true
        }
      } else {
        @Suppress("DEPRECATION")
        audioManager.isSpeakerphoneOn = enabled
      }

      if (enabled) {
        boostVoiceCallVolumeForSpeaker()
      }

      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject(
        "AUDIO_ROUTE_ERROR",
        error.message ?: "Ses çıkışı değiştirilemedi.",
        error,
      )
    }
  }

  override fun invalidate() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      try {
        audioManager.clearCommunicationDevice()
      } catch (_: Exception) {
      }
    }

    super.invalidate()
  }
}
