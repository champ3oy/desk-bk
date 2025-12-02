# Ticketing System API Documentation

## Overview

This is a comprehensive ticketing system API built with NestJS, similar to Zendesk. It provides endpoints for managing tickets, users, comments, categories, tags, and attachments with role-based access control.

**Base URL:** `http://localhost:3000/api`

## Authentication

Most endpoints require JWT authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

### Authentication Endpoints

#### Register User

Register a new user account.

**Endpoint:** `POST /api/auth/register`

**Authentication:** Not required

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "password123",
  "firstName": "John",
  "lastName": "Doe",
  "role": "customer" // Optional: "customer" | "agent" | "admin" (defaults to "customer")
}
```

**Response:** `201 Created`

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "role": "customer",
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

#### Login

Authenticate and receive a JWT token.

**Endpoint:** `POST /api/auth/login`

**Authentication:** Not required

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:** `200 OK`

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "customer"
  }
}
```

---

## User Management

### Get All Users

Retrieve a list of all users.

**Endpoint:** `GET /api/users`

**Authentication:** Required (Admin, Agent)

**Response:** `200 OK`

```json
[
  {
    "id": "uuid",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "customer",
    "isActive": true,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
]
```

### Get User by ID

Retrieve a specific user by ID.

**Endpoint:** `GET /api/users/:id`

**Authentication:** Required (Admin, Agent)

**Response:** `200 OK`

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "role": "customer",
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Create User

Create a new user (Admin only).

**Endpoint:** `POST /api/users`

**Authentication:** Required (Admin)

**Request Body:**

```json
{
  "email": "newuser@example.com",
  "password": "password123",
  "firstName": "Jane",
  "lastName": "Smith",
  "role": "agent" // Optional: "customer" | "agent" | "admin"
}
```

**Response:** `201 Created`

