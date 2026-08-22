package com.lifeglance.app.media

import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

/**
 * Native media pickers for milestone attachments. Two methods, two system UIs,
 * zero permissions:
 *
 *   pickPhoto()  — the Android Photo Picker ([PickVisualMedia], image-only).
 *                  No READ_MEDIA_IMAGES, no permission prompt; the system runs
 *                  the picker in its own process and grants access to only the
 *                  chosen item. The contract itself falls back to an
 *                  ACTION_OPEN_DOCUMENT image chooser on devices without the
 *                  backported picker, so minSdk 24 is fine.
 *
 *   pickMedia()  — SAF ACTION_OPEN_DOCUMENT filtered to audio + video. The
 *                  Photo Picker is visual-only, and the web layer's "attach
 *                  media" field accepts either kind in one tap, so one SAF
 *                  dialog covering both is the only single-dialog answer. Also
 *                  permission-free.
 *
 * Both resolve `{ path, name, mimeType }` after copying the item's bytes into
 * app-owned cache — the content-URI grant is temporary and scoped, so the copy
 * happens immediately, on a background thread (video can be large). The web
 * layer turns `path` into a fetchable URL via Capacitor.convertFileSrc() and
 * reads it straight into a Blob → IndexedDB, exactly like a file-input File.
 * A cancelled picker resolves `{ cancelled: true }` rather than rejecting,
 * since cancelling is a normal outcome, not an error.
 *
 * The existing web storage path is unchanged; it just receives bytes from a
 * nicer picker (src/native/mediaPicker.js is the JS half).
 */
@CapacitorPlugin(name = "MediaPicker")
class MediaPickerPlugin : Plugin() {

    @PluginMethod
    fun pickPhoto(call: PluginCall) {
        val intent = PickVisualMedia().createIntent(
            context,
            PickVisualMediaRequest(PickVisualMedia.ImageOnly)
        )
        startActivityForResult(call, intent, "pickerResult")
    }

    @PluginMethod
    fun pickMedia(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("audio/*", "video/*"))
        }
        startActivityForResult(call, intent, "pickerResult")
    }

    // Shared result handler: both pickers deliver a single content URI (or none).
    @ActivityCallback
    private fun pickerResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val uri = result.data?.data
        if (uri == null) {
            val ret = JSObject()
            ret.put("cancelled", true)
            call.resolve(ret)
            return
        }
        // Copy off the main thread; openInputStream + a video-sized copy would
        // jank or ANR the UI otherwise.
        Thread {
            try {
                val copied = copyToCache(uri)
                val ret = JSObject()
                ret.put("path", copied.file.absolutePath)
                ret.put("name", copied.name)
                ret.put("mimeType", copied.mimeType)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("Failed to read the selected item: ${e.message}")
            }
        }.start()
    }

    private class CopiedItem(val file: File, val name: String, val mimeType: String)

    // Copies the content URI's bytes into cache/picked_media/, returning the
    // file plus the item's display name and MIME type. The directory is cleared
    // first: only one pick is ever in flight, the previous file has long since
    // been read into IndexedDB, and clearing here keeps stale multi-hundred-MB
    // videos from accumulating (the OS may also clear cacheDir under pressure,
    // which is fine — by then the bytes live in IndexedDB).
    private fun copyToCache(uri: Uri): CopiedItem {
        val resolver = context.contentResolver

        var name = "picked"
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst() && !c.isNull(0)) name = c.getString(0)
        }
        // The name becomes a filename; strip separators so it can't escape the dir.
        name = name.replace('/', '_').replace('\\', '_')

        val mimeType = resolver.getType(uri) ?: "application/octet-stream"

        val dir = File(context.cacheDir, "picked_media")
        dir.deleteRecursively()
        dir.mkdirs()

        val out = File(dir, name)
        resolver.openInputStream(uri)?.use { input ->
            out.outputStream().use { output -> input.copyTo(output) }
        } ?: throw IllegalStateException("content resolver returned no stream")

        return CopiedItem(out, name, mimeType)
    }
}
