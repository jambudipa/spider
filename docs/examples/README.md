# Spider Examples

This directory contains comprehensive, working examples demonstrating Spider's capabilities in real-world scenarios.

## Example Categories

### Basic Usage
- **[basic-crawling.md](./basic-crawling.md)** - Simple crawling scenarios and patterns
  - Single page extraction
  - Multi-page crawling with depth limits
  - URL filtering and domain restrictions
  - Basic data extraction

### Industry Applications
- **[e-commerce-scraping.md](./e-commerce-scraping.md)** - Product data extraction patterns
  - Product catalogue crawling
  - Price monitoring systems
  - Inventory tracking
  - Review and rating extraction

- **[news-aggregation.md](./news-aggregation.md)** - News site crawling strategies
  - Article discovery and extraction
  - RSS feed integration
  - Content classification
  - Real-time news monitoring

### Enterprise Patterns
- **[enterprise-patterns.md](./enterprise-patterns.md)** - Large-scale crawling solutions
  - High-throughput crawling architectures
  - Distributed crawling with multiple instances
  - Data pipeline integration
  - Monitoring and alerting systems

## Example Structure

Each example includes:

### Complete Working Code
```typescript
import { SpiderService, makeSpiderConfig, Effect } from '@jambudipa/spider'

// Full implementation with proper error handling
const program = Effect.gen(function* () {
  // Complete example code
})
```

### Configuration Examples
```typescript
// Real-world configuration patterns
const config = makeSpiderConfig({
  // Detailed configuration for specific use cases
})
```

### Error Handling
```typescript
// Robust error handling patterns
const program = pipe(
  crawlOperation,
  Effect.catchAll(error => handleSpecificError(error)),
  Effect.retry(retryPolicy)
)
```

### Performance Considerations
- Memory usage patterns
- Concurrency optimisation
- Rate limiting strategies
- Resource management

## Running Examples

### Prerequisites
```bash
npm install @jambudipa/spider effect
```

### Basic Example
```typescript
// Copy and run any example
import { exampleFunction } from './basic-crawling.md'
await Effect.runPromise(exampleFunction())
```

### Testing Examples
All examples include:
- Unit tests for individual components
- Integration tests for complete workflows  
- Performance benchmarks where relevant
- Error scenario testing

## Real-World Integration

### Framework Integration
Examples showing integration with:
- **Express.js**: Web API endpoints for crawling
- **Next.js**: Server-side crawling in React applications
- **NestJS**: Enterprise-grade crawling services
- **Fastify**: High-performance crawling APIs

### Database Integration
Patterns for storing crawled data:
- **PostgreSQL**: Relational data storage
- **MongoDB**: Document-based storage
- **Elasticsearch**: Search-optimised storage
- **Redis**: Caching and session management

### Deployment Examples
Production deployment patterns:
- **Docker**: Containerised crawling services
- **Kubernetes**: Scalable crawling clusters
- **AWS Lambda**: Serverless crawling functions
- **Google Cloud**: Managed crawling services

## Performance Benchmarks

### Throughput Examples
- Single-threaded vs concurrent performance
- Memory usage across different scales
- Network utilisation patterns
- CPU usage characteristics

### Scaling Patterns
- Horizontal scaling with multiple instances
- Vertical scaling with resource optimisation
- Auto-scaling based on queue depth
- Load balancing strategies

## Use Case Index

### By Industry
- **E-commerce**: Product monitoring, price comparison
- **Media**: News aggregation, content discovery
- **Research**: Academic paper collection, data mining
- **SEO**: Site analysis, competitor monitoring
- **Security**: Vulnerability scanning, compliance checking

### By Scale
- **Small Scale**: < 1000 pages, single domain
- **Medium Scale**: < 100k pages, multiple domains
- **Large Scale**: > 1M pages, enterprise requirements
- **Real-time**: Continuous monitoring and updates

### By Complexity
- **Basic**: Simple page extraction
- **Intermediate**: Multi-step workflows with data processing
- **Advanced**: Complex business logic and integrations
- **Expert**: High-performance, fault-tolerant systems

*All examples are tested and maintained to work with the current version of Spider.*