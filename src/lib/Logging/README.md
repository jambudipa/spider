# Spider event logging

This folder defines the structured lifecycle events that a spider emits and the service that consumes them. Start with `SpiderEventSink.ts` when you add an observer or a new event.

Use these events for crawl progress and domain outcomes. Do not use them for diagnostic log lines. Effect's `Logger` handles diagnostic output, while an application layer provides the event sink.

The default sink discards events. A custom sink must preserve the event tag so consumers can handle every event type exhaustively.
