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


## A permission request is a question

The handler cannot answer a permission request itself: the person who can is on
the other side of an IPC boundary and will not reply for several seconds, if at
all. So the handler records the request, registers it at the desk, and waits.
The answer arrives later on `agent_resolve_permission`, and only then is the
resolution recorded and the reply sent.

The desk validates before it acts. An answer naming a request that is not
outstanding, or an option the agent never offered, is refused, and refusing
happens before the request is taken off the desk so a bad answer cannot destroy
a good one. Which options mean approval is read from the kinds the agent itself
attached to them, and a kind this build does not recognise counts as a refusal.

Two paths still answer without asking. A request that arrives outside a turn
has nowhere to be recorded and nobody to ask, and a desk that has been poisoned
by a panic cannot be waited on. Both refuse using the agent's own refusal
option, which the agent can tell apart from an abandoned turn.

When a turn ends, the desk is cleared before the recorder is taken back. Each
waiting handler observes the dropped answer and replies with the protocol's
cancellation, and the run's own recorder settles whatever requests were still
open, so the log never keeps a request that nobody can ever answer.

## Proving it against a real agent

The offline tests cover recording, projection and the permission desk, and none
of them start a process. The handshake, the session, the notification stream and
cancellation are only proven by `tests/live_turn.rs`, which is ignored by
default because it spawns an agent and spends tokens:

```text
cargo test -p poietica-ai-acp-native --test live_turn -- --ignored --nocapture
```

Its configuration lives in the environment, not in the repository:
`POIETICA_ACP_COMMAND`, `POIETICA_ACP_PROMPT`, `POIETICA_ACP_CWD` and
`POIETICA_ACP_TIMEOUT`.

What it asserts is the one invariant that cannot be checked without a real
agent: the frames read back out of the reopened database are the same frames, in
the same order, that were broadcast while the turn was live. If forwarding ever
overtook writing, that comparison is where it would show.

Nobody answers a permission request during this test, so a request would block
the turn indefinitely. The watchdog cancels instead of hanging, which also
exercises the path where the desk is cleared and the handlers reply with the
protocol's cancellation.

### When the live turn fails immediately

A connection that dies takes every channel with it, so the first symptom is
always a cancelled wait rather than a description of the fault. The test asks
the driver thread for its own error before reporting anything, which is what
turns that silence into a sentence.

The usual cause is that the command cannot be executed as written. A launcher
installed as a script has to be named in full on Windows, and the client spawns
a program rather than a shell, so `POIETICA_ACP_COMMAND` is the place to say
so. The command line is never guessed at or rewritten for the caller: a client
that quietly runs something other than what it was told to run is worse than one
that fails.

## The protocol version is pinned exactly

`agent-client-protocol` is required as `=1.3.0` rather than by a caret.

The reason is not caution in general, it is a specific failure that already
happened here. The manifest asked for `1.2.0`, the lock file resolved
`1.3.0`, and that version omits a tool call's status on the wire when the
status holds the protocol's default. The frames the interface validates changed
underneath a version requirement that claimed nothing had changed, and the only
reason it was caught is that a test asserted the field.

This dependency is not a library the client merely calls; it decides the bytes
that cross the boundary and the shape of every frame the renderer will ever see.
A change in it is a change in the contract, so it is made deliberately, with the
frame tests run against the new version, rather than picked up by a resolver.

## The recording is the only honest test input

The native side writes frames and the renderer validates them, and until a real
turn was recorded both sides were only ever tested against frames their own
authors had written. Two schemas that agree with themselves can still disagree
with each other, which is a failure that shows up as an empty timeline.

Setting `POIETICA_ACP_CAPTURE` during the live turn writes the turn out
verbatim, and `acp-event-schema.live.test.ts` feeds that recording to the
validator the renderer actually uses. The fixture is committed unedited; if a
frame in it needs adjusting to pass, the schema is wrong, not the recording.

The same test prints the set of `sessionUpdate` kinds the agent sent. That set
is the inventory the timeline has to cover, and it comes from the agent rather
than from the specification, which lists many more.

### What the recording caught

The first recorded turn was rejected at the boundary on its second frame. The
agent opens every session by announcing its slash commands with
`available_commands_update`, which is part of the protocol and was missing from
the validator's union. Nothing else in the repository would have noticed: the
native side records whatever the agent sends, and the renderer drops whatever it
cannot validate, so the failure mode was a frame quietly disappearing between
two components that each considered themselves correct.

The list is accepted and then deliberately ignored by the reducer. It describes
what the session can do, not what happened during it, so it belongs to whatever
offers those commands rather than to the transcript. Writing that case out
explicitly keeps the silence intentional.

