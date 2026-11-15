package co.inboxies.wear.session

import android.content.Context
import android.net.Uri
import android.util.Log
import co.inboxies.watchshared.WatchHandoff
import co.inboxies.watchshared.WatchPhoneContext
import co.inboxies.watchshared.WatchSessionReply
import co.inboxies.wear.data.WatchApi
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.PutDataRequest
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.time.Duration.Companion.seconds

/**
 * Watch side of the Data Layer handoff (AVE-145; iOS twin `PhoneLink`, AVE-144).
 * Asks the phone app for a `watch` session ([requestSession]) and reads the phone's
 * non-secret context. Grants, wipes and context changes pushed by the phone arrive in
 * [WearHandoffService]. The phone is found by its [WatchHandoff.PHONE_CAPABILITY].
 */
class PhoneLink(context: Context) : PhoneSessionSource {
    private val app = context.applicationContext
    private val capabilityClient = Wearable.getCapabilityClient(app)
    private val messageClient = Wearable.getMessageClient(app)
    private val dataClient = Wearable.getDataClient(app)

    override suspend fun requestSession(manual: Boolean): PhoneAnswer {
        val node = phoneNode() ?: return PhoneAnswer.Unreachable
        return try {
            val reply = withTimeoutOrNull(REQUEST_TIMEOUT) {
                messageClient.sendRequest(node.id, WatchHandoff.REQUEST_SESSION_PATH, WatchHandoff.encodeRequest(manual)).await()
            } ?: return PhoneAnswer.Unreachable
            PhoneAnswer.from(WatchSessionReply.decode(reply, WatchApi.allowLocalHttp))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.i(TAG, "Session request failed: ${e.javaClass.simpleName}")
            PhoneAnswer.Unreachable
        }
    }

    /** The paired phone with Inboxies, preferring one connected directly. */
    private suspend fun phoneNode(): Node? = try {
        val nodes = capabilityClient
            .getCapability(WatchHandoff.PHONE_CAPABILITY, CapabilityClient.FILTER_REACHABLE)
            .await()
            .nodes
        nodes.firstOrNull { it.isNearby } ?: nodes.firstOrNull()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    /** The phone's latest context, if one synced before launch. */
    suspend fun currentContext(): WatchPhoneContext? = try {
        val uri = Uri.Builder().scheme(PutDataRequest.WEAR_URI_SCHEME).path(WatchHandoff.CONTEXT_PATH).build()
        val buffer = dataClient.getDataItems(uri).await()
        try {
            buffer.mapNotNull { WatchPhoneContext.decode(it.data, WatchApi.allowLocalHttp) }.maxByOrNull { it.updatedAt }
        } finally {
            buffer.release()
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    /** Calls [onReachable] when a phone with Inboxies becomes reachable. Returns the unsubscribe. */
    fun watchReachability(onReachable: () -> Unit): () -> Unit {
        val listener = CapabilityClient.OnCapabilityChangedListener { info ->
            if (info.nodes.isNotEmpty()) onReachable()
        }
        capabilityClient.addListener(listener, WatchHandoff.PHONE_CAPABILITY)
        return { capabilityClient.removeListener(listener, WatchHandoff.PHONE_CAPABILITY) }
    }

    private companion object {
        const val TAG = "PhoneLink"

        /** The phone may have to wake its app and call the Worker. */
        val REQUEST_TIMEOUT = 20.seconds
    }
}
