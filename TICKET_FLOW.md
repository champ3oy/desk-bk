# Customer Ticket Flow: A User Story

This document tells the story of how a customer issue flows through the system from the moment it's reported until it gets resolved.

---

## The Characters

- **Customer**: An external party who has an issue or needs help. They don't have a platform account but are represented in the system.
- **Agent**: A support team member who handles tickets and helps customers.
- **Admin**: A team member with full access who can see and manage everything.

---

## Chapter 1: The Beginning - A Customer Needs Help

### The Customer's Story

Sarah, a customer from Acme Corp, is having trouble logging into her account. She contacts the support team through email or phone, explaining her issue.

### The Agent's Story

Maria, a support agent, receives Sarah's request. Before she can create a ticket, she needs to make sure Sarah exists in the system as a customer. If Sarah is new, Maria creates a customer profile with Sarah's contact information, email, and company details.

Once Sarah is in the system, Maria creates a ticket for her issue. She writes down:

- What the problem is (subject: "Cannot access dashboard")
- Details about the issue (description: "Unable to log in")
- Who it's for (Sarah from Acme Corp)
- How urgent it is (priority: high, medium, or low)

The ticket is born with a status of "OPEN" - it's new and waiting for someone to pick it up.

---

## Chapter 2: Finding the Right Person - Ticket Assignment

### The Unassigned Ticket

The ticket sits in the system, visible to all agents in the organization. It's unassigned, which means anyone can take it.

### The Assignment

**Option A: An agent picks it up**

Alex, another agent, sees the ticket in his queue. He decides to work on it, so he assigns it to himself. Now the ticket is his responsibility, and he changes the status to "IN_PROGRESS" to show he's actively working on it.

**Option B: A manager assigns it**

Lisa, an admin, reviews the tickets and sees this one needs attention. She knows that the technical support group handles login issues, so she assigns the ticket to that group. Now all members of the technical support group can see and work on this ticket.

**Important rule**: A ticket can be assigned to either one person OR one group, but not both at the same time.

---

## Chapter 3: Working on the Problem

### Investigating the Issue

Alex starts working on Sarah's login problem. He:

- Reviews the ticket details
- Checks the customer's account information
- Looks into what might be causing the login issue

### Communication and Collaboration

**Adding Notes (Comments)**

As Alex investigates, he adds comments to the ticket:

- "Checking customer credentials in the database"
- "Found that the account was locked due to multiple failed login attempts"

These comments are like sticky notes that other team members can read. Some comments are public (visible to all agents), while others are internal (only admins can see them - useful for sensitive information).

**Talking to the Customer (Threads)**

If Alex needs to ask Sarah questions or provide updates, he can create a communication thread. This is like opening a conversation channel:

- **External threads**: For talking with the customer (Sarah)
- **Internal threads**: For discussing the issue with other team members

**Sharing Files (Attachments)**

If Sarah sent screenshots or if Alex needs to attach documentation, he can upload files to the ticket or to specific comments.

### Status Changes During Work

As Alex works on the ticket, he might change its status:

- **PENDING**: "I've asked Sarah for more information, waiting for her response"
- **IN_PROGRESS**: "I'm actively working on this right now"
- **OPEN**: "Back to open if something changes"

He might also update the priority if the issue turns out to be more or less urgent than initially thought.

---

## Chapter 4: The Journey Through Statuses

Tickets move through different states as they're handled:

1. **OPEN** → The ticket is new and waiting
2. **PENDING** → Waiting for something (customer response, external system, etc.)
3. **IN_PROGRESS** → Someone is actively working on it
4. **RESOLVED** → The problem has been fixed
5. **CLOSED** → The ticket is finished and archived

These statuses tell everyone at a glance where the ticket is in its lifecycle.

---

## Chapter 5: Resolution - The Happy Ending

### Finding the Solution

After investigating, Alex discovers that Sarah's account was automatically locked after too many failed login attempts. He resets her account and unlocks it.

### Documenting the Resolution

Alex adds a comment: "Account unlocked. Customer should be able to log in now. Reset password sent to email."

