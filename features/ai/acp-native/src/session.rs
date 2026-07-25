use std::path::PathBuf;
use std::str::FromStr;
use std::sync::{Arc, Mutex};

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    ContentBlock, InitializeRequest, NewSessionRequest, PromptRequest, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, SelectedPermissionOutcome,
    SessionNotification, TextContent,
};
use agent_client_protocol::{AcpAgent, Agent, ConnectionTo};
use serde_json::Value;

use crate::error::{AcpError, Result};
use crate::permission::{decide, Decision};
use crate::recorder::Recorder;

/// Spawns an agent, runs one prompt against it, and records the whole turn.
///
/// `command` is a shell-style command line, for example `kimi acp`. The
/// process is the transport: the protocol speaks JSON-RPC over its standard
/// input and output, which is why nothing here opens a socket or a port.
///
/// The returned string is the stop reason the agent reported, in its wire form.
///
/// # Errors
///
/// Fails when the process cannot be started, when the connection fails, when
/// the stop reason cannot be read, or when a durable write failed during the
/// turn.
pub async fn run_prompt(
    command: &str,
    cwd: PathBuf,
    prompt: String,
    recorder: Arc<Mutex<Recorder>>,
) -> Result<String> {
    let agent = AcpAgent::from_str(command).map_err(|error| AcpError::Spawn {
        message: error.to_string(),
    })?;

    let starting = Arc::clone(&recorder);
    let updates = Arc::clone(&recorder);
    let permissions = Arc::clone(&recorder);
    let stop_reason: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let reported = Arc::clone(&stop_reason);

    let connected = agent_client_protocol::Client
        .builder()
        .name("poietica")
        .on_receive_notification(
            async move |notification: SessionNotification, _cx| {
                // A poisoned lock means another task panicked. There is nothing
                // useful to tell the agent about that, and the driver reports it
                // once the turn is over.
                if let Ok(mut recorder) = updates.lock() {
                    recorder.record_session_update(&notification);
                }

                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _connection| {
                let decision = decide(&request);

                if let Ok(mut recorder) = permissions.lock() {
                    recorder.record_permission(&request, &decision);
                }

                match decision {
                    Decision::Reject(option_id) => {
                        responder.respond(RequestPermissionResponse::new(
                            RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                                option_id,
                            )),
                        ))
                    }
                    Decision::Cancel => responder.respond(RequestPermissionResponse::new(
                        RequestPermissionOutcome::Cancelled,
                    )),
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(agent, |connection: ConnectionTo<Agent>| async move {
            connection
                .send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;

            let session = connection
                .send_request(NewSessionRequest::new(cwd))
                .block_task()
                .await?;

            // The first frame of a run carries the session id, so it can only
            // be written once the session exists.
            if let Ok(mut recorder) = starting.lock() {
                recorder.record_run_started(&session.session_id.to_string());
            }

            let response = connection
                .send_request(PromptRequest::new(
                    session.session_id.clone(),
                    vec![ContentBlock::Text(TextContent::new(prompt))],
                ))
                .block_task()
                .await?;

            // The wire form is the contract, so the stop reason is taken from
            // serialisation rather than from a hand-written mapping.
            let wire = match serde_json::to_value(&response.stop_reason) {
                Ok(Value::String(reason)) => Some(reason),
                _ => None,
            };

            if let Ok(mut slot) = reported.lock() {
                *slot = wire;
            }

            Ok(())
        })
        .await;

    if let Err(error) = connected {
        let message = error.to_string();
        with_recorder(&recorder, |recorder| recorder.record_run_failed(&message))?;

        return Err(AcpError::Protocol { message });
    }

    let reason = stop_reason
        .lock()
        .map_err(|_poisoned| AcpError::RecorderPoisoned)?
        .clone();

    let Some(reason) = reason else {
        let message = "the agent reported a stop reason the client could not read".to_owned();
        with_recorder(&recorder, |recorder| recorder.record_run_failed(&message))?;

        return Err(AcpError::Protocol { message });
    };

    with_recorder(&recorder, |recorder| recorder.record_run_finished(&reason))?;

    // A write that failed mid-turn could not be reported at the time, so the
    // turn only counts as successful once the recorder confirms it.
    if let Some(failure) = with_value(&recorder, Recorder::take_failure)? {
        return Err(failure);
    }

    Ok(reason)
}

fn with_recorder(
    recorder: &Arc<Mutex<Recorder>>,
    action: impl FnOnce(&mut Recorder),
) -> Result<()> {
    let mut guard = recorder
        .lock()
        .map_err(|_poisoned| AcpError::RecorderPoisoned)?;
    action(&mut guard);

    Ok(())
}

fn with_value<T>(
    recorder: &Arc<Mutex<Recorder>>,
    action: impl FnOnce(&mut Recorder) -> T,
) -> Result<T> {
    let mut guard = recorder
        .lock()
        .map_err(|_poisoned| AcpError::RecorderPoisoned)?;

    Ok(action(&mut guard))
}
