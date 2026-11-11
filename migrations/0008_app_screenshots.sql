CREATE TABLE `app_screenshots` (
	`app_id` text PRIMARY KEY NOT NULL,
	`mime_type` text NOT NULL,
	`image` blob NOT NULL,
	`captured_at` integer NOT NULL
);
