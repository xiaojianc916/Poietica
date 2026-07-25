# The ACP client

The client talks to a locally spawned agent process. The process is the
transport: the protocol runs as JSON-RPC over its standard input and output, so
there is no socket, no port, and no second protocol of our own invention.

## Ordering

Every session update is appended to the encrypted log, then applied to the
projections, then forwarded. Nothing observes an event that a restart would
make disappear.

## Failures are not protocol errors

A handler that cannot write to the store does not answer the agent with a
JSON-RPC error. Our storage failing is not the agent's fault, and telling it
otherwise invites it to react to a fault it cannot fix. The failure is kept on
the recorder and raised by the driver once the turn ends, so the turn only
counts as successful if everything about it was durable.

## Permissions default to refusal

Until a surface exists for asking the user, permission requests are refused
automatically, using one of the agent's own refusal options so that a refusal
is distinguishable from an abandoned turn. Both the request and the answer are
written to the log.

## What the projections deliberately ignore

The update enum grows with the protocol and its variants are not exhaustive.
Unrecognised updates and unrecognised tool states are logged verbatim but left
out of the projections rather than guessed at. Since the projections are
rebuildable from the log, a later version can backfill them.

## The frame is the interface contract

The recorder does not invent a shape of its own. Every frame it writes is
exactly the shape declared in `features/ai/src/contracts/run-contract.ts` and
validated by `features/ai/src/domain/acp-event-schema.ts`, and the same value
is what goes into the log. Replaying a stored run and watching a live one
therefore cannot drift apart, and there is no translation layer to keep in sync.

Three consequences worth stating.

The stop reason is taken from serialising the protocol type, never from a
hand-written mapping. The wire form is the contract; a mapping would be a second
source of truth that silently rots.

Null members are stripped from serialised protocol payloads, because the
boundary validator accepts an absent optional field but not a null one.

The interface requires a permission title that the protocol leaves optional. It
is resolved from the request, then from the projected tool call, and only then
from the identifier. A refusal that selects the agent's own refusal option is
reported as a selection; only an unanswered turn is a cancellation.
