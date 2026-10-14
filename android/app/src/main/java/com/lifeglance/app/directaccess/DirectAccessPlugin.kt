package com.lifeglance.app.directaccess

import android.app.Activity
import android.content.Intent
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import org.json.JSONObject

/**
 * Direct Access sync (docs/direct-access.md): the folder half on Android, as a
 * Capacitor plugin. The user picks a folder a third-party app keeps in step
 * across devices (Syncthing, FolderSync, Autosync, a Nextcloud client); the
 * web layer reads and writes lifeglance-sync.json in it and, by path below
 * it, the household roster and the intents event set. Every method answers
 * the same JSON shapes dayGLANCE's shells answer, so src/native/directAccess.ts
 * hands the shared transport the bridge it expects.
 *
 *   status()                 → { configured, name, path, reachable }
 *   pickFolder()             → the status after the pick, or { cancelled: true }
 *   disconnect()             → {}
 *   read()                   → { kind: absent|downloading|error|text, text?, error? }
 *   write({ text })          → { ok }
 *   deleteFile()             → { ok }        the snapshot
 *   listFiles({ rel })       → { names: [...] | null }   null: refused or the folder is unusable
 *   readFile({ rel })        → as read()
 *   writeFile({ rel, text }) → { ok }
 *   deleteFileAt({ rel })    → { ok }        a missing file counts as deleted
 *   makeDir({ rel })         → { ok }
 * The path-taking methods take a path relative to the folder, confined to it
 * in [DirectAccessPath]. Plugin calls run off the main thread, where SAF I/O
 * belongs.
 *
 * Registered in MainActivity.
 */
@CapacitorPlugin(name = "DirectAccess")
class DirectAccessPlugin : Plugin() {

    private lateinit var repository: DirectAccessRepository

    override fun load() {
        repository = DirectAccessRepository(context)
    }

    private fun json(obj: JSONObject): JSObject = JSObject.fromJSONObject(obj)
    private fun ok(value: Boolean): JSObject = JSObject().put("ok", value)

    @PluginMethod
    fun status(call: PluginCall) = call.resolve(json(repository.status()))

    /** The SAF tree picker; the persistable grant is taken before the folder is recorded. */
    @PluginMethod
    fun pickFolder(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        )
        startActivityForResult(call, intent, "onFolderPicked")
    }

    @ActivityCallback
    private fun onFolderPicked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val uri = if (result.resultCode == Activity.RESULT_OK) result.data?.data else null
        if (uri == null) {
            call.resolve(JSObject().put("cancelled", true))
            return
        }
        try {
            context.contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            )
        } catch (e: Exception) {
            call.reject("could not keep access to the folder: ${e.message}")
            return
        }
        repository.setFolder(uri)
        call.resolve(json(repository.status()))
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        repository.clearFolder()
        call.resolve()
    }

    @PluginMethod
    fun read(call: PluginCall) = call.resolve(json(JSONObject(repository.read())))

    @PluginMethod
    fun write(call: PluginCall) {
        val text = call.getString("text")
        if (text == null) { call.reject("missing text"); return }
        call.resolve(ok(repository.write(text)))
    }

    @PluginMethod
    fun deleteFile(call: PluginCall) = call.resolve(ok(repository.delete()))

    @PluginMethod
    fun listFiles(call: PluginCall) {
        val raw = repository.listFiles(call.getString("rel"))
        val ret = JSObject()
        if (raw == "null") ret.put("names", JSONObject.NULL) else ret.put("names", JSArray(JSONArray(raw).let { a -> List(a.length()) { a.get(it) } }))
        call.resolve(ret)
    }

    @PluginMethod
    fun readFile(call: PluginCall) = call.resolve(json(JSONObject(repository.readFile(call.getString("rel")))))

    @PluginMethod
    fun writeFile(call: PluginCall) {
        val text = call.getString("text")
        if (text == null) { call.reject("missing text"); return }
        call.resolve(ok(repository.writeFile(call.getString("rel"), text)))
    }

    @PluginMethod
    fun deleteFileAt(call: PluginCall) = call.resolve(ok(repository.deleteFile(call.getString("rel"))))

    @PluginMethod
    fun makeDir(call: PluginCall) = call.resolve(ok(repository.makeDir(call.getString("rel"))))
}
