# AdAtlas large background library

> Legacy/advanced asset-management subsystem. The default `/create-product` flow uses six randomly selected advertisements from the user-provided ZIP and does not use this library as a generation fallback.

This directory contains only versioned configuration and schemas. Runtime images and job state are
kept out of Git.

Runtime folders are created automatically:

- `import/<collectionId>/<categoryId>/`: local files or ZIPs waiting to be imported
- `originals/`: licensed source files copied by the import pipeline
- `processed/`: approved 1600×1600 WebP backgrounds
- `thumbnails/`: 320×320 WebP list previews
- `review/`: rejected or manually reviewable records
- `jobs/`: resumable import and ComfyUI job checkpoints
- `logs/`: local operation logs

Every source image remains `unverified` unless the sidecar explicitly contains evidence of ownership
or a checked commercial license. Unverified assets are not production recommendations.

See `npm run backgrounds:status` for current counts and `npm run backgrounds:comfy:plan --
--collection <id> --dry-run` for a generation plan.
