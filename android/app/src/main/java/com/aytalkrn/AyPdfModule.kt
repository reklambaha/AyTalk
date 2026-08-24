package com.aytalkrn

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import java.io.File
import java.io.FileOutputStream

class AyPdfModule(
    reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AyPdf"

    @ReactMethod
    fun createConversationPdf(
        title: String,
        lines: ReadableArray,
        promise: Promise,
    ) {
        try {
            val document = PdfDocument()
            val pageWidth = 595
            val pageHeight = 842
            val margin = 42f
            val contentWidth = pageWidth - (margin * 2f)
            val bottomLimit = pageHeight - margin

            val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = android.graphics.Color.rgb(10, 35, 65)
                textSize = 20f
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            }

            val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = android.graphics.Color.rgb(24, 35, 48)
                textSize = 11.5f
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
            }

            val metaPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = android.graphics.Color.rgb(90, 110, 130)
                textSize = 9.5f
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
            }

            var pageNumber = 0
            var page: PdfDocument.Page? = null
            var canvas: Canvas? = null
            var y = margin

            fun startPage() {
                pageNumber += 1
                val pageInfo = PdfDocument.PageInfo.Builder(
                    pageWidth,
                    pageHeight,
                    pageNumber,
                ).create()
                page = document.startPage(pageInfo)
                canvas = page!!.canvas
                y = margin

                canvas!!.drawText(
                    if (pageNumber == 1) title else "$title · $pageNumber",
                    margin,
                    y,
                    titlePaint,
                )
                y += 28f
                canvas!!.drawText(
                    "AyTalk LiveBridge görüşme kaydı",
                    margin,
                    y,
                    metaPaint,
                )
                y += 24f
            }

            fun finishPage() {
                page?.let { document.finishPage(it) }
                page = null
                canvas = null
            }

            fun ensureSpace(height: Float) {
                if (page == null) startPage()
                if (y + height > bottomLimit) {
                    finishPage()
                    startPage()
                }
            }

            fun drawWrapped(text: String, paint: Paint, lineHeight: Float) {
                if (text.isBlank()) {
                    ensureSpace(lineHeight)
                    y += lineHeight
                    return
                }

                text.split("\n").forEach { paragraph ->
                    var remaining = paragraph.trimEnd()
                    if (remaining.isEmpty()) {
                        ensureSpace(lineHeight)
                        y += lineHeight
                        return@forEach
                    }

                    while (remaining.isNotEmpty()) {
                        ensureSpace(lineHeight)
                        var count = paint.breakText(
                            remaining,
                            true,
                            contentWidth,
                            null,
                        )
                        if (count <= 0) count = 1

                        if (count < remaining.length) {
                            val candidate = remaining.substring(0, count)
                            val lastSpace = candidate.lastIndexOf(' ')
                            if (lastSpace > 8) count = lastSpace
                        }

                        val line = remaining.substring(0, count).trimEnd()
                        canvas!!.drawText(line, margin, y, paint)
                        y += lineHeight
                        remaining = remaining.substring(count).trimStart()
                    }
                }
            }

            startPage()

            for (index in 0 until lines.size()) {
                val value = lines.getString(index)?.trim().orEmpty()
                if (value.isEmpty()) continue
                drawWrapped(value, bodyPaint, 16f)
                ensureSpace(10f)
                y += 10f
            }

            finishPage()

            val output = File(
                reactApplicationContext.cacheDir,
                "AyTalk-LiveBridge-${System.currentTimeMillis()}.pdf",
            )
            FileOutputStream(output).use { document.writeTo(it) }
            document.close()
            promise.resolve(output.absolutePath)
        } catch (error: Throwable) {
            promise.reject("AYPDF_CREATE_FAILED", error.message, error)
        }
    }
}
