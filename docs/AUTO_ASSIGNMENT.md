# Auto-Assignment & AI Auto-Reply Disable Feature

## Overview

When a human agent (non-customer) replies to a ticket, the system will automatically:

1. Assign that ticket to them if it's not already assigned to a specific user
2. Disable AI auto-reply if the ticket was escalated (preventing AI interference)

## How It Works

### Trigger

When an agent sends an EXTERNAL message (customer-facing reply) to a ticket

### Actions Taken

#### 1. Auto-Assignment

- **Condition**: The ticket is NOT already assigned to a specific user (assignedToId is null/undefined)
- **Action**: The ticket is automatically assigned to the replying agent

#### 2. AI Auto-Reply Disable

- **Condition**: The ticket was escalated (isAiEscalated = true OR status = 'escalated')
- **Action**: Sets `aiAutoReplyDisabled = true` to prevent AI from sending future responses
- **Benefit**: Once a human takes over, the AI stays out of the conversation

### Additional Behavior

- The ticket is also de-escalated if it was previously escalated

## Implementation Details

### Database Schema

**New Field Added**: `aiAutoReplyDisabled` (boolean, default: false)

- Location: `Ticket` entity
- Purpose: Flag to prevent AI auto-responses when a human agent has taken over

### Logic Flow

```typescript
if (agent replies with external message) {
  // De-escalate the ticket
  await deEscalateTicket(ticketId);

  // Check if ticket needs assignment or AI disable
  const ticket = await findTicket(ticketId);
  const updateData = {};

  // Auto-assign if not already assigned
  if (!ticket.assignedToId) {
    updateData.assignedToId = userId;
  }

  // Disable AI if ticket was escalated
  if ((ticket.isAiEscalated || ticket.status === 'escalated') &&
      !ticket.aiAutoReplyDisabled) {
    updateData.aiAutoReplyDisabled = true;
  }

  if (Object.keys(updateData).length > 0) {
    await updateTicket(ticketId, updateData);
  }
}
```

### AI Auto-Reply Check

The `handleAutoReply` method now checks the `aiAutoReplyDisabled` flag:

```typescript
if (ticket.aiAutoReplyDisabled) {
  console.log(
    'Skipping auto-reply: AI auto-reply disabled (human agent took over)',
  );
  return;
}
```

### Files Modified

1. **Backend**:
   - `backend/src/tickets/entities/ticket.entity.ts` - Added `aiAutoReplyDisabled` field
   - `backend/src/tickets/dto/update-ticket.dto.ts` - Added field to DTO
   - `backend/src/tickets/tickets.service.ts` - Added check in `handleAutoReply`
   - `backend/src/threads/threads.service.ts` - Enhanced auto-assignment logic

2. **Frontend**:
   - `new-web/lib/api.ts` - Added field to `UpdateTicketPayload` type

## Edge Cases Handled

### Auto-Assignment

- **Already Assigned**: If a ticket is already assigned to a specific user, it will NOT be reassigned
- **Group Assignment**: If a ticket is only assigned to a group (not a specific user), the replying agent will be assigned
- **Error Handling**: Assignment failures are caught and logged without breaking the message creation flow
- **Permissions**: The assignment respects the existing permission system

### AI Auto-Reply Disable

- **Already Disabled**: Won't update if already disabled
- **Non-Escalated Tickets**: Only disables AI for escalated tickets
- **Manual Re-enable**: Can be manually re-enabled via API if needed

## Benefits

1. **Accountability**: Clear ownership of tickets when agents engage
2. **Workflow Efficiency**: Reduces manual assignment steps
3. **Better Tracking**: Easy to see which agent is handling which conversation
4. **Seamless Experience**: Happens automatically in the background
5. **AI Handoff**: Clean transition from AI to human without interference
6. **Customer Experience**: Prevents confusing back-and-forth between AI and human

## Testing

To test this feature:

1. Create a new ticket (unassigned or assigned to a group only)
2. Let the AI escalate the ticket (or manually escalate it)
3. Have an agent reply to the ticket
4. Verify:
   - The ticket is now assigned to that agent
   - `aiAutoReplyDisabled` is set to `true`
   - AI no longer responds to customer messages in this ticket
5. Check the console logs for `[Auto-Assign]` messages

## Manual Control

The `aiAutoReplyDisabled` field can be controlled in two ways:

### 1. Via UI Toggle (Ticket Drawer)

Agents can enable/disable AI auto-reply directly from the ticket details drawer:

1. Open any ticket
2. Click the "More Options" menu (three dots) to open the ticket details drawer
3. Scroll to the "AI Auto-Reply" section
4. Toggle the switch:
   - **Green (Enabled)**: AI can respond automatically
   - **Gray (Disabled)**: Human is handling, AI won't respond

The toggle shows the current state:

- "Enabled (AI can respond)" - AI will auto-reply to customer messages
- "Disabled (Human handling)" - AI is turned off for this ticket

### 2. Via API

```typescript
// Disable AI auto-reply
await api.tickets.update(ticketId, { aiAutoReplyDisabled: true });

// Re-enable AI auto-reply
await api.tickets.update(ticketId, { aiAutoReplyDisabled: false });
```

## UI Components Modified

**Frontend**:

- `new-web/components/TicketDetailsDrawer.tsx` - Added toggle switch UI
- `new-web/components/TicketConversationView.tsx` - Pass aiAutoReplyDisabled to drawer
- `new-web/lib/api.ts` - Added field to UpdateTicketPayload type

The toggle provides immediate visual feedback and updates the ticket state in real-time.

## Future Enhancements

Potential improvements:

- Configuration option to enable/disable auto-assignment
- Configuration option to enable/disable AI auto-reply disable
- Option to reassign even if already assigned
- Notification to the agent when auto-assigned
- Analytics on auto-assignment patterns
- UI toggle in ticket view to manually enable/disable AI
- Notification to customer when transitioning from AI to human
