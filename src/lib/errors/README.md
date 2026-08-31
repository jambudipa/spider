# Error types

This folder defines the tagged errors that carry Spider failure context through Effect programs. The errors keep failure handling typed and preserve useful data for logs.

Start with `effect-errors.ts`. Add a tagged error here when a failure crosses a library boundary or needs structured recovery data.

Keep error construction free of side effects. Do not put retry policy, logging, or transport operations in this folder.
