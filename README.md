# ZeroBounce MCP Server

[![smithery badge](https://smithery.ai/badge/zerobounce-mcp)](https://smithery.ai/server/zerobounce-mcp)

A Model Context Protocol (MCP) server for accessing ZeroBounce API endpoints, providing tools for email validation, email finding, AI scoring, and more.

## Features

- **Real-Time Email Validation**: Instantly verify email addresses to reduce bounce rates.
- **Email Finder**: Discover email formats for specific domains or company names.
- **AI-Powered Scoring**: Use AI to score the quality of email lists.
- **Activity Data**: Gain insights into the activity of an email address.
- **Bulk List Evaluation**: Process and evaluate entire email lists for quality and deliverability.

## Architecture

This MCP server is built with TypeScript and the `@modelcontextprotocol/sdk`. It acts as a direct bridge to the ZeroBounce API, exposing its various endpoints as distinct, easy-to-use tools. The server is designed for deployment on Smithery and follows the standard MCP server structure. It handles both real-time (JSON) and bulk (file-based) API interactions.

## AI Integration

When integrating this MCP server with AI models, consider the following best practices:

1.  **Start with Validation**: Before performing other actions, use the `validateEmail` tool to ensure an email address is valid.
2.  **Use File-Based Tools for Bulk Operations**: For tasks like AI scoring (`scoringSendFile`) or list evaluation (`listEvaluator`), the API requires file uploads. The workflow involves submitting a file, checking its status, and then retrieving the results.
3.  **Check for Activity**: For valid emails, use the `getActivityData` tool to get more context about the user's engagement.
4.  **API Key Management**: Ensure the ZeroBounce API key is securely managed and passed to each tool as required.

## Configuration

To use this MCP server, you will need a ZeroBounce API key.

1.  Create an account on the [ZeroBounce website](https://www.zerobounce.net/).
2.  Find your API key in your account dashboard.
3.  Provide the API key in the `apiKey` parameter for each tool call.

## Installation

To install the necessary dependencies, run:

```bash
npm install
```

## Development

To run the MCP server locally in development mode, use the Smithery CLI:

```bash
npx @smithery/cli dev
```

## Build

To build the project for production, run:

```bash
npm run build
```

## Available Tools

For a detailed list of all available tools, their input schemas, and descriptions, please see the [TOOLS.md](./TOOLS.md) file.

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.
