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

## Two recordings, because one only proves what it happened to contain

The first recording was a plain answer, and against it the tool call path is
indistinguishable from a path that does not exist. The second was recorded
against a prompt the agent cannot satisfy without reading a file: one hundred
and twenty-one frames, one tool call, nine updates to it.

Both are validated frame by frame, and the second also drives the reducer. Its
assertions are computed from the recording rather than copied out of one run's
output, so the tests say what the projection must preserve, not what a model
said on a particular morning.

A recording is evidence, so the formatter leaves it alone. Files named
`*.generated.ts` are exempt: reformatting one buries the frames that changed
under punctuation that did not, and a file whose header says not to edit it
should not be edited by a tool either.

Still missing is a turn in which the agent asks permission. Recording one needs
no auto-approval: leave it unanswered, let the watchdog cancel, and the log
keeps the request together with the cancellation.

## A sample agrees with you; a recording does not

The boundary read `tool_call.content` as an array of content blocks for as long
as nothing but the hand-written sample ever reached it. The sample was written
from the same misreading, so the schema and its test confirmed each other and
the mistake stayed invisible through every green run.

The first recorded tool call ended that immediately. Ten consecutive frames were
rejected with the same complaint — `Expected ("text" | "image" |
"resource_link" | "resource") but received "content"` — because the protocol
wraps tool output in a tagged envelope:

```json
{ "type": "content", "content": { "type": "text", "text": "…" } }
```

The envelope exists so that a diff and a live terminal can appear in the same
array as ordinary text. `diff` carries `path`, `newText`, and an `oldText`
that is absent or null when the file is new; `terminal` carries only a
`terminalId` whose output keeps streaming after the terminal is released. Both
are accepted at the boundary now, before any recording contains one, because the
frame a client has never seen is the frame most likely to break it.

The rule this leaves behind: a fixture written by hand may illustrate a shape,
but it may never be the reason to believe one. When a recorded frame and our
schema disagree, the schema is what changes.

## The question that was never answered

The third recording was made by asking the agent to write a file and then
letting nobody respond. After ninety seconds the watchdog cancelled the turn,
the agent resolved its own request, and the run finished:

```text
65 permission_requested
66 permission_resolved
67 run_finished
```

The outcome is `cancelled`, never `selected`. That single value is the
evidence behind a rule that is otherwise only an intention: nothing in this
client answers a permission request. Not a default, not a remembered choice, not
a convenience for tests. If an unattended recording ever resolves as
`selected`, some code began deciding on the user behalf, and the reducer test
turns red before the behaviour can reach anyone.

The unanswered case is also the common one. A person steps away, a laptop
sleeps, a window is closed. The recording proves the timeline survives it: the
run sits in `awaiting_permission` while the question is open, the tool call
that triggered it stays exactly at the status of its last update with no end
time invented for it, and the run ends as cancelled rather than as a failure.

Three recordings now cover the three shapes a turn can take — a plain answer, a
turn that used a tool, and a turn interrupted by a question. Each was captured
from a real agent, and each had to declare what it contained before it was
allowed to become a fixture.

## The feed renders events, not messages

The activity feed is one flat, ordered, virtualised column. Every entry in it
came from a frame the agent broadcast, and each kind of entry has one renderer
and no other: an answer, a thought chain, a tool call, a plan, a permission
request, an error. There is no chat bubble abstraction underneath, because a run
is not a conversation — it is a sequence of things that happened.

Three of those renderers make a judgement worth stating.

A user message is never rendered as markdown. Their text is theirs; letting it
choose its own presentation lets a pasted document reformat the transcript.

A thought chain is open while the agent is thinking and closed once it has moved
on. A click overrides that for good, so the default is derived and the override
is the only state. Nothing is synchronised in an effect, and nothing snaps shut
under a reader mid-sentence.

A tool call is collapsed unless it failed. A finished read is a fact; a failure
is a question, and the answer to it should already be on screen.

