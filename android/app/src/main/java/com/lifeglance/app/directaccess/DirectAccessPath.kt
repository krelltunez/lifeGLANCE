package com.lifeglance.app.directaccess

/**
 * Direct Access sync (docs/direct-access.md (and dayGLANCE's docs/direct-access-sync.md), Phase 5): a path relative to
 * the picked folder, confined to it.
 *
 * The web layer names files by a path relative to the folder (the household
 * roster at GLANCE/users/glance-users.json; event files under GLANCE/events/).
 * A path that would escape the folder is refused HERE, in the shell, never
 * left to the renderer: `..` anywhere, an absolute path, an empty name. The
 * desktop store does the same with path.resolve plus a prefix check
 * (electron/directAccessStore.ts, resolveInside). Pure, so every rule is
 * unit-tested on the JVM; DirectAccessRepository walks the result over
 * DocumentFile.
 */
object DirectAccessPath {

    /**
     * The path's segments, or null when it is not a path inside the folder.
     * `.` and empty segments are skipped (so "GLANCE//users/" is fine); a
     * leading `/` or `\`, a Windows drive, or any `..` is refused. An empty
     * result names the folder itself.
     */
    fun segments(rel: String?): List<String>? {
        if (rel == null) return null
        if (rel.startsWith("/") || rel.startsWith("\\") || rel.contains(":")) return null
        val out = ArrayList<String>()
        for (raw in rel.split('/', '\\')) {
            val seg = raw.trim()
            if (seg.isEmpty() || seg == ".") continue
            if (seg == "..") return null
            out.add(seg)
        }
        return out
    }

    /** The segments of a path that must name a file: inside the folder and not the folder itself. */
    fun fileSegments(rel: String?): List<String>? = segments(rel)?.takeIf { it.isNotEmpty() }
}
