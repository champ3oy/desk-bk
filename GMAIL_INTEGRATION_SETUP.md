# Gmail Integration Setup Guide

This guide details how to set up the Gmail integration for the Help Desk application. This integration allows the system to:
1.  **Ingest Emails**: Automatically convert incoming emails from connected Gmail accounts into support tickets.
2.  **Send Replies**: Dispatch agent replies from the dashboard back to the customer via the connected Gmail account.

## 1. Google Cloud Platform (GCP) Setup

To connect Gmail accounts, you need a Google Cloud Project with the Gmail API enabled.

1.  **Create a Project**: Go to [Google Cloud Console](https://console.cloud.google.com/) and create a new project.
2.  **Enable Gmail API**:
    *   Navigate to **APIs & Services** > **Library**.
    *   Search for "Gmail API" and enable it.
3.  **Configure OAuth Consent Screen**:
    *   Go to **APIs & Services** > **OAuth consent screen**.
    *   Choose **External** (unless you are a G-Suite org testing internally).
    *   Fill in required app information.
    *   **Scopes**: Add the following scopes:
        *   `.../auth/gmail.modify` (Read/Write access for ingestion and sending)
        *   `.../auth/userinfo.email`
        *   `.../auth/userinfo.profile`
    *   **Test Users**: Add your own Gmail address to the "Test Users" list while the app is in "Testing" mode.
4.  **Create Credentials**:
    *   Go to **APIs & Services** > **Credentials**.
    *   Click **Create Credentials** > **OAuth client ID**.
    *   Application type: **Web application**.
    *   **Authorized redirect URIs**:
        *   For local development, this is typically your frontend callback URL.
        *   Example: `http://localhost:3000/settings/integrations/callback` (or wherever your frontend handles the OAuth return).
        *   The backend endpoint `/integrations/email/google/callback` is used *by the frontend* to exchange the code, it is not the direct redirect target from Google usually (unless you are doing a pure backend flow). *Note based on current implementation: The frontend receives the code and posts it to the backend.*
    *   Copy the **Client ID** and **Client Secret**.

## 2. Environment Variables

Add the following variables to your `backend/.env` file:

```env
# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
```

## 3. How it Works

### Authentication Flow
1.  **Frontend Request**: User clicks "Connect Gmail" in the dashboard.
2.  **Get URL**: Frontend calls `GET /integrations/email/google/authorize-url?redirectUri=...`.
3.  **User Approves**: User logs in to Google and grants permission.
4.  **Callback**: Google redirects user back to Frontend with a `code`.
5.  **Exchange**: Frontend sends this `code` to `POST /integrations/email/google/callback`.
6.  **Storage**: Backend exchanges code for `access_token` and `refresh_token` and stores them in the `EmailIntegration` database collection.

### Ingestion (Polling)
*   The `GmailPollingService` runs **every minute**.
*   It finds all active `EmailIntegration` records.
*   It uses the stored refresh token to get a fresh access token.
*   It polls Gmail for messages received `after` the last sync time.
*   New messages are passed to the `IngestionService` which:
    *   Creates a new **Ticket** if it's a new conversation.
    *   Adds a **Message** to an existing thread if it's a reply (threading matching logic apply).

### Sending Replies
*   When an agent posts a reply in the dashboard with type `EXTERNAL`.
*   The `ThreadsService` detects this and calls `DispatcherService`.
*   The dispatcher finds the connected Gmail account for the organization.
*   It attempts to find the "External Message ID" of the last customer message to ensure email threading works (adding `In-Reply-To` headers).
*   The email is sent via the Gmail API using the organization's connected account.

## 4. Troubleshooting

*   **Token Expiry**: The system automatically refreshes access tokens using the refresh token. If a refresh token is revoked (user changes password or revokes app access), the integration status will need to update to `NEEDS_REAUTH` (future improvement).
*   **Rate Limits**: Google has quota limits. The polling interval is set to 1 minute to stay within reasonable limits for a small number of accounts.
*   **Threading Issues**: If emails appear as new messages instead of replies in Gmail, it usually means the `References` or `In-Reply-To` headers are missing or incorrect. The system attempts to link to the immediate previous message.
*   **Attachments**: Currently, **attachments are NOT supported** (ignored during ingestion, not sent during dispatch). This requires an S3/GCS storage provider setup.