```json
{
  "id": "uuid",
  "email": "newuser@example.com",
  "firstName": "Jane",
  "lastName": "Smith",
  "role": "agent",
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Update User

Update an existing user (Admin only).

**Endpoint:** `PATCH /api/users/:id`

**Authentication:** Required (Admin)

**Request Body:**

```json
{
  "email": "updated@example.com", // Optional
  "firstName": "Updated", // Optional
  "lastName": "Name", // Optional
  "role": "agent", // Optional
  "isActive": false // Optional
}
```

**Response:** `200 OK`

```json
{
  "id": "uuid",
  "email": "updated@example.com",
  "firstName": "Updated",
  "lastName": "Name",
  "role": "agent",
  "isActive": false,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Delete User

Delete a user (Admin only).

**Endpoint:** `DELETE /api/users/:id`

**Authentication:** Required (Admin)

**Response:** `200 OK`

---

## Tickets

### Get All Tickets

Retrieve tickets based on user role:

- **Customers:** Only their own tickets
- **Agents:** Tickets they created or are assigned to
- **Admins:** All tickets

**Endpoint:** `GET /api/tickets`

**Authentication:** Required

**Response:** `200 OK`

```json
[
  {
    "id": "uuid",
    "subject": "Issue with login",
    "description": "I cannot log into my account",
    "status": "open",
    "priority": "high",
    "createdById": "uuid",
    "assignedToId": "uuid",
    "categoryId": "uuid",
    "createdBy": { ... },
    "assignedTo": { ... },
    "category": { ... },
    "tags": [ ... ],
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
]
```

### Get Ticket by ID

Retrieve a specific ticket by ID.

**Endpoint:** `GET /api/tickets/:id`

**Authentication:** Required

**Response:** `200 OK`

```json
{
  "id": "uuid",
  "subject": "Issue with login",
  "description": "I cannot log into my account",
  "status": "open",
  "priority": "high",
  "createdById": "uuid",
  "assignedToId": "uuid",
  "categoryId": "uuid",
  "createdBy": {
    "id": "uuid",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe"
  },
  "assignedTo": {
    "id": "uuid",
    "email": "agent@example.com",
    "firstName": "Agent",
    "lastName": "Name"
  },
  "category": {
    "id": "uuid",
    "name": "Technical Support"
  },
  "tags": [
    {
      "id": "uuid",
      "name": "urgent",
      "color": "#ff0000"
    }
  ],
  "comments": [ ... ],
  "attachments": [ ... ],
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Create Ticket

Create a new ticket.

**Endpoint:** `POST /api/tickets`

**Authentication:** Required

**Request Body:**

```json
{
  "subject": "Issue with login",
  "description": "I cannot log into my account",
  "status": "open", // Optional: "open" | "pending" | "in_progress" | "resolved" | "closed" (defaults to "open")
  "priority": "high", // Optional: "low" | "medium" | "high" | "urgent" (defaults to "medium")
  "assignedToId": "uuid", // Optional: UUID of agent to assign
  "categoryId": "uuid", // Optional: UUID of category
  "tagIds": ["uuid1", "uuid2"] // Optional: Array of tag UUIDs
}
```

**Response:** `201 Created`

```json
{
  "id": "uuid",
  "subject": "Issue with login",
  "description": "I cannot log into my account",
  "status": "open",
  "priority": "high",
  "createdById": "uuid",
  "assignedToId": "uuid",
  "categoryId": "uuid",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Update Ticket

Update an existing ticket.

**Endpoint:** `PATCH /api/tickets/:id`

**Authentication:** Required

**Note:** Customers cannot change status or assign tickets.

**Request Body:**

```json
{
  "subject": "Updated subject", // Optional
  "description": "Updated description", // Optional
  "status": "in_progress", // Optional: Customers cannot change this
  "priority": "urgent", // Optional
  "assignedToId": "uuid", // Optional: Customers cannot change this
  "categoryId": "uuid", // Optional
  "tagIds": ["uuid1", "uuid2"] // Optional
}
```

**Response:** `200 OK`

```json
{
  "id": "uuid",
  "subject": "Updated subject",
  "description": "Updated description",
  "status": "in_progress",
  "priority": "urgent",
  "createdById": "uuid",
  "assignedToId": "uuid",
  "categoryId": "uuid",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Delete Ticket

Delete a ticket (Admin only).

**Endpoint:** `DELETE /api/tickets/:id`

**Authentication:** Required (Admin)

**Response:** `200 OK`

---

## Comments

### Get All Comments

Retrieve comments for a specific ticket.

**Endpoint:** `GET /api/comments?ticketId=<ticket-uuid>`

**Authentication:** Required

**Query Parameters:**

- `ticketId` (required): UUID of the ticket

**Response:** `200 OK`

```json
[
  {
    "id": "uuid",
    "content": "I've looked into this issue...",
    "isInternal": false,
    "authorId": "uuid",
    "ticketId": "uuid",
    "author": {
      "id": "uuid",
      "email": "agent@example.com",
      "firstName": "Agent",
      "lastName": "Name"
    },
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
]
```

**Note:** Customers can only see non-internal comments.

### Get Comment by ID

Retrieve a specific comment by ID.

**Endpoint:** `GET /api/comments/:id`

**Authentication:** Required

**Response:** `200 OK`

```json
{
  "id": "uuid",
  "content": "I've looked into this issue...",
  "isInternal": false,
  "authorId": "uuid",
  "ticketId": "uuid",
  "author": { ... },
  "ticket": { ... },
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Create Comment

Add a comment to a ticket.

**Endpoint:** `POST /api/comments`

**Authentication:** Required

**Request Body:**

```json
{
  "content": "I've looked into this issue and found...",
  "ticketId": "uuid",
  "isInternal": false // Optional: true for internal notes (defaults to false)
}
```

**Response:** `201 Created`

```json
{
  "id": "uuid",
  "content": "I've looked into this issue and found...",
  "isInternal": false,
  "authorId": "uuid",
  "ticketId": "uuid",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Update Comment

Update an existing comment (only your own comments, or Admin).

**Endpoint:** `PATCH /api/comments/:id`

**Authentication:** Required

**Request Body:**

```json
{
  "content": "Updated comment content", // Optional
  "isInternal": true // Optional
}
```

**Response:** `200 OK`

```json
{
  "id": "uuid",
  "content": "Updated comment content",
  "isInternal": true,
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Delete Comment

Delete a comment (only your own comments, or Admin).

**Endpoint:** `DELETE /api/comments/:id`

**Authentication:** Required

**Response:** `200 OK`

---

## Categories

### Get All Categories

Retrieve all ticket categories.

**Endpoint:** `GET /api/categories`

**Authentication:** Required

**Response:** `200 OK`

```json
[
  {
    "id": "uuid",
    "name": "Technical Support",
    "description": "Technical issues and support",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
]
```

### Get Category by ID

Retrieve a specific category by ID.

**Endpoint:** `GET /api/categories/:id`

**Authentication:** Required

**Response:** `200 OK`

```json
{
  "id": "uuid",
  "name": "Technical Support",
  "description": "Technical issues and support",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Create Category

Create a new category (Admin only).

**Endpoint:** `POST /api/categories`

**Authentication:** Required (Admin)

**Request Body:**

```json
{
  "name": "Billing",
  "description": "Billing and payment issues" // Optional
}
```

**Response:** `201 Created`

```json
{
  "id": "uuid",
  "name": "Billing",
  "description": "Billing and payment issues",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Update Category

Update an existing category (Admin only).

**Endpoint:** `PATCH /api/categories/:id`

**Authentication:** Required (Admin)

**Request Body:**

```json
{
  "name": "Updated Category Name", // Optional
  "description": "Updated description" // Optional
}
```

**Response:** `200 OK`

### Delete Category

Delete a category (Admin only).

**Endpoint:** `DELETE /api/categories/:id`

**Authentication:** Required (Admin)

**Response:** `200 OK`

---

## Tags

### Get All Tags

Retrieve all tags.

**Endpoint:** `GET /api/tags`

**Authentication:** Required

**Response:** `200 OK`

```json
[
  {
    "id": "uuid",
    "name": "urgent",
    "color": "#ff0000",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
]
```

### Get Tag by ID

Retrieve a specific tag by ID.

**Endpoint:** `GET /api/tags/:id`

**Authentication:** Required

**Response:** `200 OK`

```json
{
  "id": "uuid",
  "name": "urgent",
  "color": "#ff0000",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Create Tag

Create a new tag (Agent, Admin).

**Endpoint:** `POST /api/tags`

**Authentication:** Required (Agent, Admin)

**Request Body:**

```json
{
  "name": "bug",
  "color": "#ff0000" // Optional: Hex color code
}
```

**Response:** `201 Created`

```json
{
  "id": "uuid",
  "name": "bug",
  "color": "#ff0000",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Update Tag

Update an existing tag (Agent, Admin).

**Endpoint:** `PATCH /api/tags/:id`

**Authentication:** Required (Agent, Admin)

**Request Body:**

```json
{
  "name": "updated-tag", // Optional
  "color": "#00ff00" // Optional
}
```

**Response:** `200 OK`

### Delete Tag

Delete a tag (Agent, Admin).

**Endpoint:** `DELETE /api/tags/:id`

**Authentication:** Required (Agent, Admin)

**Response:** `200 OK`

---

## Attachments

### Get All Attachments

Retrieve attachments, optionally filtered by ticket or comment.

**Endpoint:** `GET /api/attachments?ticketId=<uuid>&commentId=<uuid>`

**Authentication:** Required

**Query Parameters:**

- `ticketId` (optional): Filter by ticket UUID
- `commentId` (optional): Filter by comment UUID

**Response:** `200 OK`

```json
[
  {
    "id": "uuid",
    "filename": "file123.pdf",
    "originalName": "document.pdf",
    "mimeType": "application/pdf",
    "size": 1024000,
    "path": "/uploads/file123.pdf",
    "ticketId": "uuid",
    "commentId": null,
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]
```

### Get Attachment by ID

Retrieve a specific attachment by ID.

**Endpoint:** `GET /api/attachments/:id`

**Authentication:** Required

**Response:** `200 OK`

```json
{
  "id": "uuid",
  "filename": "file123.pdf",
  "originalName": "document.pdf",
  "mimeType": "application/pdf",
  "size": 1024000,
  "path": "/uploads/file123.pdf",
  "ticketId": "uuid",
  "commentId": null,
  "ticket": { ... },
  "comment": { ... },
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

### Create Attachment

Create a new attachment record.

**Endpoint:** `POST /api/attachments`

**Authentication:** Required

**Request Body:**

```json
{
  "filename": "file123.pdf",
  "originalName": "document.pdf",
  "mimeType": "application/pdf",
  "size": "1024000",
  "path": "/uploads/file123.pdf",
  "ticketId": "uuid", // Optional: Either ticketId or commentId
  "commentId": "uuid" // Optional: Either ticketId or commentId
}
```

**Response:** `201 Created`

```json
{
  "id": "uuid",
  "filename": "file123.pdf",
  "originalName": "document.pdf",
  "mimeType": "application/pdf",
  "size": 1024000,
  "path": "/uploads/file123.pdf",
  "ticketId": "uuid",
  "commentId": null,
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

### Delete Attachment

Delete an attachment.

**Endpoint:** `DELETE /api/attachments/:id`

**Authentication:** Required

**Response:** `200 OK`

---

## Data Models

### User Roles

- `customer`: Regular users who can create and view their own tickets
- `agent`: Support agents who can view and manage assigned tickets
- `admin`: Administrators with full system access

### Ticket Status

- `open`: Newly created ticket
- `pending`: Waiting for response
- `in_progress`: Currently being worked on
- `resolved`: Issue has been resolved
- `closed`: Ticket is closed

### Ticket Priority

- `low`: Low priority
- `medium`: Medium priority (default)
- `high`: High priority
- `urgent`: Urgent priority

---

## Error Responses

### 400 Bad Request

```json
{
  "statusCode": 400,
  "message": [
    "email must be an email",
    "password must be longer than or equal to 6 characters"
  ],
  "error": "Bad Request"
}
```

### 401 Unauthorized

```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

### 403 Forbidden

```json
{
  "statusCode": 403,
  "message": "You do not have permission to perform this action"
}
```

### 404 Not Found

```json
{
  "statusCode": 404,
  "message": "Ticket with ID abc123 not found"
}
```

### 409 Conflict

```json
{
  "statusCode": 409,
  "message": "User with this email already exists"
}
```

### 500 Internal Server Error

```json
{
  "statusCode": 500,
  "message": "Internal server error"
}
```

---

## Role-Based Access Control

### Customer Permissions

- Create tickets
- View own tickets
- Update own tickets (cannot change status or assign)
- Create comments on own tickets
- View non-internal comments
- View categories and tags

### Agent Permissions

- All customer permissions
- View tickets assigned to them or created by them
- Update assigned tickets (can change status, priority, assign)
- Create and manage tags
- Create internal comments
- View all comments (including internal)

### Admin Permissions

- All agent permissions
- View all tickets
- Manage users (create, update, delete)
- Manage categories
- Delete any ticket or comment
- Full system access

---

## Example Workflows

### Customer Creating a Ticket

1. **Register/Login:**

   ```bash
   POST /api/auth/register
   # or
   POST /api/auth/login
   ```

2. **Create Ticket:**

   ```bash
   POST /api/tickets
   Authorization: Bearer <token>
   {
     "subject": "Cannot access my account",
     "description": "I forgot my password",
     "priority": "high"
   }
   ```

3. **View Ticket:**
   ```bash
   GET /api/tickets/<ticket-id>
   Authorization: Bearer <token>
   ```

### Agent Responding to a Ticket

1. **Login:**

   ```bash
   POST /api/auth/login
   ```

2. **View Assigned Tickets:**

   ```bash
   GET /api/tickets
   Authorization: Bearer <token>
   ```

3. **Update Ticket Status:**

   ```bash
   PATCH /api/tickets/<ticket-id>
   Authorization: Bearer <token>
   {
     "status": "in_progress",
     "assignedToId": "<agent-id>"
   }
   ```

4. **Add Comment:**
   ```bash
   POST /api/comments
   Authorization: Bearer <token>
   {
     "ticketId": "<ticket-id>",
     "content": "I'm working on this issue",
     "isInternal": false
   }
   ```

---

## Notes

- All timestamps are in ISO 8601 format (UTC)
- All UUIDs follow the standard UUID v4 format
- Password requirements: Minimum 6 characters
- JWT tokens expire after 7 days (configurable via `JWT_EXPIRES_IN`)
- The API uses a global prefix `/api` for all endpoints
- CORS is enabled and configurable via `CORS_ORIGIN` environment variable
