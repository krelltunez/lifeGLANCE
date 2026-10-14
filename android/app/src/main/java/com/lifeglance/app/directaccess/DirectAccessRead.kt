package com.lifeglance.app.directaccess

import org.json.JSONObject

/**
 * Direct Access sync (docs/direct-access.md): how one read of the
 * snapshot in the user's folder is classified.
 *
 * The folder is kept in step by a third-party app (Syncthing, FolderSync,
 * Autosync, a Nextcloud client), and the web layer runs the same cycle dayGLANCE runs
 * for its folder. That cycle reads one classification on every platform, and
 * this object produces it:
 *
 *   absent       the file is not there: the web layer may seed it.
 *   downloading  the file is there but cannot be trusted yet: a zero-length
 *                placeholder (a tool part-way through replacing it, or a
 *                provider that materialises cloud-only files empty), or a read
 *                that failed in a way worth retrying. NEVER reported as
 *                absent, because absent means "seed over it".
 *   error        the folder itself cannot be used: the SAF grant was revoked,
 *                the tree is gone, or the provider refuses to open the file.
 *   text         the file's content.
 *
 * Pure over the [Source] seam so every branch is unit-testable on the JVM;
 * DirectAccessRepository binds it to DocumentFile, for the snapshot and for
 * any file named by a path (Phase 5: the household roster), which only
 * changes the name in the messages.
 */
object DirectAccessRead {

    const val SYNC_FILE = "lifeglance-sync.json"

    /** One read's view of the folder. Each call may hit the provider. */
    interface Source {
        fun configured(): Boolean
        /** A tree URI is stored but the persisted grant behind it is gone. */
        fun grantRevoked(): Boolean
        fun folderExists(): Boolean
        fun fileExists(): Boolean
        fun fileIsDirectory(): Boolean
        fun fileLength(): Long
        /** NULL when the provider refused to open the document; throws on I/O failure. */
        fun readText(): String?
    }

    sealed class Result {
        object Absent : Result()
        object Downloading : Result()
        data class Error(val message: String) : Result()
        data class Text(val text: String) : Result()
    }

    fun classify(src: Source, name: String = SYNC_FILE): Result {
        if (!src.configured()) return Result.Error("no folder connected")
        // The folder first: a revoked grant or a vanished tree must read as an
        // error, not as "the file is absent" (which would seed a new file into
        // whatever reappears there).
        if (src.grantRevoked()) return Result.Error("permission denied")
        if (!src.folderExists()) return Result.Error("folder not found")
        if (!src.fileExists()) return Result.Absent
        if (src.fileIsDirectory()) return Result.Error("$name is not a file")
        if (src.fileLength() == 0L) return Result.Downloading
        val text = try {
            src.readText()
        } catch (e: Exception) {
            // A provider mid-sync, a lock held by the syncing app, a transient
            // I/O failure: the next poll retries.
            return Result.Downloading
        } ?: return Result.Error("could not open $name")
        // The read raced a truncate-then-write by another app.
        if (text.isEmpty()) return Result.Downloading
        return Result.Text(text)
    }

    /** The JSON the web adapter parses: { kind, text? | error? }. */
    fun toJson(result: Result): String = JSONObject().apply {
        when (result) {
            Result.Absent -> put("kind", "absent")
            Result.Downloading -> put("kind", "downloading")
            is Result.Error -> { put("kind", "error"); put("error", result.message) }
            is Result.Text -> { put("kind", "text"); put("text", result.text) }
        }
    }.toString()
}
