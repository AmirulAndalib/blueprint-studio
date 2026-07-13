# Backend Troubleshooting

## Initial Checks

Confirm the Blueprint Studio config entry is loaded, then download its
diagnostics from Home Assistant. `runtime.ready` should be true. Nonzero active
operation or transfer counts are expected only while work is running. A route
returning HTTP 503 means the entry is unloading, reloading, or unavailable.

Each HTTP response includes `X-Correlation-ID`. Temporarily enable debug logging
for `custom_components.blueprint_studio.backend.operation_tracker` and match
that ID to the structured operation line. Restore the logger to `info` after
diagnosis. Diagnostics and normal logs intentionally omit paths and secrets.

## Transfers

There is no application file-size limit. Failures can still come from reverse
proxy limits, disk capacity, filesystem permissions or quotas, SFTP capacity,
connection loss, or inactivity timeouts. A failed local upload leaves the final
destination unchanged and removes its temporary file. For SFTP, verify remote
rename support and free capacity. Progress entries are retained for five
minutes and registries are capped at 128 entries.

## Reload And Shutdown

Active terminals and transfers are runtime resources and close during reload;
saved tabs, unsaved buffers, navigation state, settings, and hosts are persisted
workspace state. If setup fails after an upgrade, preserve the `.storage` file,
review the migration error, and do not manually rewrite its version wrapper.

For a support report, include the integration and Home Assistant versions,
redacted diagnostics, the correlation ID, the HTTP status, and the smallest
reproduction. Never include access tokens, passwords, private keys, or config
file contents.
