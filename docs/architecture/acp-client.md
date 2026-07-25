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

## A session outlives a turn

The agent process is started once and the session is created once. Prompts,
cancellation and shutdown arrive afterwards as commands on a channel, which
is what makes the conversation multi-turn: the agent keeps its context
between turns because the connection was never torn down.

That creates two different lifetimes. The protocol handlers are installed on
the connection and live as long as it does. A recorder exists only for the
run it records, and there are many runs per session. They meet through a
slot: a turn installs its recorder, the handlers write to whatever is
installed, and the turn takes it back to close the run out. An update that
arrives between turns is dropped rather than attributed to the run that
happened to come before it, and a second prompt sent during a turn is
refused rather than interleaved onto the same log.

Cancellation uses the SDK's own mechanism instead of a message of our own:
dropping the in-flight request handle makes the SDK send the protocol-level
cancellation notification. Cancellation is cooperative, so the agent may
still finish normally; the turn's answer reports which of the two happened.
A cancelled turn is recorded as an ordinary end of turn carrying the
protocol's cancelled stop reason, because that is what the interface
validates, while the run row is marked cancelled, because that is what
happened.

The crate spawns nothing itself. Connecting hands back a future and the
composition root decides which executor runs it, which is why no async
runtime appears in this crate's dependencies.

## The renderer sees only durable frames

The desktop seam lives in `commands/agent.rs`. It owns one `AgentRuntime`:
the database path, the run slot, and the session, if one has been started.

The session starts lazily. Spawning an agent process at launch would charge
every start-up for a feature the user may never open, so the process appears on
the first prompt and is then reused for every turn after it. Two prompts can
race to be the first; the one that loses hands its process back instead of
leaving an orphan behind.

`agent_prompt` returns as soon as the turn is under way, carrying the run and
session identifiers. It does not wait for the agent to stop. Frames reach the
interface on the `ai-run-event` channel, emitted from the recorder's sink,
which runs only after the frame has been written to the encrypted log. A frame
that the renderer misses is therefore never lost: `agent_load_run` reads the
same values back out of the log, in the same order.

Agent failures fold into the existing error variants. No variant was added for
the agent, because the public message table is an exhaustive match whose whole
job is to keep native detail away from the webview, and every new arm there is
a new opportunity to leak one.

Permission answers are not here yet. The handler still refuses automatically,
so there is nowhere for a user's decision to go; the command arrives together
with the handler that can wait for it.