### Marking as Resolved

Alex changes the ticket status to "RESOLVED" - the problem is fixed! Sarah can now log in.

### Closing the Ticket

Later, after confirming everything is working, Alex (or an admin) might change the status to "CLOSED" to archive the ticket. This is the final state - the ticket's journey is complete.

---

## The Complete Story: From Start to Finish

Here's how the full journey looks:

```
Sarah contacts support
         ↓
Maria creates Sarah as a customer (if new)
         ↓
Maria creates a ticket for Sarah's issue
   Status: OPEN | Priority: MEDIUM
         ↓
Ticket appears in the system (unassigned)
         ↓
Alex picks up the ticket and assigns it to himself
   Status: IN_PROGRESS
         ↓
Alex investigates the issue
   - Adds comments with findings
   - Creates thread to communicate with Sarah
   - Uploads relevant files
         ↓
Alex discovers the problem and fixes it
   Status: RESOLVED
         ↓
Alex documents the solution in comments
         ↓
Ticket is closed
   Status: CLOSED
```

---

## Important Rules and Behaviors

### Who Can Do What?

- **Customers** (like Sarah): They don't have accounts in the system. They contact support, and agents create tickets on their behalf.
- **Agents** (like Alex and Maria): They can see and work on tickets assigned to them, tickets assigned to their groups, and unassigned tickets.
- **Admins** (like Lisa): They can see everything - all tickets in the organization, regardless of assignment.

### Assignment Rules

- A ticket can be assigned to **one person** OR **one group**, but not both.
- If you assign a ticket to a person, it automatically removes any group assignment.
- If you assign a ticket to a group, it automatically removes any individual assignment.
- Unassigned tickets are visible to all agents, so anyone can pick them up.

### Communication Tools

- **Comments**: Internal notes for the team. Some are visible to all agents, others are admin-only.
- **Threads**: Communication channels - either with customers (external) or between team members (internal).
- **Attachments**: Files that can be linked to tickets or comments.

### Status Management

- All status changes are **manual** - agents and admins decide when to change them.
- There's no automatic assignment, escalation, or resolution.
- The team has full control over the ticket lifecycle.

---

## A Day in the Life: Example Scenario

**Monday, 9:00 AM**

Sarah from Acme Corp emails support: "I can't log into my dashboard."

**Monday, 9:15 AM**

Maria, the morning shift agent, receives the email. She:

1. Checks if Sarah exists in the system - she does
2. Creates a new ticket:
   - Subject: "Cannot access dashboard"
   - Description: "Customer unable to log in"
   - Customer: Sarah (Acme Corp)
   - Priority: High (login issues are urgent)
   - Status: OPEN

**Monday, 9:30 AM**

Alex arrives and sees the new high-priority ticket. He assigns it to himself and changes status to IN_PROGRESS.

**Monday, 9:45 AM**

Alex investigates:

- Checks Sarah's account status
- Finds account is locked
- Adds comment: "Account locked due to multiple failed login attempts"

**Monday, 10:00 AM**

Alex creates an external thread and messages Sarah: "Hi Sarah, I found your account was locked. I've unlocked it. Please try logging in again and let me know if you still have issues."

**Monday, 10:30 AM**

Sarah responds: "It works now! Thank you!"

**Monday, 10:35 AM**

Alex:

- Adds comment: "Customer confirmed issue resolved"
- Changes status to RESOLVED

**Monday, 11:00 AM**

Lisa, the admin, reviews resolved tickets and closes this one. Status: CLOSED.

**The End**

The ticket's journey is complete. Sarah's problem is solved, and the ticket is archived.

---

## What Makes This System Work

1. **Clear Ownership**: Everyone knows who's responsible for each ticket
2. **Visibility**: Agents see what they need to work on; admins see everything
3. **Communication**: Comments and threads keep everyone informed
4. **Flexibility**: Statuses can change as the situation evolves
5. **Documentation**: Everything is tracked - who did what, when, and why

This is how customer issues flow through the system - from the moment someone needs help until their problem is solved.
