#!/usr/bin/env node
import 'dotenv/config';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { RenphoApiService } from './services/renpho-api.js';
import { loadConfig } from './config.js';
import {
  formatUser,
  formatMeasurement,
  formatBodyComposition,
  formatWeightTrend,
  formatMeasurementList,
  formatScaleUsers,
  formatSyncDiagnostics
} from './utils/formatting.js';
import { createLogger, format, transports } from 'winston';

const config = loadConfig();

const logger = createLogger({
  level: config.logLevel,
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    new transports.File({ filename: 'renpho-error.log', level: 'error' }),
    new transports.File({ filename: 'renpho-combined.log' })
  ]
});

const renphoApi = new RenphoApiService(config.email, config.password);

const server = new McpServer({
  name: 'renpho-mcp-server',
  version: '1.1.0'
});

server.tool(
  'get_current_user',
  'Get current Renpho user information',
  async () => {
    try {
      const user = await renphoApi.getCurrentUser();
      return {
        content: [{
          type: 'text' as const,
          text: formatUser(user)
        }]
      };
    } catch (error) {
      logger.error('Failed to get current user', { error: (error as Error).message });
      throw error;
    }
  }
);

server.tool(
  'get_scale_users',
  'Get linked Renpho scale-user IDs and table mappings discovered from the account',
  async () => {
    try {
      const scaleUsers = await renphoApi.getScaleUsers();
      return {
        content: [{
          type: 'text' as const,
          text: formatScaleUsers(scaleUsers)
        }]
      };
    } catch (error) {
      logger.error('Failed to get scale users', { error: (error as Error).message });
      throw error;
    }
  }
);

server.tool(
  'get_latest_measurement',
  'Get the most recent body composition measurement from Renpho scale',
  async () => {
    try {
      const measurement = await renphoApi.getLatestMeasurement();
      if (!measurement) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No measurements found.'
          }]
        };
      }
      return {
        content: [{
          type: 'text' as const,
          text: formatMeasurement(measurement)
        }]
      };
    } catch (error) {
      logger.error('Failed to get latest measurement', { error: (error as Error).message });
      throw error;
    }
  }
);

server.tool(
  'get_body_composition',
  'Get detailed body composition analysis with health classifications',
  async () => {
    try {
      const composition = await renphoApi.getBodyComposition();
      if (!composition) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No body composition data available.'
          }]
        };
      }
      return {
        content: [{
          type: 'text' as const,
          text: formatBodyComposition(composition)
        }]
      };
    } catch (error) {
      logger.error('Failed to get body composition', { error: (error as Error).message });
      throw error;
    }
  }
);

server.tool(
  'get_weight_trend',
  {
    days: z.number().min(1).max(365).default(30).describe('Number of days to analyze (default: 30)')
  },
  async ({ days }: { days: number }) => {
    try {
      const trend = await renphoApi.getWeightTrend(days);
      if (!trend) {
        return {
          content: [{
            type: 'text' as const,
            text: `No weight data available for the past ${days} days.`
          }]
        };
      }
      return {
        content: [{
          type: 'text' as const,
          text: formatWeightTrend(trend)
        }]
      };
    } catch (error) {
      logger.error('Failed to get weight trend', { error: (error as Error).message, days });
      throw error;
    }
  }
);

server.tool(
  'get_measurements',
  {
    days: z.number().min(1).max(365).default(30).describe('Number of days to retrieve (default: 30)'),
    limit: z.number().min(1).max(500).default(100).describe('Maximum number of measurements (default: 100)')
  },
  async ({ days, limit }: { days: number; limit: number }) => {
    try {
      const startTimestamp = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
      const measurements = await renphoApi.getMeasurements(undefined, startTimestamp, limit);
      return {
        content: [{
          type: 'text' as const,
          text: formatMeasurementList(measurements)
        }]
      };
    } catch (error) {
      logger.error('Failed to get measurements', { error: (error as Error).message, days, limit });
      throw error;
    }
  }
);

server.tool(
  'get_sync_diagnostics',
  {
    days: z.number().min(1).max(30).default(7).describe('How many recent days to inspect for hidden or delayed measurements (default: 7)')
  },
  async ({ days }: { days: number }) => {
    try {
      const diagnostics = await renphoApi.getSyncDiagnostics(days);
      return {
        content: [{
          type: 'text' as const,
          text: formatSyncDiagnostics(diagnostics)
        }]
      };
    } catch (error) {
      logger.error('Failed to get sync diagnostics', { error: (error as Error).message, days });
      throw error;
    }
  }
);

server.tool(
  'refresh_data',
  'Clear Renpho auth/measurement caches and re-fetch account state. Useful after taking a new measurement or after the mobile app syncs.',
  async () => {
    try {
      renphoApi.invalidateCaches();
      const user = await renphoApi.getCurrentUser();
      return {
        content: [{
          type: 'text' as const,
          text: `Renpho cache cleared and session refreshed for ${user.email}.`
        }]
      };
    } catch (error) {
      logger.error('Failed to refresh data', { error: (error as Error).message });
      throw error;
    }
  }
);

server.tool(
  'health_check',
  'Check the health status of the Renpho MCP server and API connection',
  async () => {
    try {
      const user = await renphoApi.getCurrentUser();
      return {
        content: [{
          type: 'text' as const,
          text: `Renpho MCP Server Health Check\n\nStatus: Healthy\nTimestamp: ${new Date().toISOString()}\nAPI Connection: OK\nUser: ${user.email}\nVersion: 1.1.0`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: `Renpho MCP Server Health Check\n\nStatus: Unhealthy\nTimestamp: ${new Date().toISOString()}\nAPI Connection: Failed\nError: ${(error as Error).message}`
        }]
      };
    }
  }
);

async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('Renpho MCP Server started successfully');
  } catch (error) {
    logger.error('Failed to start server', { error: (error as Error).message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

main().catch(error => {
  logger.error('Unhandled error', { error: (error as Error).message });
  process.exit(1);
});
