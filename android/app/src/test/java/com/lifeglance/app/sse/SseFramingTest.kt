package com.lifeglance.app.sse

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for the native SSE frame boundary detector. Mirrors the behaviour
 * the renderer's drainSseBuffer is tested for (src/sync/vaultEventStream.test.ts),
 * so the native framing and the JS parser agree on what a "complete event block"
 * is. Fixtures use the REAL wire format — named `ready`/`activity` events whose
 * data is exactly {"seq":N} — never fabricated fields.
 */
class SseFramingTest {

    @Test
    fun `emits complete blocks and carries the partial remainder across reads`() {
        val f = SseFraming()
        // Two complete events plus a partial third, split awkwardly across reads.
        val first = f.append("event: ready\ndata: {\"seq\":1}\n\nevent: activity\ndata: {\"seq\":2")
        assertEquals(listOf("event: ready\ndata: {\"seq\":1}"), first)

        // The partial second event is buffered — nothing emitted yet.
        val second = f.append("}\n\n")
        assertEquals(listOf("event: activity\ndata: {\"seq\":2}"), second)
    }

    @Test
    fun `normalizes CRLF and CR frame boundaries`() {
        val f = SseFraming()
        val blocks = f.append("event: activity\r\ndata: {\"seq\":7}\r\n\r\n")
        assertEquals(listOf("event: activity\ndata: {\"seq\":7}"), blocks)
    }

    @Test
    fun `drops heartbeat and comment-only blocks (no data line)`() {
        val f = SseFraming()
        val blocks = f.append(": heartbeat\n\nevent: ping\n\nevent: activity\ndata: {\"seq\":4}\n\n")
        // Only the block carrying a data: line is forwarded.
        assertEquals(listOf("event: activity\ndata: {\"seq\":4}"), blocks)
    }

    @Test
    fun `multi-line block is forwarded verbatim for the renderer to parse`() {
        val f = SseFraming()
        val block = "event: activity\nid: 9\ndata: {\"seq\":9}"
        val blocks = f.append("$block\n\n")
        assertEquals(listOf(block), blocks)
    }

    @Test
    fun `reset discards a partial block so a new stream does not glue onto the old`() {
        val f = SseFraming()
        f.append("event: activity\ndata: {\"seq\":1") // partial, buffered
        f.reset()
        // Fresh stream after reconnect: the leftover partial must be gone.
        val blocks = f.append("event: ready\ndata: {\"seq\":2}\n\n")
        assertEquals(listOf("event: ready\ndata: {\"seq\":2}"), blocks)
    }

    @Test(expected = SseFramingOverflowException::class)
    fun `throws when a single undelimited frame exceeds the cap`() {
        // A server that streams bytes but never the "\n\n" delimiter must not grow the
        // buffer without bound — append throws once the retained partial exceeds the cap.
        val f = SseFraming(maxBufferChars = 1024)
        f.append("data: " + "x".repeat(2000)) // no blank-line boundary, over cap
    }

    @Test
    fun `does not throw while the buffer stays under the cap and still drains`() {
        val f = SseFraming(maxBufferChars = 1024)
        // Under-cap partial is retained (no throw); a later delimiter completes it.
        assertEquals(emptyList<String>(), f.append("event: activity\ndata: {\"seq\":1"))
        val blocks = f.append("}\n\n")
        assertEquals(listOf("event: activity\ndata: {\"seq\":1}"), blocks)
    }

    @Test
    fun `handles several complete blocks in one chunk`() {
        val f = SseFraming()
        val blocks = f.append(
            "event: ready\ndata: {\"seq\":1}\n\n" +
                "event: activity\ndata: {\"seq\":2}\n\n" +
                "event: activity\ndata: {\"seq\":3}\n\n"
        )
        assertEquals(3, blocks.size)
        assertTrue(blocks[0].contains("ready"))
        assertTrue(blocks[2].contains("{\"seq\":3}"))
    }
}
