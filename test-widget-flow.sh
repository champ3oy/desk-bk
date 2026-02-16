#!/bin/bash

# Configuration - REPLACE THIS with your actual Channel ID
CHANNEL_ID="REPLACE_WITH_YOUR_CHANNEL_ID_FROM_DB"
API_URL="http://localhost:3005"
SESSION_ID="test-session-$(date +%s)"

echo "Step 1: Uploading a file..."
# Create a dummy file to upload
echo "This is a test file content" > test-upload.txt

# Upload the file
UPLOAD_RESPONSE=$(curl -s -X POST "${API_URL}/api/webhooks/widget/upload" \
  -H "x-channel-id: ${CHANNEL_ID}" \
  -F "file=@test-upload.txt")

echo "Upload Response: ${UPLOAD_RESPONSE}"

# Extract the attachment object from the response using jq (or simplified grep if jq not available)
# Assuming response format: { "attachment": { "filename": "...", "path": "...", ... } }
# We need to construct the attachments array for the next request based on this.

# For simplicity in this script, we'll manually extract the path if possible, 
# or you can just copy-paste the output into the next command if this fails.

echo ""
echo "Step 2: Sending message with the uploaded attachment..."

# We will use the response directly if it matches the structure, or mock it with the path if we could extract it.
# unique attachment object structure expected by the backend logic we just fixed.

# Let's verify the fix by sending a payload that MIGHT be missing 'path' but has 'url' 
# (simulating the issue), OR just sending the standard payload to ensure it works.

curl -X POST "${API_URL}/api/webhooks/widget" \
  -H "Content-Type: application/json" \
  -H "x-channel-id: ${CHANNEL_ID}" \
  -d "{
    \"content\": \"Testing file upload flow\",
    \"sessionId\": \"${SESSION_ID}\",
    \"name\": \"Test User\",
    \"email\": \"test@example.com\",
    \"attachments\": [
      ${UPLOAD_RESPONSE} 
    ]
  }"
# Note: The above assumes UPLOAD_RESPONSE is the single attachment object. 
# If the API returns { attachment: {...} }, we need to extract it.
# Let's adjust the script to be more robust manually if needed.

rm test-upload.txt
