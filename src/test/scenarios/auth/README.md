# Authentication scenarios

This folder tests authenticated crawl flows such as cookie-based login. It
contains website-specific setup that must not leak into unit tests.

Keep credentials and session handling within the scenario fixture boundary.