## The surface is deliberately empty

The feature package ships contracts, a reducer, adapters and a recorded turn,
and no components at all. The components that used to live here were vendored
from a component set this project does not depend on; they compiled against
libraries that have since been replaced, imported icons from a library that was
dropped, and referenced image assets that were never committed. Nothing in the
repository imported them, and the one thing that did was importing a type: the
session hook took its notion of a run's status from a text input component.

They were deleted rather than repaired. The timeline they were meant to render
now has something they never had: a recording of what a real agent actually
sends. The inventory from the first recordings is lopsided in a way no
hand-written mock would have suggested. A turn is overwhelmingly thought chunks,
with a single message chunk at the end and a capability announcement at the
start, so a reasoning surface is the main view rather than an accessory tucked
behind a disclosure.

The components come back when they are written against that recording, on this
project's own dependencies.

## Model choice belongs to the agent

The client does not choose a model. It spawns an agent, opens a session and
sends prompts; which model answers is settled on the other side of the
connection, by the agent's own configuration. A model picker in this process
would be a control wired to nothing, and a list of provider names baked into the
client would go stale the first time that configuration changed.

So the picker was removed along with the hardcoded catalogue behind it and the
provider artwork it referenced, none of which had ever been committed. What the
agent genuinely advertises is different and better: an available_commands_update
arrives as the first session update of every connection, listing the commands
this particular agent supports. That is the real thing to put in front of a
user, and it is already in the recorded turn.

ChatStatus moved to the contracts folder in the same pass. The hook that derives
it may not import the button that renders it: presentation and application both
depend on contracts, and never on each other.

## The port is composed in the application, and nowhere else

The feature package declares an agent session port. The platform package
implements the two halves it needs — a command bridge over typed IPC and an
event source over the run-frame channel. Neither package imports the other. The
application is the single place they are joined, in one small factory, which is
why swapping the desktop transport for a different one is a change to one file
in the app rather than to the feature.

The join needs no adapter. The desktop bridge accepts a narrower prompt request
than the port declares, and that is the direction assignability already allows,
so a translation layer would only be one more thing to drift.

### What is composed but not yet answerable

A run can enter awaiting_permission. The port can resolve a permission. There is
no UI between them, so a real agent asking to use a tool will stop and wait until
it times out. Nothing here auto-approves: deciding what an agent may do without
being asked is a security decision, not a wiring detail, and it is the next thing
this surface needs.

The thread on a prompt request is also still ignored natively — one session, one
turn at a time — so the client sends a named placeholder rather than pretending
to route.

## The assistant has one seat, and the rail owns it

The workspace shell offers surfaces through the activity rail, and `ai` has
been one of them since before this client existed. A second mount point behind
a shortcut looked convenient and was a mistake: two seats mean two lifetimes,
two scroll positions, and two answers to "where did my run go".

Ctrl+J therefore opens the workspace surface rather than a floating panel. The
shortcut is a way to reach the seat, not a seat of its own.

The renderer is a factory, not a constant. `features/workspace` declares the
slot, `features/ai` declares the port, and neither imports the other; the
application root is the only module that has both, so it is the only module
that can join them. A module-level constant could not do this, because the
session port does not exist until the runtime boots.

## Answering is a decision, never a default

Nothing auto-approves. An agent asking to write a file or run a command is
asking the person, and a client that answers on their behalf has removed the
only control the protocol offers.

The question is rendered inline in the activity feed, in the position where the
run stopped. A dialog would be easier to build and worse to use: it can be
dismissed by accident, it hides the tool call that prompted it, and it has no
place in a transcript that must replay.

The click is not the answer. It is sent to the port, and the run moves only
when `permission_resolved` arrives through the event log. A live run and a
replayed one therefore pass through exactly the same states. If the call is
rejected the agent never heard the answer, so the run is marked failed rather
than left waiting for something that will not come.

## A recording only proves what it contains

The first recording caught a plain answer: text and nothing else. Tested
against it, the schema and the timeline look proven, while the tool call path
and the permission path have never seen a byte a real agent produced.

A turn is therefore asked to declare its content. `POIETICA_ACP_EXPECT` names
the frame kinds and session update discriminators the run must contain, and it
is checked before the capture is written, so a turn the agent answered from
memory cannot quietly replace a recording that caught the real thing.

Capturing a permission request needs no auto-approval. Nobody answers, the
watchdog cancels, and every outstanding request is settled as cancelled in the
log, which yields real `permission_requested` and `permission_resolved` frames
while leaving the rule that nothing approves on the user's behalf intact.
