import { McpServer, McpRequest, McpResponse, McpTool } from '@modelcontextprotocol/sdk';
import axios from 'axios';
import * as fs from 'fs';
import FormData from 'form-data';

const server = new McpServer({
  name: 'zerobounce-mcp',
  description: 'A Model Context Protocol (MCP) server for accessing ZeroBounce API endpoints.',
  tools: [
    new McpTool({
      name: 'validateEmail',
      description: 'Validates an email address using the ZeroBounce API.',
      inputSchema: {
        type: 'object',
        properties: {
          apiKey: {
            type: 'string',
            description: 'Your ZeroBounce API key.',
          },
          email: {
            type: 'string',
            description: 'The email address to validate.',
          },
          ipAddress: {
            type: 'string',
            description: 'The IP address of the user (optional).',
          },
        },
        required: ['apiKey', 'email'],
      },
      handler: async (request: McpRequest, response: McpResponse) => {
        const { apiKey, email, ipAddress } = request.body;

        try {
          const { data } = await axios.get('https://api.zerobounce.net/v2/validate', {
            params: {
              api_key: apiKey,
              email,
              ip_address: ipAddress,
            },
          });
          response.write(data);
        } catch (error) {
          if (axios.isAxiosError(error) && error.response) {
            response.write({
              error: 'API request failed',
              status: error.response.status,
              data: error.response.data,
            });
          } else {
            response.write({
              error: 'An unexpected error occurred',
            });
          }
        } finally {
          response.end();
        }
      },
    }),
    new McpTool({
      name: 'findEmail',
      description: 'Finds the email format for a given domain or company name.',
      inputSchema: {
        type: 'object',
        properties: {
          apiKey: {
            type: 'string',
            description: 'Your ZeroBounce API key.',
          },
          domain: {
            type: 'string',
            description: 'The email domain for which to find the email format.',
          },
          companyName: {
            type: 'string',
            description: 'The company name for which to find the email format.',
          },
        },
        required: ['apiKey'],
      },
      handler: async (request: McpRequest, response: McpResponse) => {
        const { apiKey, domain, companyName } = request.body;

        if (!domain && !companyName) {
          response.write({
            error: 'Either domain or companyName must be provided.',
          });
          response.end();
          return;
        }

        try {
          const { data } = await axios.get('https://api.zerobounce.net/v2/guessformat', {
            params: {
              api_key: apiKey,
              domain,
              company_name: companyName,
            },
          });
          response.write(data);
        } catch (error) {
          if (axios.isAxiosError(error) && error.response) {
            response.write({
              error: 'API request failed',
              status: error.response.status,
              data: error.response.data,
            });
          } else {
            response.write({
              error: 'An unexpected error occurred',
            });
          }
        } finally {
          response.end();
        }
      },
    }),
    new McpTool({
      name: 'scoringSendFile',
      description: 'Submits a file for AI scoring.',
      inputSchema: {
        type: 'object',
        properties: {
          apiKey: {
            type: 'string',
            description: 'Your ZeroBounce API key.',
          },
          filePath: {
            type: 'string',
            description: 'The path to the file to be scored.',
          },
          emailAddressColumn: {
            type: 'integer',
            description: 'The column index of the email address in the file.',
          },
          hasHeaderRow: {
            type: 'boolean',
            description: 'Whether the file has a header row.',
          },
        },
        required: ['apiKey', 'filePath', 'emailAddressColumn'],
      },
      handler: async (request: McpRequest, response: McpResponse) => {
        const { apiKey, filePath, emailAddressColumn, hasHeaderRow } = request.body;

        try {
          const form = new FormData();
          form.append('api_key', apiKey);
          form.append('email_address_column', emailAddressColumn);
          if (hasHeaderRow) {
            form.append('has_header_row', hasHeaderRow);
          }
          form.append('file', fs.createReadStream(filePath));

          const { data } = await axios.post('https://bulkapi.zerobounce.net/v2/scoring/sendfile', form, {
            headers: form.getHeaders(),
          });
          response.write(data);
        } catch (error) {
          if (axios.isAxiosError(error) && error.response) {
            response.write({
              error: 'API request failed',
              status: error.response.status,
              data: error.response.data,
            });
          } else {
            response.write({
              error: 'An unexpected error occurred',
            });
          }
        } finally {
          response.end();
        }
      },
    }),
    new McpTool({
      name: 'scoringFileStatus',
      description: 'Gets the status of a submitted file for AI scoring.',
      inputSchema: {
        type: 'object',
        properties: {
          apiKey: {
            type: 'string',
            description: 'Your ZeroBounce API key.',
          },
          fileId: {
            type: 'string',
            description: 'The ID of the file to check.',
          },
        },
        required: ['apiKey', 'fileId'],
      },
      handler: async (request: McpRequest, response: McpResponse) => {
        const { apiKey, fileId } = request.body;
        try {
          const { data } = await axios.get('https://bulkapi.zerobounce.net/v2/scoring/filestatus', {
            params: {
              api_key: apiKey,
              file_id: fileId,
            },
          });
          response.write(data);
        } catch (error) {
          if (axios.isAxiosError(error) && error.response) {
            response.write({
              error: 'API request failed',
              status: error.response.status,
              data: error.response.data,
            });
          } else {
            response.write({
              error: 'An unexpected error occurred',
            });
          }
        } finally {
          response.end();
        }
      },
    }),
    new McpTool({
      name: 'scoringGetFile',
      description: 'Gets the results of a scored file.',
      inputSchema: {
        type: 'object',
        properties: {
          apiKey: {
            type: 'string',
            description: 'Your ZeroBounce API key.',
          },
          fileId: {
            type: 'string',
            description: 'The ID of the file to retrieve.',
          },
        },
        required: ['apiKey', 'fileId'],
      },
      handler: async (request: McpRequest, response: McpResponse) => {
        const { apiKey, fileId } = request.body;
        try {
          const { data } = await axios.get('https://bulkapi.zerobounce.net/v2/scoring/getfile', {
            params: {
              api_key: apiKey,
              file_id: fileId,
            },
          });
          response.write(data);
        } catch (error) {
          if (axios.isAxiosError(error) && error.response) {
            response.write({
              error: 'API request failed',
              status: error.response.status,
              data: error.response.data,
            });
          } else {
            response.write({
              error: 'An unexpected error occurred',
            });
          }
        } finally {
          response.end();
        }
      },
    }),
    new McpTool({
      name: 'scoringDeleteFile',
      description: 'Deletes a scored file.',
      inputSchema: {
        type: 'object',
        properties: {
          apiKey: {
            type: 'string',
            description: 'Your ZeroBounce API key.',
          },
          fileId: {
            type: 'string',
            description: 'The ID of the file to delete.',
          },
        },
        required: ['apiKey', 'fileId'],
      },
      handler: async (request: McpRequest, response: McpResponse) => {
        const { apiKey, fileId } = request.body;
        try {
          const { data } = await axios.get('https://bulkapi.zerobounce.net/v2/scoring/deletefile', {
            params: {
              api_key: apiKey,
              file_id: fileId,
            },
          });
          response.write(data);
        } catch (error) {
          if (axios.isAxiosError(error) && error.response) {
            response.write({
              error: 'API request failed',
              status: error.response.status,
              data: error.response.data,
            });
          } else {
            response.write({
              error: 'An unexpected error occurred',
            });
          }
        } finally {
          response.end();
        }
      },
    }),
    new McpTool({
      name: 'getActivityData',
      description: 'Gets activity data for an email address.',
      inputSchema: {
        type: 'object',
        properties: {
          apiKey: {
            type: 'string',
            description: 'Your ZeroBounce API key.',
          },
          email: {
            type: 'string',
            description: 'The email address to check.',
          },
        },
        required: ['apiKey', 'email'],
      },
      handler: async (request: McpRequest, response: McpResponse) => {
        const { apiKey, email } = request.body;
        try {
          const { data } = await axios.get('https://api.zerobounce.net/v2/activity', {
            params: {
              api_key: apiKey,
              email,
            },
          });
          response.write(data);
        } catch (error) {
          if (axios.isAxiosError(error) && error.response) {
            response.write({
              error: 'API request failed',
              status: error.response.status,
              data: error.response.data,
            });
          } else {
            response.write({
              error: 'An unexpected error occurred',
            });
          }
        } finally {
          response.end();
        }
      },
    }),
    new McpTool({
      name: 'listEvaluator',
      description: 'Submits a file for list evaluation.',
      inputSchema: {
        type: 'object',
        properties: {
          apiKey: {
            type: 'string',
            description: 'Your ZeroBounce API key.',
          },
          filePath: {
            type: 'string',
            description: 'The path to the file to be evaluated.',
          },
          emailAddressColumn: {
            type: 'integer',
            description: 'The column index of the email address in the file.',
          },
        },
        required: ['apiKey', 'filePath', 'emailAddressColumn'],
      },
      handler: async (request: McpRequest, response: McpResponse) => {
        const { apiKey, filePath, emailAddressColumn } = request.body;

        try {
          const form = new FormData();
          form.append('api_key', apiKey);
          form.append('email_address_column', emailAddressColumn);
          form.append('file', fs.createReadStream(filePath));

          const { data } = await axios.post('https://bulkapi.zerobounce.net/v2/listevaluator/', form, {
            headers: form.getHeaders(),
          });
          response.write(data);
        } catch (error) {
          if (axios.isAxiosError(error) && error.response) {
            response.write({
              error: 'API request failed',
              status: error.response.status,
              data: error.response.data,
            });
          } else {
            response.write({
              error: 'An unexpected error occurred',
            });
          }
        } finally {
          response.end();
        }
      },
    }),
  ],
});

server.listen();