package co.inboxies.app.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** AVE-150: widget tap links, the same URLs as iOS (AVE-149). */
class InboxWidgetLinkTest {
    @Test
    fun threadLinkRoundTrips() {
        val link = InboxWidgetLink.Thread("mb 1", "t&2=x")
        assertEquals("inboxies://thread?mailbox=mb%201&thread=t%262%3Dx", link.url)
        assertEquals(link, InboxWidgetLink.parse(link.url))
    }

    @Test
    fun inboxLinkWithAndWithoutMailbox() {
        assertEquals("inboxies://inbox?mailbox=mb-1", InboxWidgetLink.Inbox("mb-1").url)
        assertEquals(InboxWidgetLink.Inbox("mb-1"), InboxWidgetLink.parse("inboxies://inbox?mailbox=mb-1"))
        assertEquals("inboxies://inbox", InboxWidgetLink.Inbox(null).url)
        assertEquals(InboxWidgetLink.Inbox(null), InboxWidgetLink.parse("inboxies://inbox"))
    }

    @Test
    fun rejectsOtherLinks() {
        assertNull(InboxWidgetLink.parse(null))
        assertNull(InboxWidgetLink.parse("inboxies://invite/abc"))
        assertNull(InboxWidgetLink.parse("https://inboxies.email/inbox?mailbox=x"))
        assertNull(InboxWidgetLink.parse("inboxies://thread?mailbox=mb-1"))
        assertNull(InboxWidgetLink.parse("inboxies://thread?mailbox=&thread=t"))
    }
}
