# Redis Recovery Bundle

This bundle configures Redis durability for Attestor BullMQ and shared runtime state.

The reference config enables:

- AOF persistence (`appendonly yes`)
- `appendfsync everysec` for a practical durability/latency balance
- RDB snapshots as an additional checkpoint layer

## BullMQ recovery expectation

With Redis persistence enabled, queued BullMQ jobs and tenant execution/rate-limit state survive Redis restarts according to Redis durability guarantees.

Boundary:

- in-flight jobs can be retried or re-marked stalled by BullMQ after process loss
- this is not exactly-once processing
- the in-process fallback path still has no durable recovery
