package com.notedeck.desktop

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec

class NotificationWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        private const val TAG = "NotificationWorker"
        private const val CHANNEL_ID = "notedeck_notifications"
        private const val NOTIFICATION_GROUP = "notedeck_notifications_group"
        private const val GROUP_SUMMARY_ID = Int.MAX_VALUE - 1
        private const val KEYSTORE_ALIAS = "keyring-default"
        private const val PREFS_NAME = "keyring-default"
        private const val POLL_STATE_PREFS = "notedeck_poll_state"
        private const val KEYRING_DIVIDER = "\uFEFF@\uFEFF"
        private const val KEYRING_SERVICE = "notedeck"
    }

    override suspend fun doWork(): Result {
        val accounts = loadAccountList() ?: return Result.success()
        if (accounts.isEmpty()) return Result.success()

        ensureNotificationChannel()

        val statePrefs = applicationContext.getSharedPreferences(POLL_STATE_PREFS, Context.MODE_PRIVATE)
        var successCount = 0
        var networkErrorOccurred = false
        var notifiedAccountCount = 0

        for (account in accounts) {
            try {
                val token = getTokenFromKeyStore(account.id) ?: continue
                val lastSeenId = statePrefs.getString("last_notif_${account.id}", null)
                val newNotifications = checkNewNotifications(account.host, token, lastSeenId)
                if (newNotifications.isNotEmpty()) {
                    showNotification(account, newNotifications.size)
                    notifiedAccountCount++
                    // Save the newest notification ID to avoid duplicates
                    statePrefs.edit().putString("last_notif_${account.id}", newNotifications.first()).apply()
                }
                successCount++
            } catch (e: java.net.SocketException) {
                Log.w(TAG, "Network error polling ${account.username}@${account.host}", e)
                networkErrorOccurred = true
            } catch (e: java.net.SocketTimeoutException) {
                Log.w(TAG, "Timeout polling ${account.username}@${account.host}", e)
                networkErrorOccurred = true
            } catch (e: Exception) {
                Log.w(TAG, "Failed to poll notifications for ${account.username}@${account.host}", e)
            }
        }

        // Show group summary when multiple accounts have notifications
        if (notifiedAccountCount >= 2) {
            showGroupSummary()
        }

        // Retry only when all accounts failed due to network issues
        if (successCount == 0 && networkErrorOccurred) {
            Log.w(TAG, "All accounts failed with network errors, requesting retry")
            return Result.retry()
        }

        return Result.success()
    }

    private fun loadAccountList(): List<PollAccount>? {
        // Tauri's app_data_dir() maps to Context.getFilesDir() on Android
        val file = File(applicationContext.filesDir, "poll_accounts.json")
        if (!file.exists()) return null

        return try {
            val json = JSONArray(file.readText())
            (0 until json.length()).map { i ->
                val obj = json.getJSONObject(i)
                PollAccount(
                    id = obj.getString("id"),
                    host = obj.getString("host"),
                    username = obj.getString("username"),
                )
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to load poll_accounts.json", e)
            null
        }
    }

    private fun getTokenFromKeyStore(accountId: String): String? {
        val prefs = applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val key = "$accountId$KEYRING_DIVIDER$KEYRING_SERVICE"
        val encoded = prefs.getString(key, null) ?: return null

        val encrypted = Base64.decode(encoded, Base64.DEFAULT)
        if (encrypted.size < 14) return null // 1 byte IV len + 12 bytes IV + at least 1 byte data

        val ivLen = encrypted[0].toInt() and 0xFF
        if (ivLen != 12 || encrypted.size < 1 + ivLen + 1) return null

        val iv = encrypted.copyOfRange(1, 1 + ivLen)
        val ciphertext = encrypted.copyOfRange(1 + ivLen, encrypted.size)

        val keyStore = java.security.KeyStore.getInstance("AndroidKeyStore")
        keyStore.load(null)
        val secretKey = keyStore.getKey(KEYSTORE_ALIAS, null) ?: return null

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(128, iv))
        val decrypted = cipher.doFinal(ciphertext)

        return String(decrypted, Charsets.UTF_8)
    }

    /**
     * Fetch notifications newer than [sinceId]. Returns list of notification IDs (newest first).
     */
    private fun checkNewNotifications(host: String, token: String, sinceId: String?): List<String> {
        val url = URL("https://$host/api/i/notifications")
        val conn = url.openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.connectTimeout = 10_000
            conn.readTimeout = 10_000
            conn.doOutput = true

            val body = JSONObject().apply {
                put("i", token)
                put("limit", 10)
                if (sinceId != null) put("sinceId", sinceId)
            }
            conn.outputStream.use { out ->
                out.write(body.toString().toByteArray())
            }

            if (conn.responseCode != 200) {
                Log.w(TAG, "Notification API returned ${conn.responseCode} for $host")
                return emptyList()
            }

            val responseBody = conn.inputStream.bufferedReader().readText()
            val arr = JSONArray(responseBody)
            return (0 until arr.length()).map { i ->
                arr.getJSONObject(i).getString("id")
            }
        } finally {
            conn.disconnect()
        }
    }

    private fun showNotification(account: PollAccount, count: Int) {
        val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE)
            as NotificationManager

        // クリックで該当アカウントの通知カラムを開く (#754)。deep link は
        // tauri-plugin-deep-link → nd:deep-link → handleDeepLink で処理される
        val intent = Intent(applicationContext, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = android.net.Uri.parse("notedeck://${account.host}/notifications")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            applicationContext,
            account.id.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val text = if (count == 1) {
            applicationContext.getString(R.string.nd_new_notification)
        } else {
            applicationContext.resources.getQuantityString(R.plurals.nd_new_notifications, count, count)
        }

        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("@${account.username}@${account.host}")
            .setContentText(text)
            .setNumber(count)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setGroup(NOTIFICATION_GROUP)
            .build()

        manager.notify(account.id.hashCode(), notification)
    }

    private fun showGroupSummary() {
        val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE)
            as NotificationManager

        val intent = Intent(applicationContext, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            applicationContext,
            GROUP_SUMMARY_ID,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val summary = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("NoteDeck")
            .setContentText(applicationContext.getString(R.string.nd_multiple_accounts))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setGroup(NOTIFICATION_GROUP)
            .setGroupSummary(true)
            .build()

        manager.notify(GROUP_SUMMARY_ID, summary)
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE)
                as NotificationManager
            if (manager.getNotificationChannel(CHANNEL_ID) == null) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    applicationContext.getString(R.string.nd_channel_name),
                    NotificationManager.IMPORTANCE_DEFAULT,
                ).apply {
                    description = applicationContext.getString(R.string.nd_channel_description)
                    setShowBadge(true)
                }
                manager.createNotificationChannel(channel)
            }
        }
    }

    private data class PollAccount(
        val id: String,
        val host: String,
        val username: String,
    )
}