What a tool call has to show is decided in `tool-call-content.ts`, away from
React, and tested against the recorded turn. Content blocks other than text are
named rather than drawn. Inventing the shape of an image block is exactly the
mistake that cost a round already, and it will not be repeated on the basis of a
type definition nobody has seen a real frame satisfy.

## A conversation is not a run

The renderer keeps a transcript, and a run is a segment appended to it. Sending
never clears anything: the previous turn stays where it is, and the surface
derives its resting state from the transcript, so a second prompt cannot take
the interface back to an empty screen.

What the user said is committed locally, the instant they commit it. It does not
wait for a process, a protocol handshake or a log write, because none of those
is what makes it true. The recorded prompt frame still exists, and it is what a
replayed run shows the question with; when both are present they converge on one
entry. A failure can therefore take the answer away without taking the question
with it.

Sequence numbers restart at one for every run, so they identify a frame only
inside its own segment. Deduplication is scoped to the segment, and entry
identities are namespaced by it. That is not tidiness: an agent may reuse a tool
call id in a later turn, and without the namespace the second turn would silently
rewrite the first.

## The layout carries the composer, not a script

Opening the conversation is a real layout change. It is expressed as two resting
states in CSS: flexible spacers own the free space before the first turn and hand
it to the feed afterwards, and the intro blocks collapse through a grid row.
Nothing measures anything. A layout projection over a virtualised, contain:
strict scroller has to measure it mid-transition, which stutters and can leave a
transformed element behind entirely.

## The session has a root, and the process does not choose it

A session is created against a directory. Everything the agent reads, writes
and reports paths for is relative to it, so that directory is part of the
session contract rather than an incidental detail of how the app was started.

It is therefore resolved once, from the platform, when the runtime is built,
and stored. The current working directory of the process is not an answer: a
development run executes the binary inside `src-tauri`, so the agent would be
pointed at a build directory and would honestly report that it can find
nothing to work on. A caller that knows better may still pass a directory in;
the resolved root is only the fallback.

An environment variable would not do either, for the reason given above about
the agent command: it would work on the machine that defines it and fail
everywhere else.

## A migration must survive being run twice

Every step of the refactor script asks for a byte-exact match and would
otherwise stop. That is the right default — a step that cannot find what it
expected must never guess — but it made the script a one-shot, and a step
that has already landed then looks identical to a step whose premise was
wrong. Each step now also carries the mark of its own outcome, so the script
can tell "already done" from "cannot be done" and only stops for the second.

## A transcript can be present and invisible

The feed scroller declares `contain: strict`, which is what keeps a long run
from making the rest of the surface re-layout. That contract includes size
containment, so the element is sized as if it were empty, and an empty element
on a row flex line has a main size of zero.

The result was a conversation that existed in every respect except the visible
one: rows were built, keyed, measured and scrolled at zero width, and the only
thing that betrayed it was the composer correctly moving down, because the
resting state is derived from the transcript and the transcript was not empty.
It also meant a failure had no way to reach the screen — the error row was as
invisible as everything else.

A box that contains the transcript therefore states both axes: the inline axis
is the cross axis, where stretching is the default, and the child is told to
take the block axis.

## The editor is not choreographed

The composer grows with `field-sizing: content`. Pasting a paragraph makes the
box the size of the paragraph in the frame the text lands, and that is the
behaviour to keep: nothing is animated, so nothing can disagree about the
height.

It used to replay the previous box over the new one and counter-translate the
column by half the difference. The compensation was correct once, when the
column was centred with auto margins and a growing editor pushed the masthead
upwards. Spacers hold the column now, so the shove it cancelled no longer
happens and the cancellation was all that remained — a 240ms nudge of the
entire surface, on the same length the stylesheet was already resolving.

The general rule this leaves behind: motion compensates for a layout, so it
has to be deleted with that layout.

## A failure that only reaches the log did not happen

Every inbound frame is validated, and for a while a refused one was reported
to the observability port and dropped. That is correct about the frame and
wrong about the product: from the outside, a dropped frame and an agent that
never answered are the same picture, and the log is not part of the interface.

