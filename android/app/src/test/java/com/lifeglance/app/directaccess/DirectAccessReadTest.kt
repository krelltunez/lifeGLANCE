package com.lifeglance.app.directaccess

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Every branch of the read classification, against the contract the desktop
 * store's test (dayGLANCE's electron/directAccessStore.test.ts) pins for the same cycle:
 * a zero-length file is never absent, a vanished folder is never an absent
 * file, and a refused open is an error while a thrown read is retried.
 */
class DirectAccessReadTest {

    private class FakeSource(
        var configured: Boolean = true,
        var grantRevoked: Boolean = false,
        var folderExists: Boolean = true,
        var fileExists: Boolean = true,
        var fileIsDirectory: Boolean = false,
        var fileLength: Long = 42L,
        var text: String? = """{"version":2,"data":{"tasks":[]}}""",
        var readThrows: Boolean = false,
    ) : DirectAccessRead.Source {
        override fun configured() = configured
        override fun grantRevoked() = grantRevoked
        override fun folderExists() = folderExists
        override fun fileExists() = fileExists
        override fun fileIsDirectory() = fileIsDirectory
        override fun fileLength() = fileLength
        override fun readText(): String? {
            if (readThrows) throw java.io.IOException("provider busy")
            return text
        }
    }

    @Test
    fun `a real file is returned as text`() {
        val r = DirectAccessRead.classify(FakeSource())
        assertEquals(DirectAccessRead.Result.Text("""{"version":2,"data":{"tasks":[]}}"""), r)
    }

    @Test
    fun `no folder connected is an error`() {
        assertEquals(DirectAccessRead.Result.Error("no folder connected"), DirectAccessRead.classify(FakeSource(configured = false)))
    }

    @Test
    fun `a revoked grant is an error, never an absent file`() {
        assertEquals(
            DirectAccessRead.Result.Error("permission denied"),
            DirectAccessRead.classify(FakeSource(grantRevoked = true, fileExists = false)),
        )
    }

    @Test
    fun `a vanished folder is an error, never an absent file`() {
        assertEquals(
            DirectAccessRead.Result.Error("folder not found"),
            DirectAccessRead.classify(FakeSource(folderExists = false, fileExists = false)),
        )
    }

    @Test
    fun `an absent file may be seeded`() {
        assertEquals(DirectAccessRead.Result.Absent, DirectAccessRead.classify(FakeSource(fileExists = false)))
    }

    @Test
    fun `a directory where the file should be is an error`() {
        assertEquals(
            DirectAccessRead.Result.Error("lifeglance-sync.json is not a file"),
            DirectAccessRead.classify(FakeSource(fileIsDirectory = true)),
        )
    }

    @Test
    fun `guard - a zero-length file is a placeholder, never absent`() {
        assertEquals(DirectAccessRead.Result.Downloading, DirectAccessRead.classify(FakeSource(fileLength = 0L)))
    }

    @Test
    fun `an empty read of a non-empty file is a race, retried`() {
        assertEquals(DirectAccessRead.Result.Downloading, DirectAccessRead.classify(FakeSource(text = "")))
    }

    @Test
    fun `a thrown read is retried, a refused open is an error`() {
        assertEquals(DirectAccessRead.Result.Downloading, DirectAccessRead.classify(FakeSource(readThrows = true)))
        assertEquals(
            DirectAccessRead.Result.Error("could not open lifeglance-sync.json"),
            DirectAccessRead.classify(FakeSource(text = null)),
        )
    }

    @Test
    fun `json carries the kind and the payload`() {
        val text = JSONObject(DirectAccessRead.toJson(DirectAccessRead.Result.Text("{\"a\":1}")))
        assertEquals("text", text.getString("kind"))
        assertEquals("{\"a\":1}", text.getString("text"))

        val err = JSONObject(DirectAccessRead.toJson(DirectAccessRead.Result.Error("folder not found")))
        assertEquals("error", err.getString("kind"))
        assertEquals("folder not found", err.getString("error"))

        assertEquals("absent", JSONObject(DirectAccessRead.toJson(DirectAccessRead.Result.Absent)).getString("kind"))
        val dl = JSONObject(DirectAccessRead.toJson(DirectAccessRead.Result.Downloading))
        assertEquals("downloading", dl.getString("kind"))
        assertTrue(!dl.has("text"))
    }
}
