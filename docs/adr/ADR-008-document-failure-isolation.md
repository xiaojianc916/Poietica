# ADR-008: Document failure isolation

- Status: Accepted
- Date: 2026-07-24
- Scope: Editor sessions and desktop workspace composition

## Context

A document-fatal impact existed in the application failure model, but recording
a document ID in a set did not isolate the failed React subtree.

Without a session-level boundary, an EditorCanvas render failure continued to
reach the root FatalErrorBoundary and replaced the entire application.

## Decision

Each EditorSession is wrapped in an independent EditorSessionBoundary inside
EditorSessionHost.

The editor package reports the session identity, Error and React component
stack. It does not classify the application impact.

The desktop composition root classifies the failure as document-fatal and
records the session in FailureRuntime.quarantinedDocuments.

A quarantined editor is replaced by DocumentQuarantineSurface. Other editor
sessions remain mounted and operational.

Document failure must not call reportFatalIncident.

Closing and reopening the document creates a new session boundary and is the
supported recovery path.

## Consequences

One corrupted or broken editor session cannot destroy the complete workspace.

Inactive sessions are also protected because every mounted session owns a
boundary.

Dismissal of a notice does not remove quarantine.

Application fatal remains reserved for failures outside an isolatable document
boundary.
