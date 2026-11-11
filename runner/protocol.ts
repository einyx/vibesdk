// The Runner API: the contract between the worker and the runner service.
//
// The runner (see runner/) serves these endpoints; the worker speaks them
// through worker/services/sandbox/remoteSandboxService.ts. The schemas live
// here, with the service that answers them, so the two halves cannot drift:
// the worker validates every response against them, and the runner's own
// responses are type-checked against them.
//
// The Cloudflare-container SDK has its own shapes, which are not this
// service's business; they stay in worker/services/sandbox/sandboxTypes.ts.

import * as z from 'zod'

// --- Core File/Template Types ---

// Define the interface explicitly to break circular reference
export interface FileTreeNode {
    path: string;
    type: 'file' | 'directory';
    children?: FileTreeNode[];
}

export const FileTreeNodeSchema: z.ZodType<FileTreeNode> = z.lazy(() => z.object({
    path: z.string(),
    type: z.enum(['file', 'directory']),
    children: z.array(FileTreeNodeSchema).optional(),
}));

export const TemplateFileSchema = z.object({
    filePath: z.string(),
    fileContents: z.string(),
})
export type TemplateFile = z.infer<typeof TemplateFileSchema>

// ==========================================
// RUNTIME ERROR SCHEMAS
// ==========================================

export const SimpleErrorSchema = z.object({
  timestamp: z.string(),     // ISO timestamp
  level: z.number(),          // Pino log level (50=error, 60=fatal)
  message: z.string(),        // The 'msg' field from JSON log
  rawOutput: z.string()       // The complete raw JSON log line
});
export type SimpleError = z.infer<typeof SimpleErrorSchema>;

// StoredError extends SimpleError with storage-specific fields
export const StoredErrorSchema = SimpleErrorSchema.extend({
  id: z.number(),
  instanceId: z.string(),
  processId: z.string(),
  errorHash: z.string(),
  occurrenceCount: z.number(),
  createdAt: z.string()
});
export type StoredError = z.infer<typeof StoredErrorSchema>;

export const RuntimeErrorSchema = SimpleErrorSchema
export type RuntimeError = z.infer<typeof RuntimeErrorSchema>

// -- Instance creation options --

export const InstanceCreationRequestSchema = z.object({
    files: z.array(TemplateFileSchema),
    projectName: z.string(),
    webhookUrl: z.string().url().optional(),
    envVars: z.record(z.string(), z.string()).optional(),
    initCommand: z.string().default('bun run dev'),
})
export type InstanceCreationRequest = z.infer<typeof InstanceCreationRequestSchema>

// --- Instance Details ---

export const InstanceDetailsSchema = z.object({
    runId: z.string(),
    /** The project the instance serves — how a redeploy finds its predecessor. */
    name: z.string().optional(),
    projectName: z.string().optional(),
    startTime: z.union([z.string(), z.date()]),
    uptime: z.number(),
    previewURL: z.string().optional(),
    tunnelURL: z.string().optional(),
    directory: z.string(),
    serviceDirectory: z.string(),
    fileTree: FileTreeNodeSchema.optional(),
    runtimeErrors: z.array(RuntimeErrorSchema).optional(),
    processId: z.string().optional(),   
})
export type InstanceDetails = z.infer<typeof InstanceDetailsSchema>

// --- Command Execution ---

export const CommandExecutionResultSchema = z.object({
    command: z.string(),
    success: z.boolean(),
    output: z.string(),
    error: z.string().optional(),
    exitCode: z.number().optional(),
})
export type CommandExecutionResult = z.infer<typeof CommandExecutionResultSchema>

// --- API Request/Response Schemas ---


export const BootstrapRequestSchema = InstanceCreationRequestSchema
export type BootstrapRequest = z.infer<typeof BootstrapRequestSchema>

export const PreviewSchema = z.object({
    runId: z.string().optional(),
    previewURL: z.string().optional(),
    tunnelURL: z.string().optional(),
})
export type PreviewType = z.infer<typeof PreviewSchema>

export const BootstrapResponseSchema = PreviewSchema.extend({
    success: z.boolean(),
    processId: z.string().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
})
export type BootstrapResponse = z.infer<typeof BootstrapResponseSchema>

// /instances/:id/status (GET)
export const BootstrapStatusResponseSchema = z.object({
    success: z.boolean(),
    pending: z.boolean(),
    message: z.string().optional(),
    previewURL: z.string().optional(),
    tunnelURL: z.string().optional(),
    processId: z.string().optional(),
    isHealthy: z.boolean(),
    error: z.string().optional(),
})
export type BootstrapStatusResponse = z.infer<typeof BootstrapStatusResponseSchema>

// /instances (GET)
export const ListInstancesResponseSchema = z.object({
    success: z.boolean(),
    instances: z.array(InstanceDetailsSchema),
    count: z.number(),
    error: z.string().optional(),
})
export type ListInstancesResponse = z.infer<typeof ListInstancesResponseSchema>

// /instances/:id (GET)
export const GetInstanceResponseSchema = z.object({
    success: z.boolean(),
    instance: InstanceDetailsSchema.optional(),
    error: z.string().optional(),
})
export type GetInstanceResponse = z.infer<typeof GetInstanceResponseSchema>

