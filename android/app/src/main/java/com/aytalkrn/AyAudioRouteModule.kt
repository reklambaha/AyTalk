package com.aytalkrn

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AyAudioRouteModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  private val audioManager =
    reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  override fun getName(): String = "AyAudioRoute"

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
          val changed =
            audioManager.setCommunicationDevice(targetDevice)

          if (!changed) {
            throw IllegalStateException(
              "Ses çıkışı değiştirilemedi."
            )
          }
        } else {
          @Suppress("DEPRECATION")
          audioManager.isSpeakerphoneOn = enabled
        }
      } else {
        @Suppress("DEPRECATION")
        audioManager.isSpeakerphoneOn = enabled
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

    try {
      audioManager.mode = AudioManager.MODE_NORMAL
    } catch (_: Exception) {
    }

    super.invalidate()
  }
}