A client-side failure therefore enters the transcript as a `run_failed`, on
sequence zero — real frames are numbered from one, so it cannot collide with
one, and the reducer keeps the first refusal of a turn and discards the rest.
The log entry stays; it is now the detail behind something visible rather than
the only trace that anything went wrong.

## Waiting is a state

Between the moment a question is committed and the first frame of the answer
there is nothing in the timeline to draw. Drawing nothing there makes a busy
session and a swallowed message identical on screen.

The wait is derived — the run is open and the transcript ends on the question —
and it is rendered after the virtualised canvas rather than inside it. It is
not an event, so it is not an entry: it has nothing to be replayed from, it
cannot be persisted, and it disappears the moment a real frame arrives.

## A message is clipped, never scrolled

A pasted page arrives as one entry, and an entry taller than the viewport used
to leave the transcript showing nothing else. A scrolling box inside a
scrolling transcript is the wrong fix: it traps the wheel and hides where the
message ends.

So the bubble clips with a fade and offers to open. Whether to clip is decided
from the text rather than from the layout, which means the clamp and the
control that releases it are the same decision and cannot contradict each
other — a control over text that was never clipped is the same defect as
clipped text with no control.

## Motion compensates for a layout, and dies with it

The composer may animate its own growth, because the height it grows into is
still resolved by CSS and the animation commits nothing. What it may not do is
move anything else to make room: that compensation belonged to a centred
column, and it outlived it by a full round as a visible jolt.

The second rule is narrower and easier to get wrong: an observer must not
treat the effects of its own animation as new input. Feeding a replay back
into the measurement it started from is how a smooth growth becomes a shudder
in the opposite direction.

## One scroller, and it is the transcript

The assistant panel has exactly one scroll box. The frame around it does not
scroll, the composer does not travel with the content, and no entry is ever a
scroll box of its own.

Where the scrollbar lands is part of that contract. The transcript spans the
full width of the panel so its scrollbar sits against the edge, and the
reading measure is held by the padding inside it — padding is inside a scroll
box, the scrollbar is on its edge. While the frame carried the inset instead,
the scrollbar appeared inside the panel, and a message tall enough to fill the
transcript was indistinguishable from a message with a scrollbar of its own.

The measure therefore belongs to the parts: the masthead, the composer and the
starters each centre themselves to the same width and carry their own gutter.
The frame only frames.

## A turn can end without saying anything

Two endings produce no entry at all. An agent may finish its turn having sent
no content, and a refusal ends the run through `run_finished` rather than
through a failure, so nothing is appended in either case.

Rendered as an empty column, both are indistinguishable from a client that
lost the answer — which is exactly how a real defect stayed invisible for
several rounds. The end of a silent turn is therefore stated in words, next to
the status the reducer derived from the stop reason. That word is the evidence:
`completed` means the agent ended the turn saying nothing, `failed` means it
refused, `cancelled` means we stopped it. None of them may look like a blank
screen.

## The agent's own words replace ours

An agent can fail without failing the turn. Kimi answers a rejected provider
request by printing its own error and ending the turn with an ordinary stop
reason, so the protocol carries a perfectly successful run that produced
nothing. A client that only reads the protocol has nothing to show but a
sentence it wrote itself, and that sentence explains nothing.

So the client listens to the stream the agent talks on. The SDK exposes the
process error stream through its own observer, and a bounded tail of it is
attached to the end of the turn: always to a failure, and to a finished turn
only when the protocol carried no update at all.

Where that account exists, it is the whole entry. Our own wording is a
description of a silence — it exists so that an unexplained turn is still
visible — and next to a real explanation it is not context, it is noise. So it
is not appended, and it is not ranked below: it is not written.

The text is not sanitised on the way in, because it is not an application
error. It travels as a frame, which is content, rather than as a command
failure, which is a category. The public error table stays exactly as strict
as it was: it exists to stop our internals reaching the webview, not to
silence the agent.

## A window offers a list, never a command line

The model is not a protocol matter. The ACP surface we pin carries sessions,
prompts, permissions and MCP servers, and says nothing about which weights
answer, so there is no request that could switch a model on a live session.

