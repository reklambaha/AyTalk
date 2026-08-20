package com.aytalkrn

import android.content.ContentResolver
import android.net.Uri
import android.provider.DocumentsContract
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class AyFileModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "AyFile"

  @ReactMethod
  fun zipDirectory(
    treeUriString: String,
    outputName: String,
    promise: Promise,
  ) {
    try {
      val treeUri = Uri.parse(treeUriString)
      val rootId =
        DocumentsContract.getTreeDocumentId(treeUri)
      val directory = File(
        reactApplicationContext.cacheDir,
        "aytalk-folder-share",
      )
      if (!directory.exists()) directory.mkdirs()

      val safeName = outputName
        .replace(Regex("[^A-Za-z0-9._-]"), "_")
        .let {
          if (it.lowercase().endsWith(".zip")) it
          else "$it.zip"
        }

      val output = File(directory, safeName)

      ZipOutputStream(FileOutputStream(output)).use { zip ->
        appendChildren(
          reactApplicationContext.contentResolver,
          treeUri,
          rootId,
          "",
          zip,
        )
      }

      promise.resolve(output.absolutePath)
    } catch (error: Exception) {
      promise.reject(
        "AYFILE_ZIP_ERROR",
        error.message,
        error,
      )
    }
  }

  private fun appendChildren(
    resolver: ContentResolver,
    treeUri: Uri,
    parentId: String,
    prefix: String,
    zip: ZipOutputStream,
  ) {
    val children = DocumentsContract
      .buildChildDocumentsUriUsingTree(
        treeUri,
        parentId,
      )

    val projection = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
    )

    resolver.query(
      children,
      projection,
      null,
      null,
      null,
    )?.use { cursor ->
      val idColumn = cursor.getColumnIndexOrThrow(
        DocumentsContract.Document.COLUMN_DOCUMENT_ID
      )
      val nameColumn = cursor.getColumnIndexOrThrow(
        DocumentsContract.Document.COLUMN_DISPLAY_NAME
      )
      val mimeColumn = cursor.getColumnIndexOrThrow(
        DocumentsContract.Document.COLUMN_MIME_TYPE
      )

      while (cursor.moveToNext()) {
        val id = cursor.getString(idColumn)
        val displayName =
          (cursor.getString(nameColumn) ?: "dosya")
            .replace("/", "_")
        val mime =
          cursor.getString(mimeColumn)
            ?: "application/octet-stream"
        val path =
          if (prefix.isEmpty()) displayName
          else "$prefix/$displayName"

        if (
          mime ==
          DocumentsContract.Document.MIME_TYPE_DIR
        ) {
          zip.putNextEntry(ZipEntry("$path/"))
          zip.closeEntry()
          appendChildren(
            resolver,
            treeUri,
            id,
            path,
            zip,
          )
        } else {
          val uri = DocumentsContract
            .buildDocumentUriUsingTree(
              treeUri,
              id,
            )

          zip.putNextEntry(ZipEntry(path))
          resolver.openInputStream(uri)?.use { input ->
            input.copyTo(zip)
          }
          zip.closeEntry()
        }
      }
    }
  }
}
