package com.aytalkrn

import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import java.io.File
import java.io.FileOutputStream

class AyPdfModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "AyPdf"

  @ReactMethod
  fun createConversationPdf(
    title: String,
    lines: ReadableArray,
    promise: Promise,
  ) {
    try {
      val pdf = PdfDocument()
      val pageWidth = 595
      val pageHeight = 842
      val margin = 42f
      val maxWidth = pageWidth - margin * 2

      val titlePaint = Paint().apply {
        textSize = 20f
        isFakeBoldText = true
        color = Color.rgb(15, 38, 74)
        isAntiAlias = true
      }

      val bodyPaint = Paint().apply {
        textSize = 11f
        color = Color.rgb(20, 30, 45)
        isAntiAlias = true
      }

      val mutedPaint = Paint().apply {
        textSize = 8f
        color = Color.rgb(90, 110, 135)
        isAntiAlias = true
      }

      var pageNo = 1
      var page = pdf.startPage(
        PdfDocument.PageInfo.Builder(
          pageWidth,
          pageHeight,
          pageNo,
        ).create()
      )
      var canvas = page.canvas
      var y = margin

      fun header() {
        canvas.drawText(title, margin, y, titlePaint)
        y += 24f
        canvas.drawText(
          "AyTalk · LiveBridge görüşme kaydı",
          margin,
          y,
          mutedPaint,
        )
        y += 24f
      }

      fun newPage() {
        pdf.finishPage(page)
        pageNo += 1
        page = pdf.startPage(
          PdfDocument.PageInfo.Builder(
            pageWidth,
            pageHeight,
            pageNo,
          ).create()
        )
        canvas = page.canvas
        y = margin
        header()
      }

      fun wrap(text: String): List<String> {
        val result = mutableListOf<String>()
        text.split("\n").forEach { paragraph ->
          if (paragraph.isBlank()) {
            result.add("")
          } else {
            var current = ""
            paragraph.split(" ").forEach { word ->
              val candidate =
                if (current.isEmpty()) word else "$current $word"
              if (bodyPaint.measureText(candidate) <= maxWidth) {
                current = candidate
              } else {
                if (current.isNotEmpty()) result.add(current)
                current = word
              }
            }
            if (current.isNotEmpty()) result.add(current)
          }
        }
        return result
      }

      header()

      for (i in 0 until lines.size()) {
        val text = lines.getString(i) ?: continue
        wrap(text).forEach { row ->
          if (y > pageHeight - margin - 28f) {
            newPage()
          }
          canvas.drawText(row, margin, y, bodyPaint)
          y += 16f
        }
        y += 7f
        canvas.drawLine(
          margin,
          y,
          pageWidth - margin,
          y,
          mutedPaint,
        )
        y += 11f
      }

      pdf.finishPage(page)

      val directory = File(
        reactApplicationContext.cacheDir,
        "aytalk-pdf",
      )
      if (!directory.exists()) directory.mkdirs()

      val file = File(
        directory,
        "LiveBridge-${System.currentTimeMillis()}.pdf",
      )

      FileOutputStream(file).use { output ->
        pdf.writeTo(output)
      }
      pdf.close()

      promise.resolve(file.absolutePath)
    } catch (error: Exception) {
      promise.reject(
        "AYPDF_ERROR",
        error.message,
        error,
      )
    }
  }
}