The command a terminal accepts is not a substitute for one. Sent through a
prompt it is a sentence addressed to the agent, and the agent answered exactly
as it should: it knows no such command. Treating a terminal affordance as an
interface affordance was a category error, and it is recorded here so it is
not repeated.

What remains is the truth the agent actually consults: its own configuration,
read when it starts. So the list is read from that file, a choice is written
back to it, and the session is rebuilt so the agent reads it again. The
transcript is untouched by that, because a conversation is not a session, and
the only thing that changes on screen is which entry the control names.

Nothing about the choice is remembered by this interface. The file is the
record; anything cached here would be a second copy of the truth, free to go
stale the moment the person edits their config by hand.

A provider mark is a file in the assets folder and nothing more. An
unrecognised provider resolves to a neutral mark rather than to nothing,
because a control that renders nothing and a control that failed to load look
identical to the person using it. And with no list at all there is no control:
an empty picker is a promise the surface cannot keep.

## The model list is the file the agent reads

The models offered in the composer are not a list this program maintains.
Kimi Code keeps them in `~/.kimi-code/config.toml`, under `default_model`
and `[models.*]`, and that file is read every time the list is asked for. A
copy on this side would disagree with the agent the first time the user
edited the file by hand, and the disagreement would surface as a model that
cannot start.

Choosing a model edits that file rather than replacing it. The document is
parsed with `toml_edit`, one value is written, and comments, ordering, keys
we do not understand and the provider credentials all survive unchanged. The
replacement is written to a temporary file, flushed, and moved into place by
a rename, with a copy of the original kept beside it: a half-written
configuration file would stop the agent from starting at all, which is worse
than a switch that failed.

A name the file does not contain is refused before anything is written. The
alternative is a configuration that names a model the agent cannot start,
discovered on the next prompt instead of at the moment of the mistake.

A model is decided when a session is created, not per turn, so selecting one
ends the running session and lets the next prompt open a new one. Nothing is
sent to the agent to announce the change, because there is nothing in
protocol v1 to send it with.

## The account is not the kind

The real configuration file names an account, and the account names a kind:

```toml
default_model = "moonshot-cn/kimi-k2.6"

[providers.moonshot-cn]
type = "kimi"

[models."moonshot-cn/kimi-k2.6"]
provider = "moonshot-cn"
model = "kimi-k2.6"
```

Three readings follow, and each one was wrong in the first version. The
identifier is the section key, quoted because it holds a slash and a dot, and
it is the only thing `default_model` may be set to. The readable name is the
`model` value inside the section, not the key. And the mark to draw comes from
`[providers.<account>].type`: an account named `moonshot-cn` is a provider of
type `kimi`, so reading `provider` as if it were the kind sends every model to
the fallback icon. The account name is used only when the provider section is
missing, because a broken file should still show something recognisable.

Everything else in that file belongs to the agent: `capabilities`,
`support_efforts`, `max_context_size`, `[thinking]`, `[loop_control]`, the
comments, and the key. None of it is read here, because nothing displays it
yet, and none of it may be disturbed, which is what the switch test asserts
line by line.

## A list that is read is not a list that is shown

The previous round made the file readable and writable and stopped there, so
the picker stayed empty and the control stayed invisible -- the control returns
nothing when it has no list, on purpose. Reaching the screen took the rest of
the line: a port in the feature, a bridge on the desktop side that turns the
wire null into an absent key, a hook that holds the answer, and one line in the
composition root. A capability nobody can see has not been delivered.

## The terminal and the protocol are two modes

Kimi Code CLI is one program with two entry points, and they do not accept
the same input. The terminal interface accepts fifty-one slash commands and
draws its own model picker; `kimi acp` prints no banner, waits for an
`initialize` request on stdin and speaks JSON-RPC until it is shut down. The
agent said so itself when it answered `Unknown ACP command: /model`, and the
official reference says the same thing from the other side: the model is
switched with `/model` *in shell mode*.

Two consequences shape this client.

