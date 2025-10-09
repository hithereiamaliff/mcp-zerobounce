# ZeroBounce MCP Server Tools

This document provides a detailed overview of the available tools in the ZeroBounce MCP server.

## Email Validation

### `validateEmail`

Validates a single email address.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "apiKey": {
      "type": "string",
      "description": "Your ZeroBounce API key."
    },
    "email": {
      "type": "string",
      "description": "The email address to validate."
    },
    "ipAddress": {
      "type": "string",
      "description": "The IP address of the user (optional)."
    }
  },
  "required": ["apiKey", "email"]
}
```

## Email Finder

### `findEmail`

Finds the email format for a given domain or company name.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "apiKey": {
      "type": "string",
      "description": "Your ZeroBounce API key."
    },
    "domain": {
      "type": "string",
      "description": "The email domain for which to find the email format."
    },
    "companyName": {
      "type": "string",
      "description": "The company name for which to find the email format."
    }
  },
  "required": ["apiKey"]
}
```

## AI Scoring

### `scoringSendFile`

Submits a file for AI scoring.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "apiKey": {
      "type": "string",
      "description": "Your ZeroBounce API key."
    },
    "filePath": {
      "type": "string",
      "description": "The path to the file to be scored."
    },
    "emailAddressColumn": {
      "type": "integer",
      "description": "The column index of the email address in the file."
    },
    "hasHeaderRow": {
      "type": "boolean",
      "description": "Whether the file has a header row."
    }
  },
  "required": ["apiKey", "filePath", "emailAddressColumn"]
}
```

### `scoringFileStatus`

Gets the status of a submitted file for AI scoring.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "apiKey": {
      "type": "string",
      "description": "Your ZeroBounce API key."
    },
    "fileId": {
      "type": "string",
      "description": "The ID of the file to check."
    }
  },
  "required": ["apiKey", "fileId"]
}
```

### `scoringGetFile`

Gets the results of a scored file.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "apiKey": {
      "type": "string",
      "description": "Your ZeroBounce API key."
    },
    "fileId": {
      "type": "string",
      "description": "The ID of the file to retrieve."
    }
  },
  "required": ["apiKey", "fileId"]
}
```

### `scoringDeleteFile`

Deletes a scored file.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "apiKey": {
      "type": "string",
      "description": "Your ZeroBounce API key."
    },
    "fileId": {
      "type": "string",
      "description": "The ID of the file to delete."
    }
  },
  "required": ["apiKey", "fileId"]
}
```

## Activity Data

### `getActivityData`

Gets activity data for an email address.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "apiKey": {
      "type": "string",
      "description": "Your ZeroBounce API key."
    },
    "email": {
      "type": "string",
      "description": "The email address to check."
    }
  },
  "required": ["apiKey", "email"]
}
```

## List Evaluator

### `listEvaluator`

Submits a file for list evaluation.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "apiKey": {
      "type": "string",
      "description": "Your ZeroBounce API key."
    },
    "filePath": {
      "type": "string",
      "description": "The path to the file to be evaluated."
    },
    "emailAddressColumn": {
      "type": "integer",
      "description": "The column index of the email address in the file."
    }
  },
  "required": ["apiKey", "filePath", "emailAddressColumn"]
}