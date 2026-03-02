# ZeroBounce MCP Server Tools

This document provides a detailed overview of the available tools in the ZeroBounce MCP server.

> **Note:** The `apiKey` parameter is optional on all tools if you have set the `ZEROBOUNCE_API_KEY` environment variable or are using the hosted server with `?apiKey=` query parameter.

---

## Test

### `hello`

A simple test tool to verify that the MCP server is working correctly.

**Parameters:** None

---

## Email Validation

### `validate_email`

Validates an email address using the ZeroBounce API. Returns detailed validation results including status, sub-status, free email check, domain info, and more.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `apiKey` | string | No | ZeroBounce API key (optional if env var is set) |
| `email` | string | Yes | The email address to validate |
| `ipAddress` | string | No | The IP address of the email sender |

---

## Email Finder

### `find_email`

Finds the email format for a given domain or company name. At least one of `domain` or `companyName` must be provided.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `apiKey` | string | No | ZeroBounce API key (optional if env var is set) |
| `domain` | string | No | The email domain to search |
| `companyName` | string | No | The company name to search |

---

## AI Scoring

### `scoring_send_file`

Submits a file for AI scoring. Returns a file ID for tracking.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `apiKey` | string | No | ZeroBounce API key (optional if env var is set) |
| `filePath` | string | Yes | Path to the file to be scored |
| `emailAddressColumn` | integer | Yes | Column index of email addresses (1-based) |
| `hasHeaderRow` | boolean | No | Whether the file has a header row |

### `scoring_file_status`

Gets the status of a submitted file for AI scoring.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `apiKey` | string | No | ZeroBounce API key (optional if env var is set) |
| `fileId` | string | Yes | The file ID returned from `scoring_send_file` |

### `scoring_get_file`

Gets the results of a scored file.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `apiKey` | string | No | ZeroBounce API key (optional if env var is set) |
| `fileId` | string | Yes | The file ID to retrieve results for |

### `scoring_delete_file`

Deletes a scored file from ZeroBounce.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `apiKey` | string | No | ZeroBounce API key (optional if env var is set) |
| `fileId` | string | Yes | The file ID to delete |

---

## Activity Data

### `get_activity_data`

Gets activity data for an email address. Shows if the email has been active and engaged.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `apiKey` | string | No | ZeroBounce API key (optional if env var is set) |
| `email` | string | Yes | The email address to check activity for |

---

## List Evaluator

### `list_evaluator`

Submits a file for list evaluation. Evaluates the quality and deliverability of an email list.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `apiKey` | string | No | ZeroBounce API key (optional if env var is set) |
| `filePath` | string | Yes | Path to the file to be evaluated |
| `emailAddressColumn` | integer | Yes | Column index of email addresses (1-based) |

---

## Account

### `get_credits`

Gets the remaining credits balance for your ZeroBounce account.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `apiKey` | string | No | ZeroBounce API key (optional if env var is set) |

### `get_api_usage`

Gets the API usage statistics for your ZeroBounce account within a date range.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `apiKey` | string | No | ZeroBounce API key (optional if env var is set) |
| `startDate` | string | Yes | Start date in YYYY-MM-DD format |
| `endDate` | string | Yes | End date in YYYY-MM-DD format |