A model is chosen by writing `default_model` in the file the agent reads and
starting the next session against it. That is the interface the agent
publishes for this, so the window offers a list and the file records the
choice. Sending `/model` down the protocol would be sending a message, not
issuing a command, which is exactly the mistake that produced an unknown
command in the transcript.

Every other command comes from the agent, not from us. The command set
arrives as an `available_commands_update` session update and is already
recorded in the log, so the composer can offer a `/` menu built from what
this particular agent advertises, and the chosen line is sent as ordinary
prompt text for the agent to parse. Nothing here is a command surface of our
own invention, and an agent that advertises nothing gets no menu.

## Slash commands are a list the agent publishes

Slash commands do exist in ACP mode. The agent publishes them: after the
handshake it sends a `session/update` notification carrying an available
commands update, and Kimi ships a fix whose stated purpose is to defer that
update so the client "reliably receives and displays available slash
commands". A client therefore does two things and nothing else:

1. render the list the agent published, and
2. send the chosen command as ordinary prompt text, which the agent parses.

That is also why the earlier failure was a category error rather than a bug.
Sending `/model` was wrong twice over: the text was sent as a message from a
window that had no business speaking terminal, and the command was not in the
published list, which is exactly what the agent answered — `Unknown ACP
command: /model. Use /help to see available commands.` It parses slash
commands; its ACP set is simply not the terminal set.

Three sets must never be confused:

- the TUI set, typed into the input box, which is the largest;
- the shell-mode subset the docs enumerate (`/help`, `/exit`, `/version`,
  `/editor`, `/theme`, `/changelog`, `/feedback`, `/export`, `/import`,
  `/task`);
- the ACP set, which is whatever arrives in the published update.

Only the third one may drive our menus. Neither the documentation nor the
terminal is evidence about it, so every switch and every completion entry we
offer is built from recorded frames of that notification.

## No modes are published, so no switch can be honest

The protocol does model modes. A client shows the agent's `availableModes`,
switches with `session/set_mode` at any time, idle or mid-turn, and learns of
changes from the agent through `current_mode_update`. That is the honest way
to offer plan mode: no message, no turn, no text in the composer.

This agent publishes none. A search of the whole tree, recordings included,
finds no `availableModes` anywhere, and nothing in our own code has ever
called `set_mode`. An agent that announces no modes leaves a client nothing
to switch, so a mode switch drawn today would be a control wired to nothing.
It is therefore not on the plan, and it must appear only when the data does.

### The eighteen commands that do exist

Recorded identically in all three captured turns:

- session: `compact` (with the input hint
  `<optional custom summarization instructions>`), `status`, `usage`, `mcp`,
  `tasks`, `help`;
- skills and prompts: `check-kimi-code-docs`, `custom-theme`,
  `import-from-cc-codex`, `mcp-config`, `sub-skill`, `sub-skill.consolidate`,
  `sub-skill.review`, `update-config`, `write-goal`, `skill:emil-design-eng`,
  `skill:find-skills`, `skill:transitions-dev`.

Absent: `goal`, `plan`, `yolo`, `permission`, `model`. Sending any of them
earns the same answer `/model` earned. The sharpest evidence is `write-goal`,
whose own description offers to help "craft a well-specified `/goal`
objective for goal mode": the mode exists in the product, and the protocol
surface exposes only a skill for writing its input, never a way to enter it.

### A command is text on the wire and a chip on the screen

The protocol requires the text: commands "are run as part of regular prompt
requests where the Client includes the command text in the prompt". That
binds the wire, not the window. So the command is lifted out of the editor
and kept as state: a chip inside the composer, beside the tools rather than
inside the sentence, carrying a mark, a readable name and a way to remove it.
The editor stays a plain textarea, which is what keeps growth, selection and
IME behaviour simple; a rich contenteditable would buy commands in the middle
of a sentence at the price of owning all three.

Commands that declare `input.hint` take an argument, so the chip is followed
by a field whose placeholder is the hint the agent supplied, verbatim.

Every entry, name, hint and grouping comes from the published list. Nothing
in the menu is ours to invent, and an empty list means an empty menu, not a
remembered one.
