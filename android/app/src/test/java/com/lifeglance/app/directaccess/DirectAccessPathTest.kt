package com.lifeglance.app.directaccess

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The confinement rule for files by path, against the contract the desktop
 * store's test (dayGLANCE's electron/directAccessStore.test.ts, resolveInside) pins: the
 * folder and what is below it pass, nothing else does.
 */
class DirectAccessPathTest {

    @Test
    fun `a path below the folder is split into its segments`() {
        assertEquals(listOf("GLANCE", "users", "glance-users.json"), DirectAccessPath.segments("GLANCE/users/glance-users.json"))
        assertEquals(listOf("GLANCE", "users"), DirectAccessPath.segments("GLANCE//users/"))
        assertEquals(listOf("GLANCE", "users"), DirectAccessPath.segments("./GLANCE/./users"))
        assertEquals(listOf("a b", "c.json"), DirectAccessPath.segments("a b/c.json"))
    }

    @Test
    fun `the folder itself is the empty list, and is not a file`() {
        assertEquals(emptyList<String>(), DirectAccessPath.segments(""))
        assertEquals(emptyList<String>(), DirectAccessPath.segments("."))
        assertEquals(emptyList<String>(), DirectAccessPath.segments("/".trimStart('/')))
        assertNull(DirectAccessPath.fileSegments(""))
        assertNull(DirectAccessPath.fileSegments("."))
        assertEquals(listOf("x.json"), DirectAccessPath.fileSegments("x.json"))
    }

    @Test
    fun `guard - a path that escapes the folder is refused`() {
        for (rel in listOf("..", "../x.json", "GLANCE/../../x.json", "a/b/../../../c", "/etc/passwd", "\\\\server\\share", "C:/x", "c:\\x")) {
            assertNull("expected $rel to be refused", DirectAccessPath.segments(rel))
            assertNull("expected $rel to be refused", DirectAccessPath.fileSegments(rel))
        }
        assertNull(DirectAccessPath.segments(null))
    }
}
