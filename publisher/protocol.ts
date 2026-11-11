// The Publisher API: the contract between the worker and the publisher
// service.
//
// The publisher turns a bundle of files into a Kubernetes stack — a
// Deployment, a Service and a volume per app — inside the cluster's
// app namespace, and serves the deployed app's traffic.
//
// The schemas live here, with the service that answers them, so the two
// halves cannot drift: the worker validates every response against them,
// and the publisher's own responses are type-checked against them.

import * as z from 'zod'

// --- Bundle files ---

export const PublishFileSchema = z.object({
	filePath: z.string(),
	fileContents: z.string(),
})
export type PublishFile = z.infer<typeof PublishFileSchema>

// --- Requests ---

export const PublishRequestSchema = z.object({
	/** The app's id. The stack is named after it, and so is its URL. */
	appId: z.string(),
	/** The app's name: the labels carry it, and the operator reads it. */
	name: z.string().optional(),
	/** The bundle: the entry module, the app's modules, the assets, the config. */
	files: z.array(PublishFileSchema),
	/** The app's runtime environment. */
	env: z.record(z.string(), z.string()).optional(),
	/** What was published: the bundle's commit, for the operator's eyes. */
	revision: z.string().optional(),
})
export type PublishRequest = z.infer<typeof PublishRequestSchema>

export const UnpublishRequestSchema = z.object({
	appId: z.string(),
})
export type UnpublishRequest = z.infer<typeof UnpublishRequestSchema>

// --- Responses ---

export const PublishStateSchema = z.enum(['applying', 'ready', 'failed'])
export type PublishState = z.infer<typeof PublishStateSchema>

export const PublishResponseSchema = z.object({
	success: z.boolean(),
	appId: z.string(),
	/** Where the app is served from. */
	url: z.string().optional(),
	state: PublishStateSchema.optional(),
	message: z.string().optional(),
	error: z.string().optional(),
})
export type PublishResponse = z.infer<typeof PublishResponseSchema>

export const PublishStatusResponseSchema = z.object({
	success: z.boolean(),
	appId: z.string(),
	url: z.string().optional(),
	state: PublishStateSchema.optional(),
	/** Whether the app's pod is serving. */
	ready: z.boolean().optional(),
	message: z.string().optional(),
	error: z.string().optional(),
})
export type PublishStatusResponse = z.infer<typeof PublishStatusResponseSchema>

export const BundleResponseSchema = z.object({
	files: z.array(PublishFileSchema),
})
export type BundleResponse = z.infer<typeof BundleResponseSchema>
