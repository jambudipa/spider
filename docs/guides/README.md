# Spider User Guides

This directory contains step-by-step guides for learning and using Spider effectively.

## Available Guides

### Getting Started
- **[getting-started.md](./getting-started.md)** - Installation, setup, and your first crawl
- **[configuration.md](./configuration.md)** - Complete configuration reference and patterns

### Development Guides
- **[middleware.md](./middleware.md)** - Creating and using custom middleware  
- **[testing.md](./testing.md)** - Testing strategies for crawler applications
- **[error-handling.md](./error-handling.md)** - Robust error handling patterns

### Advanced Usage
- **[advanced-patterns.md](./advanced-patterns.md)** - Complex crawling strategies and patterns
- **[performance.md](./performance.md)** - Performance optimisation and scaling
- **[migration.md](./migration.md)** - Migrating from other crawling libraries

## Guide Structure

Each guide follows a consistent structure:
1. **Overview** - What you'll learn and prerequisites
2. **Step-by-step instructions** - Clear, actionable steps
3. **Working examples** - Complete, tested code examples
4. **Best practices** - Recommended approaches and patterns
5. **Troubleshooting** - Common issues and solutions

## Learning Path

### Beginner Path
1. [Getting Started](./getting-started.md) - Basic setup and first crawl
2. [Configuration](./configuration.md) - Understanding configuration options
3. [Error Handling](./error-handling.md) - Building robust crawlers

### Intermediate Path  
1. [Middleware Development](./middleware.md) - Extending functionality
2. [Testing](./testing.md) - Testing crawler applications
3. [Advanced Patterns](./advanced-patterns.md) - Complex use cases

### Advanced Path
1. [Performance Optimisation](./performance.md) - Scaling crawling operations
2. [Migration](./migration.md) - Integrating with existing systems
3. [Enterprise Patterns](../examples/enterprise-patterns.md) - Production systems

## Code Examples

All guides include working, tested examples:

```typescript
import { Spider, SpiderConfig } from '@jambudipa/spider'
import { Effect, pipe } from 'effect'

// Complete examples with error handling
const program = Effect.gen(function* () {
  const spider = yield* Spider
  // ... detailed implementation
})
```

*All code examples are tested and verified to work with the current version of Spider.*