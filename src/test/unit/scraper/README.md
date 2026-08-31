# Scraper unit tests

This folder tests low-level scraping, HTTP adapter, and link extraction
behavior with controlled inputs.

Keep adapter failure cases explicit. A test must state whether a failure is a
transport failure or a parsed HTTP response.
