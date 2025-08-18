# User Guides

Step-by-step guides for using Spider effectively.

## Getting Started

### [Getting Started Guide](./getting-started.md)
Complete introduction to Spider:
- Installation and setup
- Your first crawler
- Basic configuration
- Processing results

### [Configuration Guide](./configuration.md)
Comprehensive configuration reference:
- All configuration options
- Common patterns
- Environment-based config
- Best practices

## Core Features

### [Browser Automation](./browser-automation.md)
Handle JavaScript-rendered content:
- Playwright integration
- Dynamic content handling
- Form interaction
- Resource optimisation

### [Anti-Bot Protection](./anti-bot.md)
**Note: Spider doesn't have a dedicated anti-bot service.** This guide explains how to configure Spider's existing components to avoid detection:
- Configuration strategies
- Browser automation for challenges
- Session management
- Real-world scenarios

### [Security Handling](./security.md)
Authentication and protected content:
- Login flows
- Cookie management
- Token extraction
- Session persistence

### [Performance Optimisation](./performance.md)
Scale your crawling operations:
- Concurrency tuning
- Memory management
- Caching strategies
- Monitoring and profiling

## Guide Structure

Each guide follows a consistent format:
1. **Overview** - What the guide covers
2. **Concepts** - Key ideas and terminology
3. **Examples** - Working code samples
4. **Patterns** - Common use cases
5. **Best Practices** - Recommendations
6. **Troubleshooting** - Common issues and solutions

## Quick Navigation

### By Experience Level

**Beginner**
- [Getting Started](./getting-started.md)
- [Configuration](./configuration.md)

**Intermediate**
- [Browser Automation](./browser-automation.md)
- [Security Handling](./security.md)

**Advanced**
- [Anti-Bot Protection](./anti-bot.md)
- [Performance Optimisation](./performance.md)

### By Use Case

**"I need to crawl JavaScript sites"**
→ [Browser Automation](./browser-automation.md)

**"I'm getting blocked"**
→ [Anti-Bot Protection](./anti-bot.md)

**"I need to log in first"**
→ [Security Handling](./security.md)

**"My crawler is too slow"**
→ [Performance Optimisation](./performance.md)

**"I want to customise behaviour"**
→ [Configuration Guide](./configuration.md)

## Contributing

Have suggestions for improving these guides? Please:
1. Open an issue describing the improvement
2. Submit a pull request with your changes
3. Ensure examples are tested and working

## Next Steps

After reading the guides:
- Explore [API Reference](../api/) for detailed documentation
- Check [Examples](../examples/) for complete code samples
- Review [Enterprise Patterns](../examples/enterprise-patterns.md) for production use