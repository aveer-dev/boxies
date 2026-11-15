package co.inboxies.app.ui.components

import org.junit.Assert.assertEquals
import org.junit.Test

class AppToastHostTest {
    @Test
    fun readerSheetHostsTheToastWhileItIsOpen() {
        // AVE-231: the phone reader sheet's window covers the home shell's toast.
        assertEquals(AppToastHost.ReaderSheet, AppToastHost.forReader(readerSheetOpen = true))
    }

    @Test
    fun homeHostsTheToastOtherwise() {
        // No reader, or the reader inline in a two-pane layout.
        assertEquals(AppToastHost.Home, AppToastHost.forReader(readerSheetOpen = false))
    }
}
