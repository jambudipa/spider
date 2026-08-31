# Worker health

This folder records crawl worker activity and reports workers that stop making progress. The monitor keeps this state separate from the spider configuration.

Start with `WorkerHealthMonitor.service.ts`. Use `WorkerHealthMonitor.WithThreshold` when an application needs a different inactivity threshold.

Call `recordActivity` when a worker starts or advances a fetch. Call `removeWorker` when the worker ends. Do not store crawl scheduling policy here.
