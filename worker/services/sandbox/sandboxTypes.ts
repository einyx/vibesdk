// The Cloudflare-container SDK's shapes, and the Runner API it speaks.
//
// The Runner API itself lives in runner/protocol.ts, with the service that
// answers it; it is re-exported here so the sandbox modules keep one import
// path.
import * as z from 'zod'
import {
	FileTreeNodeSchema,
	RuntimeErrorSchema,
	TemplateFileSchema,
} from '../../../runner/protocol.ts'

export * from '../../../runner/protocol.ts'

// /templates (GET)

export const TemplateInfoSchema = z.object({
    name: z.string(),
    language: z.string().optional(),
    frameworks: z.array(z.string()).optional(),
    projectType: z.enum(['app', 'workflow', 'presentation', 'general']).default('app'),
    description: z.object({
        selection: z.string(),
        usage: z.string(),
    }),
    renderMode: z.enum(['sandbox', 'browser']).optional(),
    slideDirectory: z.string().optional(),
    disabled: z.boolean(),
})
export type TemplateInfo = z.infer<typeof TemplateInfoSchema>

// --- Template Details ---

export const TemplateDetailsSchema = TemplateInfoSchema.extend({
    fileTree: FileTreeNodeSchema,
    allFiles: z.record(z.string(), z.string()),
    deps: z.record(z.string(), z.string()),
    importantFiles: z.array(z.string()),
    dontTouchFiles: z.array(z.string()),
    redactedFiles: z.array(z.string()),
})
export type TemplateDetails = z.infer<typeof TemplateDetailsSchema>

export const TemplateListResponseSchema = z.object({
    success: z.boolean(),
    templates: z.array(TemplateInfoSchema),
    count: z.number(),
    error: z.string().optional(),
})
export type TemplateListResponse = z.infer<typeof TemplateListResponseSchema>

// /template/:name (GET)
export const TemplateDetailsResponseSchema = z.object({
    success: z.boolean(),
    templateDetails: TemplateDetailsSchema.optional(),
    error: z.string().optional(),
})
export type TemplateDetailsResponse = z.infer<typeof TemplateDetailsResponseSchema>

// /template/:name/files (POST)
export const GetTemplateFilesRequestSchema = z.object({
    filePaths: z.array(z.string()),
})
export type GetTemplateFilesRequest = z.infer<typeof GetTemplateFilesRequestSchema>

export const GetTemplateFilesResponseSchema = z.object({
    success: z.boolean(),
    files: z.array(TemplateFileSchema),
    errors: z.array(z.object({ file: z.string(), error: z.string() })).optional(),
    error: z.string().optional(),
})
export type GetTemplateFilesResponse = z.infer<typeof GetTemplateFilesResponseSchema>

// /instances/:id/fix-code (POST)
export const FixCodeResponseSchema = z.object({
    success: z.boolean(),
    message: z.string().optional(),
    fixes: z.array(z.object({
        filePath: z.string(),
        originalCode: z.string(),
        fixedCode: z.string(),
        explanation: z.string(),
    })),
    applied: z.array(z.string()).optional(),
    failed: z.array(z.string()).optional(),
    commands: z.array(z.string()).optional(),
    error: z.string().optional(),
})
export type FixCodeResponse = z.infer<typeof FixCodeResponseSchema>

// /instances/:id/deploy (POST) - Request body
export const DeploymentCredentialsSchema = z.object({
    apiToken: z.string().optional(),
    accountId: z.string().optional(),
})
export type DeploymentCredentials = z.infer<typeof DeploymentCredentialsSchema>


// --- Webhook Event Types ---

// Base webhook event schema
export const WebhookEventBaseSchema = z.object({
    eventType: z.string(),
    instanceId: z.string(),
    timestamp: z.union([z.string(), z.date()]).transform(val => typeof val === 'string' ? val : val.toISOString()),
    agentId: z.string().optional(),
})

// Runtime error webhook event - compatible with current runner service
export const WebhookRuntimeErrorEventSchema = WebhookEventBaseSchema.extend({
    eventType: z.literal('runtime_error'),
    payload: z.object({
        runId: z.string(),
        error: RuntimeErrorSchema,
        instanceInfo: z.object({
            instanceId: z.string(),
            serviceDirectory: z.string().optional(),
        }),
    }),
})
export type WebhookRuntimeErrorEvent = z.infer<typeof WebhookRuntimeErrorEventSchema>

// Build status webhook event (for future use)
export const WebhookBuildStatusEventSchema = WebhookEventBaseSchema.extend({
    eventType: z.literal('build_status'),
    payload: z.object({
        status: z.enum(['started', 'completed', 'failed']),
        buildOutput: z.string().optional(),
        buildErrors: z.array(z.string()).optional(),
        duration: z.number().optional(),
    }),
})
export type WebhookBuildStatusEvent = z.infer<typeof WebhookBuildStatusEventSchema>

// Deployment status webhook event (for future use)
export const WebhookDeploymentStatusEventSchema = WebhookEventBaseSchema.extend({
    eventType: z.literal('deployment_status'),
    payload: z.object({
        status: z.enum(['started', 'completed', 'failed']),
        deploymentType: z.enum(['preview', 'cloudflare_workers']).optional(),
        deployedUrl: z.string().optional(),
        deploymentId: z.string().optional(),
        error: z.string().optional(),
    }),
})
export type WebhookDeploymentStatusEvent = z.infer<typeof WebhookDeploymentStatusEventSchema>

// Instance health webhook event (for future use)
export const WebhookInstanceHealthEventSchema = WebhookEventBaseSchema.extend({
    eventType: z.literal('instance_health'),
    payload: z.object({
        status: z.enum(['healthy', 'unhealthy', 'shutting_down']),
        uptime: z.number().optional(),
        memoryUsage: z.number().optional(),
        cpuUsage: z.number().optional(),
        lastActivity: z.union([z.string(), z.date()]).optional(),
        message: z.string().optional(),
    }),
})
export type WebhookInstanceHealthEvent = z.infer<typeof WebhookInstanceHealthEventSchema>

// Command execution webhook event (for future use)
export const WebhookCommandExecutionEventSchema = WebhookEventBaseSchema.extend({
    eventType: z.literal('command_execution'),
    payload: z.object({
        status: z.enum(['started', 'completed', 'failed']),
        command: z.string(),
        output: z.string().optional(),
        error: z.string().optional(),
        exitCode: z.number().optional(),
        duration: z.number().optional(),
    }),
})
export type WebhookCommandExecutionEvent = z.infer<typeof WebhookCommandExecutionEventSchema>

// Union type for all webhook events
export const WebhookEventSchema = z.discriminatedUnion('eventType', [
    WebhookRuntimeErrorEventSchema,
    WebhookBuildStatusEventSchema,
    WebhookDeploymentStatusEventSchema,
    WebhookInstanceHealthEventSchema,
    WebhookCommandExecutionEventSchema,
])
export type WebhookEvent = z.infer<typeof WebhookEventSchema>

// Webhook payload with authentication
export const WebhookPayloadSchema = z.object({
    signature: z.string().optional(),
    timestamp: z.union([z.string(), z.date()]),
    event: WebhookEventSchema,
})
export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>
/**
 * GitHub integration types for exporting generated applications
 */