// /instances/:id/files (POST)
export const WriteFilesRequestSchema = z.object({
    files: z.array(z.object({
        filePath: z.string(),
        fileContents: z.string(),
    })), 
    commitMessage: z.string().optional(),
})
export type WriteFilesRequest = z.infer<typeof WriteFilesRequestSchema>

// /instances/:id/files (GET) - Define schema for getting files from an instance
export const GetFilesResponseSchema = z.object({
    success: z.boolean(),
    files: z.array(TemplateFileSchema), // Re-use TemplateFileSchema { filePath, fileContents }
    errors: z.array(z.object({ file: z.string(), error: z.string() })).optional(),
    error: z.string().optional(),
})
export type GetFilesResponse = z.infer<typeof GetFilesResponseSchema>

export const WriteFilesResponseSchema = z.object({
    success: z.boolean(),
    message: z.string().optional(),
    results: z.array(z.object({
        file: z.string(),
        success: z.boolean(),
        error: z.string().optional(),
    })),
    error: z.string().optional(),
})
export type WriteFilesResponse = z.infer<typeof WriteFilesResponseSchema>

export const GetLogsResponseSchema = z.object({
    success: z.boolean(),
    logs: z.object({
        stdout: z.string(),
        stderr: z.string(),
    }),
    error: z.string().optional(),
})
export type GetLogsResponse = z.infer<typeof GetLogsResponseSchema>

// /instances/:id/commands (POST)
export const ExecuteCommandsRequestSchema = z.object({
    commands: z.array(z.string()),
    timeout: z.number().optional(),
})
export type ExecuteCommandsRequest = z.infer<typeof ExecuteCommandsRequestSchema>

export const ExecuteCommandsResponseSchema = z.object({
    success: z.boolean(),
    results: z.array(CommandExecutionResultSchema),
    message: z.string().optional(),
    error: z.string().optional(),
})
export type ExecuteCommandsResponse = z.infer<typeof ExecuteCommandsResponseSchema>

// /instances/:id/errors (GET)
export const RuntimeErrorResponseSchema = z.object({
    success: z.boolean(),
    errors: z.array(RuntimeErrorSchema),
    hasErrors: z.boolean(),
    error: z.string().optional(),
})
export type RuntimeErrorResponse = z.infer<typeof RuntimeErrorResponseSchema>

// /instances/:id/errors (DELETE)
export const ClearErrorsResponseSchema = z.object({
    success: z.boolean(),
    message: z.string().optional(),
    error: z.string().optional(),
})
export type ClearErrorsResponse = z.infer<typeof ClearErrorsResponseSchema>


// /instances/:id (DELETE)
export const ShutdownResponseSchema = z.object({
    success: z.boolean(),
    message: z.string().optional(),
    error: z.string().optional(),
})
export type ShutdownResponse = z.infer<typeof ShutdownResponseSchema>

// /instances/:id/lint (GET)
export const LintSeveritySchema = z.enum(['error', 'warning', 'info'])
export type LintSeverity = z.infer<typeof LintSeveritySchema>

export const CodeIssueSchema = z.object({
    message: z.string(),
    filePath: z.string(),
    line: z.number(),
    column: z.number().optional(),
    severity: LintSeveritySchema,
    ruleId: z.string().optional(),
    source: z.string().optional()
})
export type CodeIssue = z.infer<typeof CodeIssueSchema>

export const CodeIssueResponseSchema =  z.object({
    issues: z.array(CodeIssueSchema),
    summary: z.object({
        errorCount: z.number(),
        warningCount: z.number(),
        infoCount: z.number()
    }).optional(),
    rawOutput: z.string().optional(),
})
export type CodeIssueResponse = z.infer<typeof CodeIssueResponseSchema>

export const StaticAnalysisResponseSchema = z.object({
    success: z.boolean(),
    lint: CodeIssueResponseSchema,
    typecheck: CodeIssueResponseSchema,
    error: z.string().optional()
})
export type StaticAnalysisResponse = z.infer<typeof StaticAnalysisResponseSchema>

// --- Cloudflare Deployment ---

// /instances/:id/deploy (POST) - Response
export const DeploymentResultSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    deployedUrl: z.string().optional(),
    deploymentId: z.string().optional(),
    output: z.string().optional(),
    error: z.string().optional(),
})
export type DeploymentResult = z.infer<typeof DeploymentResultSchema>


// Common fields for GitHub operations
interface GitHubUserInfo {
    token: string;
    email: string;
    username: string;
    isPrivate: boolean;
}

// Request for pushing to existing repository (low-level push)
export interface GitHubPushRequest extends GitHubUserInfo {
    cloneUrl: string;
    repositoryHtmlUrl: string;
}

export const GitHubPushResponseSchema = z.object({
    success: z.boolean(),
    commitSha: z.string().optional(),
    error: z.string().optional(),
    details: z.object({
        operation: z.string().optional(),
        exitCode: z.number().optional(),
        stderr: z.string().optional(),
    }).optional(),
})
export type GitHubPushResponse = z.infer<typeof GitHubPushResponseSchema>