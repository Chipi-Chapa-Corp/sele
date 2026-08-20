use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    ContentBlock, ContentChunk, EmbeddedResourceResource, Implementation, InitializeRequest,
    ListSessionsRequest, LoadSessionRequest, McpServer, McpServerStdio, SessionNotification,
    SessionUpdate, ToolCall, ToolCallStatus, ToolKind,
};
use agent_client_protocol::{AcpAgent, Client};
use async_channel::{Receiver, Sender};
use sele_core::{
    AgentDescriptor, AgentSession, TranscriptBlock, TranscriptBlockKind, TranscriptMessage,
    TranscriptMessagePhase, TranscriptMessageState, TranscriptRole, TranscriptToolKind,
};
use tokio::task::JoinSet;

const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(45);
const TRANSCRIPT_LOAD_TIMEOUT: Duration = Duration::from_secs(120);
const TRANSCRIPT_BATCH_SIZE: usize = 64;

#[derive(Clone, Debug)]
pub struct AgentDefinition {
    pub descriptor: AgentDescriptor,
    command: PathBuf,
    args: Vec<String>,
}

impl AgentDefinition {
    pub fn stdio(
        id: impl Into<String>,
        name: impl Into<String>,
        command: impl Into<PathBuf>,
        args: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        Self {
            descriptor: AgentDescriptor::new(id, name),
            command: command.into(),
            args: args.into_iter().map(Into::into).collect(),
        }
    }

    fn into_acp_agent(self) -> AcpAgent {
        let server = McpServerStdio::new(self.descriptor.name, self.command).args(self.args);
        AcpAgent::new(McpServer::Stdio(server))
    }
}

#[derive(Clone, Debug)]
pub enum DiscoveryEvent {
    AgentLoaded {
        agent: AgentDescriptor,
        sessions: Vec<AgentSession>,
    },
    AgentFailed {
        agent: AgentDescriptor,
        error: String,
    },
    EngineFailed(String),
    Finished,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TranscriptReplayEvent {
    Batch(Vec<TranscriptMessage>),
    Finished,
    Failed(String),
}

enum AgentCommand {
    Replay {
        session: AgentSession,
        sender: Sender<TranscriptReplayEvent>,
    },
}

#[derive(Clone)]
pub struct AgentRuntime {
    commands: Arc<HashMap<String, Sender<AgentCommand>>>,
}

impl AgentRuntime {
    pub fn replay_session(&self, session: AgentSession) -> Receiver<TranscriptReplayEvent> {
        let (sender, receiver) = async_channel::unbounded();
        let Some(commands) = self.commands.get(session.agent.id.as_str()) else {
            let _ = sender.try_send(TranscriptReplayEvent::Failed(format!(
                "unknown agent adapter: {}",
                session.agent.id.as_str()
            )));
            return receiver;
        };
        if commands
            .try_send(AgentCommand::Replay {
                session,
                sender: sender.clone(),
            })
            .is_err()
        {
            let _ = sender.try_send(TranscriptReplayEvent::Failed(
                "agent runtime is unavailable".into(),
            ));
        }
        receiver
    }
}

struct ActiveReplay {
    session_id: String,
    normalizer: TranscriptNormalizer,
}

pub fn builtin_agents() -> Vec<AgentDefinition> {
    vec![
        AgentDefinition::stdio(
            "codex",
            "Codex",
            "npx",
            ["-y", "@agentclientprotocol/codex-acp@1.4.0"],
        ),
        AgentDefinition::stdio(
            "claude",
            "Claude Agent",
            "npx",
            ["-y", "@agentclientprotocol/claude-agent-acp@0.69.0"],
        ),
        AgentDefinition::stdio("copilot", "GitHub Copilot", "copilot", ["--acp", "--stdio"]),
    ]
}

pub fn discover_builtin_sessions() -> Receiver<DiscoveryEvent> {
    let (_runtime, receiver) = start_builtin_runtime();
    receiver
}

pub fn start_builtin_runtime() -> (AgentRuntime, Receiver<DiscoveryEvent>) {
    let definitions = builtin_agents();
    let (discovery_sender, discovery_receiver) = async_channel::unbounded();
    let remaining = Arc::new(AtomicUsize::new(definitions.len()));
    let mut commands = HashMap::with_capacity(definitions.len());

    if definitions.is_empty() {
        let _ = discovery_sender.try_send(DiscoveryEvent::Finished);
    }

    for definition in definitions {
        let (command_sender, command_receiver) = async_channel::unbounded();
        commands.insert(definition.descriptor.id.as_str().to_owned(), command_sender);
        let descriptor = definition.descriptor.clone();
        let sender = discovery_sender.clone();
        let remaining_for_thread = Arc::clone(&remaining);
        if let Err(error) = std::thread::Builder::new()
            .name(format!("sele-{}-runtime", descriptor.id.as_str()))
            .spawn(move || {
                run_persistent_agent(definition, command_receiver, sender, remaining_for_thread);
            })
        {
            let _ = discovery_sender.try_send(DiscoveryEvent::AgentFailed {
                agent: descriptor,
                error: format!("could not start agent runtime: {error}"),
            });
            finish_initial_discovery(&discovery_sender, &remaining);
        }
    }

    (
        AgentRuntime {
            commands: Arc::new(commands),
        },
        discovery_receiver,
    )
}

pub fn discover_sessions(definitions: Vec<AgentDefinition>) -> Receiver<DiscoveryEvent> {
    let (sender, receiver) = async_channel::unbounded();
    let engine_sender = sender.clone();
    if let Err(error) = std::thread::Builder::new()
        .name("sele-agent-engine".into())
        .spawn(move || run_discovery_engine(definitions, engine_sender))
    {
        let _ = sender.try_send(DiscoveryEvent::EngineFailed(format!(
            "could not start agent engine: {error}"
        )));
        let _ = sender.try_send(DiscoveryEvent::Finished);
    }
    receiver
}

fn run_discovery_engine(definitions: Vec<AgentDefinition>, sender: Sender<DiscoveryEvent>) {
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            let _ = sender.try_send(DiscoveryEvent::EngineFailed(format!(
                "could not initialize agent runtime: {error}"
            )));
            let _ = sender.try_send(DiscoveryEvent::Finished);
            return;
        }
    };

    runtime.block_on(async move {
        let mut jobs = JoinSet::new();
        for definition in definitions {
            let descriptor = definition.descriptor.clone();
            jobs.spawn(async move {
                let result =
                    tokio::time::timeout(DISCOVERY_TIMEOUT, discover_agent_sessions(definition))
                        .await
                        .unwrap_or_else(|_| {
                            Err(format!(
                                "session discovery timed out after {} seconds",
                                DISCOVERY_TIMEOUT.as_secs()
                            ))
                        });
                (descriptor, result)
            });
        }

        while let Some(result) = jobs.join_next().await {
            let event = match result {
                Ok((agent, Ok(sessions))) => DiscoveryEvent::AgentLoaded { agent, sessions },
                Ok((agent, Err(error))) => DiscoveryEvent::AgentFailed { agent, error },
                Err(error) => {
                    DiscoveryEvent::EngineFailed(format!("agent discovery task failed: {error}"))
                }
            };
            if sender.send(event).await.is_err() {
                return;
            }
        }

        let _ = sender.send(DiscoveryEvent::Finished).await;
    });
}

fn run_persistent_agent(
    definition: AgentDefinition,
    commands: Receiver<AgentCommand>,
    discovery_sender: Sender<DiscoveryEvent>,
    remaining: Arc<AtomicUsize>,
) {
    let descriptor = definition.descriptor.clone();
    let reported = Arc::new(AtomicBool::new(false));
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            report_initial_failure(
                &discovery_sender,
                &remaining,
                &reported,
                descriptor,
                format!("could not initialize agent runtime: {error}"),
            );
            return;
        }
    };

    let sender_for_connection = discovery_sender.clone();
    let remaining_for_connection = Arc::clone(&remaining);
    let reported_for_connection = Arc::clone(&reported);
    let active_replay = Arc::new(Mutex::new(None::<ActiveReplay>));
    let active_for_notifications = Arc::clone(&active_replay);
    let agent = definition.into_acp_agent();
    let descriptor_for_connection = descriptor.clone();
    let result = runtime.block_on(async move {
        Client
            .builder()
            .name("sele")
            .on_receive_notification(
                async move |notification: SessionNotification, _connection| {
                    let mut active = lock_unpoisoned(&active_for_notifications);
                    if let Some(active) = active.as_mut()
                        && notification.session_id.to_string() == active.session_id
                    {
                        active.normalizer.apply(notification.update);
                    }
                    Ok(())
                },
                agent_client_protocol::on_receive_notification!(),
            )
            .connect_with(agent, async move |connection| {
                let initialization = connection
                    .send_request(InitializeRequest::new(ProtocolVersion::V1).client_info(
                        Implementation::new("sele", env!("CARGO_PKG_VERSION")).title("Sele"),
                    ))
                    .block_task()
                    .await?;

                if initialization
                    .agent_capabilities
                    .session_capabilities
                    .list
                    .is_none()
                {
                    return Err(agent_client_protocol::Error::method_not_found()
                        .data(serde_json::json!("agent does not support session/list")));
                }

                let mut sessions = Vec::new();
                let mut cursor = None;
                let mut seen_cursors = HashSet::new();
                loop {
                    let response = connection
                        .send_request(ListSessionsRequest::new().cursor(cursor))
                        .block_task()
                        .await?;
                    sessions.extend(response.sessions);

                    let Some(next_cursor) = response.next_cursor else {
                        break;
                    };
                    if !seen_cursors.insert(next_cursor.clone()) {
                        break;
                    }
                    cursor = Some(next_cursor);
                }
                let normalized = sessions
                    .into_iter()
                    .map(|session| AgentSession {
                        agent: descriptor_for_connection.clone(),
                        id: session.session_id.to_string(),
                        cwd: session.cwd,
                        title: session.title,
                        updated_at: session.updated_at,
                    })
                    .collect();
                let _ = sender_for_connection
                    .send(DiscoveryEvent::AgentLoaded {
                        agent: descriptor_for_connection.clone(),
                        sessions: normalized,
                    })
                    .await;
                report_initial_success(
                    &sender_for_connection,
                    &remaining_for_connection,
                    &reported_for_connection,
                );

                while let Ok(command) = commands.recv().await {
                    match command {
                        AgentCommand::Replay { session, sender } => {
                            if sender.is_closed() {
                                continue;
                            }
                            if !initialization.agent_capabilities.load_session {
                                let _ = sender.try_send(TranscriptReplayEvent::Failed(
                                    "agent does not support session/load".into(),
                                ));
                                continue;
                            }
                            *lock_unpoisoned(&active_replay) = Some(ActiveReplay {
                                session_id: session.id.clone(),
                                normalizer: TranscriptNormalizer::new(sender.clone()),
                            });
                            let request = connection
                                .send_request(LoadSessionRequest::new(session.id, session.cwd));
                            let load = tokio::select! {
                                result = request.block_task() => {
                                    result.map(Some).map_err(|error| error.to_string())
                                }
                                () = sender.closed() => Ok(None),
                                () = tokio::time::sleep(TRANSCRIPT_LOAD_TIMEOUT) => {
                                    Err(format!(
                                        "session load timed out after {} seconds",
                                        TRANSCRIPT_LOAD_TIMEOUT.as_secs()
                                    ))
                                }
                            };
                            let active = lock_unpoisoned(&active_replay).take();
                            match load {
                                Ok(Some(_)) => {
                                    if let Some(mut active) = active {
                                        active.normalizer.finish();
                                    }
                                    let _ = sender.try_send(TranscriptReplayEvent::Finished);
                                }
                                Ok(None) => {}
                                Err(error) => {
                                    let _ = sender.try_send(TranscriptReplayEvent::Failed(error));
                                }
                            }
                        }
                    }
                }
                Ok(())
            })
            .await
    });

    if let Err(error) = result {
        report_initial_failure(
            &discovery_sender,
            &remaining,
            &reported,
            descriptor,
            error.to_string(),
        );
    }
}

fn report_initial_success(
    sender: &Sender<DiscoveryEvent>,
    remaining: &AtomicUsize,
    reported: &AtomicBool,
) {
    if !reported.swap(true, Ordering::AcqRel) {
        finish_initial_discovery(sender, remaining);
    }
}

fn report_initial_failure(
    sender: &Sender<DiscoveryEvent>,
    remaining: &AtomicUsize,
    reported: &AtomicBool,
    agent: AgentDescriptor,
    error: String,
) {
    if !reported.swap(true, Ordering::AcqRel) {
        let _ = sender.try_send(DiscoveryEvent::AgentFailed { agent, error });
        finish_initial_discovery(sender, remaining);
    }
}

fn finish_initial_discovery(sender: &Sender<DiscoveryEvent>, remaining: &AtomicUsize) {
    if remaining.fetch_sub(1, Ordering::AcqRel) == 1 {
        let _ = sender.try_send(DiscoveryEvent::Finished);
    }
}

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

async fn discover_agent_sessions(definition: AgentDefinition) -> Result<Vec<AgentSession>, String> {
    let descriptor = definition.descriptor.clone();
    let agent = definition.into_acp_agent();
    let result = Client
        .builder()
        .name("sele")
        .connect_with(agent, async move |connection| {
            let initialization = connection
                .send_request(InitializeRequest::new(ProtocolVersion::V1).client_info(
                    Implementation::new("sele", env!("CARGO_PKG_VERSION")).title("Sele"),
                ))
                .block_task()
                .await?;

            if initialization
                .agent_capabilities
                .session_capabilities
                .list
                .is_none()
            {
                return Ok(None);
            }

            let mut sessions = Vec::new();
            let mut cursor = None;
            let mut seen_cursors = HashSet::new();
            loop {
                let response = connection
                    .send_request(ListSessionsRequest::new().cursor(cursor))
                    .block_task()
                    .await?;
                sessions.extend(response.sessions);

                let Some(next_cursor) = response.next_cursor else {
                    break;
                };
                if !seen_cursors.insert(next_cursor.clone()) {
                    break;
                }
                cursor = Some(next_cursor);
            }

            Ok(Some(sessions))
        })
        .await
        .map_err(|error| error.to_string())?;

    let sessions = result.ok_or_else(|| "agent does not support session/list".to_owned())?;
    Ok(sessions
        .into_iter()
        .map(|session| AgentSession {
            agent: descriptor.clone(),
            id: session.session_id.to_string(),
            cwd: session.cwd,
            title: session.title,
            updated_at: session.updated_at,
        })
        .collect())
}

struct PendingContentMessage {
    source_id: Option<String>,
    message: TranscriptMessage,
}

struct TranscriptNormalizer {
    sender: Sender<TranscriptReplayEvent>,
    next_sequence: i64,
    active_content: Option<PendingContentMessage>,
    tools: HashMap<String, (i64, ToolCall)>,
    batch: Vec<TranscriptMessage>,
}

impl TranscriptNormalizer {
    fn new(sender: Sender<TranscriptReplayEvent>) -> Self {
        Self {
            sender,
            next_sequence: 0,
            active_content: None,
            tools: HashMap::new(),
            batch: Vec::with_capacity(TRANSCRIPT_BATCH_SIZE),
        }
    }

    fn apply(&mut self, update: SessionUpdate) {
        match update {
            SessionUpdate::UserMessageChunk(chunk) => {
                self.push_content(TranscriptRole::User, chunk);
            }
            SessionUpdate::AgentMessageChunk(chunk) => {
                self.push_content(TranscriptRole::Agent, chunk);
            }
            SessionUpdate::AgentThoughtChunk(chunk) => {
                self.push_content(TranscriptRole::Thought, chunk);
            }
            SessionUpdate::ToolCall(tool_call) => self.push_tool_call(tool_call),
            SessionUpdate::ToolCallUpdate(update) => {
                self.flush_active_content();
                let id = update.tool_call_id.to_string();
                if let Some((_, tool_call)) = self.tools.get_mut(&id) {
                    tool_call.update(update.fields);
                } else {
                    let fallback = update.clone();
                    let mut tool_call = ToolCall::new(id.clone(), "Tool call");
                    tool_call.update(fallback.fields);
                    let sequence = self.take_sequence();
                    self.tools.insert(id.clone(), (sequence, tool_call));
                }
                self.emit_tool(&id);
            }
            _ => {}
        }
    }

    fn push_content(&mut self, role: TranscriptRole, chunk: ContentChunk) {
        let phase = normalize_message_phase(&chunk);
        let source_id = chunk.message_id.map(|id| id.to_string());
        let continues_active = self
            .active_content
            .as_ref()
            .is_some_and(|active| active.message.role == role && active.source_id == source_id);
        if !continues_active {
            self.flush_active_content();
            let sequence = self.take_sequence();
            let source = source_id.as_deref().unwrap_or("anonymous");
            let mut message = TranscriptMessage::new(
                format!("{}:{source}:{sequence}", role.as_str()),
                sequence,
                role,
                TranscriptMessageState::Complete,
            );
            message.phase = phase;
            self.active_content = Some(PendingContentMessage {
                source_id: source_id.clone(),
                message,
            });
        }

        if let Some(active) = &mut self.active_content {
            if active.message.phase == TranscriptMessagePhase::Unknown {
                active.message.phase = phase;
            }
            let block_sequence = active.message.blocks.len() as i64;
            active
                .message
                .blocks
                .push(normalize_content(block_sequence, chunk.content));
        }
    }

    fn push_tool_call(&mut self, tool_call: ToolCall) {
        self.flush_active_content();
        let id = tool_call.tool_call_id.to_string();
        let sequence = if let Some((sequence, _)) = self.tools.get(&id) {
            *sequence
        } else {
            self.take_sequence()
        };
        self.tools.insert(id.clone(), (sequence, tool_call));
        self.emit_tool(&id);
    }

    fn emit_tool(&mut self, id: &str) {
        if let Some((sequence, tool_call)) = self.tools.get(id) {
            self.batch.push(normalize_tool(*sequence, tool_call));
            self.flush_full_batch();
        }
    }

    fn flush_active_content(&mut self) {
        if let Some(active) = self.active_content.take() {
            self.batch.push(active.message);
            self.flush_full_batch();
        }
    }

    fn finish(&mut self) {
        self.flush_active_content();
        self.flush_batch();
    }

    fn take_sequence(&mut self) -> i64 {
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        sequence
    }

    fn flush_full_batch(&mut self) {
        if self.batch.len() >= TRANSCRIPT_BATCH_SIZE {
            self.flush_batch();
        }
    }

    fn flush_batch(&mut self) {
        if self.batch.is_empty() {
            return;
        }
        let batch = std::mem::replace(&mut self.batch, Vec::with_capacity(TRANSCRIPT_BATCH_SIZE));
        let _ = self.sender.try_send(TranscriptReplayEvent::Batch(batch));
    }
}

fn normalize_message_phase(chunk: &ContentChunk) -> TranscriptMessagePhase {
    match chunk
        .meta
        .as_ref()
        .and_then(|meta| meta.get("codex"))
        .and_then(|codex| codex.get("phase"))
        .and_then(serde_json::Value::as_str)
    {
        Some("commentary") => TranscriptMessagePhase::Commentary,
        Some("final_answer") => TranscriptMessagePhase::FinalAnswer,
        _ => TranscriptMessagePhase::Unknown,
    }
}

fn normalize_content(sequence: i64, content: ContentBlock) -> TranscriptBlock {
    let kind = match content {
        ContentBlock::Text(text) => TranscriptBlockKind::Text { text: text.text },
        ContentBlock::Image(image) => TranscriptBlockKind::Image {
            uri: image
                .uri
                .unwrap_or_else(|| format!("data:{};base64,{}", image.mime_type, image.data)),
            alt: Some("Image".into()),
        },
        ContentBlock::ResourceLink(resource) => TranscriptBlockKind::Resource {
            uri: resource.uri,
            title: resource.title.or(Some(resource.name)),
        },
        ContentBlock::Resource(resource) => match resource.resource {
            EmbeddedResourceResource::TextResourceContents(resource) => TranscriptBlockKind::Code {
                language: resource.mime_type,
                text: resource.text,
            },
            EmbeddedResourceResource::BlobResourceContents(resource) => {
                TranscriptBlockKind::Resource {
                    uri: resource.uri,
                    title: resource.mime_type,
                }
            }
            other => TranscriptBlockKind::Other {
                kind: "acp_embedded_resource".into(),
                payload_json: serde_json::to_string(&other).unwrap_or_default(),
            },
        },
        other => TranscriptBlockKind::Other {
            kind: "acp_content".into(),
            payload_json: serde_json::to_string(&other).unwrap_or_default(),
        },
    };
    TranscriptBlock { sequence, kind }
}

fn normalize_tool(sequence: i64, tool_call: &ToolCall) -> TranscriptMessage {
    let id = tool_call.tool_call_id.to_string();
    let status = tool_status(tool_call.status);
    let state = match tool_call.status {
        ToolCallStatus::Pending | ToolCallStatus::InProgress => TranscriptMessageState::Streaming,
        ToolCallStatus::Completed => TranscriptMessageState::Complete,
        ToolCallStatus::Failed => TranscriptMessageState::Error,
        _ => TranscriptMessageState::Complete,
    };
    let mut message =
        TranscriptMessage::new(format!("tool:{id}"), sequence, TranscriptRole::Tool, state);
    message.blocks.push(TranscriptBlock {
        sequence: 0,
        kind: TranscriptBlockKind::ToolCall {
            tool_call_id: id.clone(),
            title: tool_call.title.clone(),
            tool_kind: normalize_tool_kind(tool_call.kind),
            status: status.into(),
            payload_json: tool_call
                .raw_input
                .as_ref()
                .and_then(|input| serde_json::to_string(input).ok()),
        },
    });
    if !tool_call.content.is_empty() || tool_call.raw_output.is_some() {
        message.blocks.push(TranscriptBlock {
            sequence: 1,
            kind: TranscriptBlockKind::ToolResult {
                tool_call_id: id,
                content: normalize_tool_result(tool_call),
            },
        });
    }
    message
}

fn normalize_tool_result(tool_call: &ToolCall) -> String {
    if !tool_call.content.is_empty()
        && let Ok(content) = serde_json::to_value(&tool_call.content)
        && let Some(text) = display_text_from_value(&content)
    {
        return text;
    }

    if let Some(output) = &tool_call.raw_output {
        return display_text_from_value(output).unwrap_or_else(|| {
            serde_json::to_string_pretty(output).unwrap_or_else(|_| output.to_string())
        });
    }

    serde_json::to_string_pretty(&tool_call.content).unwrap_or_default()
}

/// Converts legacy provider-shaped tool output into the human-facing content it contains.
/// New ACP results are normalized before storage; this keeps existing caches readable.
pub fn display_tool_result(content: &str) -> Cow<'_, str> {
    if let Ok(value) = serde_json::from_str(content) {
        return display_text_from_value(&value).map_or(Cow::Borrowed(""), Cow::Owned);
    }
    match clean_output_text(content) {
        Some(cleaned) if cleaned != content => Cow::Owned(cleaned),
        Some(_) => Cow::Borrowed(content),
        None => Cow::Borrowed(""),
    }
}

fn display_text_from_value(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => clean_output_text(text),
        serde_json::Value::Array(values) => join_display_text(values.iter()),
        serde_json::Value::Object(fields) => {
            for key in [
                "output",
                "stdout",
                "stderr",
                "text",
                "content",
                "formatted_output",
                "formattedOutput",
            ] {
                if let Some(value) = fields.get(key)
                    && let Some(text) = display_text_from_value(value)
                {
                    return Some(text);
                }
            }
            None
        }
        _ => None,
    }
}

fn join_display_text<'a>(
    values: impl IntoIterator<Item = &'a serde_json::Value>,
) -> Option<String> {
    let parts = values
        .into_iter()
        .filter_map(display_text_from_value)
        .collect::<Vec<_>>();
    (!parts.is_empty()).then(|| parts.join("\n"))
}

fn clean_output_text(text: &str) -> Option<String> {
    let text = if let Some((metadata, output)) = text.split_once("\nOutput:\n")
        && [
            "Chunk ID:",
            "Wall time:",
            "Process exited with code",
            "Original token count:",
        ]
        .iter()
        .any(|marker| metadata.contains(marker))
    {
        output
    } else {
        text
    };
    let text = text.trim_end_matches('\n');
    (!text.trim().is_empty()).then(|| text.to_owned())
}

const fn normalize_tool_kind(kind: ToolKind) -> TranscriptToolKind {
    match kind {
        ToolKind::Read => TranscriptToolKind::Read,
        ToolKind::Edit => TranscriptToolKind::Edit,
        ToolKind::Delete => TranscriptToolKind::Delete,
        ToolKind::Move => TranscriptToolKind::Move,
        ToolKind::Search => TranscriptToolKind::Search,
        ToolKind::Execute => TranscriptToolKind::Execute,
        ToolKind::Think => TranscriptToolKind::Think,
        ToolKind::Fetch => TranscriptToolKind::Fetch,
        ToolKind::SwitchMode => TranscriptToolKind::SwitchMode,
        _ => TranscriptToolKind::Other,
    }
}

const fn tool_status(status: ToolCallStatus) -> &'static str {
    match status {
        ToolCallStatus::Pending => "pending",
        ToolCallStatus::InProgress => "in_progress",
        ToolCallStatus::Completed => "completed",
        ToolCallStatus::Failed => "failed",
        _ => "unknown",
    }
}

#[cfg(test)]
mod transcript_tests {
    use super::*;
    use agent_client_protocol::schema::v1::{TextContent, ToolCallUpdate, ToolCallUpdateFields};

    fn text_chunk(text: &str, message_id: &str) -> ContentChunk {
        ContentChunk::new(ContentBlock::Text(TextContent::new(text))).message_id(message_id)
    }

    fn normalize(updates: impl IntoIterator<Item = SessionUpdate>) -> Vec<TranscriptMessage> {
        let (sender, receiver) = async_channel::unbounded();
        let mut normalizer = TranscriptNormalizer::new(sender);
        for update in updates {
            normalizer.apply(update);
        }
        normalizer.finish();
        drop(normalizer);

        let mut messages = Vec::new();
        while let Ok(event) = receiver.try_recv() {
            if let TranscriptReplayEvent::Batch(batch) = event {
                messages.extend(batch);
            }
        }
        messages
    }

    #[test]
    fn joins_chunks_by_role_and_message_id() {
        let messages = normalize([
            SessionUpdate::UserMessageChunk(text_chunk("hel", "user-1")),
            SessionUpdate::UserMessageChunk(text_chunk("lo", "user-1")),
            SessionUpdate::AgentMessageChunk(text_chunk("world", "agent-1")),
        ]);

        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, TranscriptRole::User);
        assert_eq!(messages[0].blocks.len(), 2);
        assert_eq!(messages[1].role, TranscriptRole::Agent);
        assert!(messages[0].sequence < messages[1].sequence);
    }

    #[test]
    fn tool_updates_replace_the_same_normalized_message() {
        let messages = normalize([
            SessionUpdate::ToolCall(ToolCall::new("tool-1", "Read file").kind(ToolKind::Read)),
            SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
                "tool-1",
                ToolCallUpdateFields::new().status(ToolCallStatus::Completed),
            )),
        ]);

        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].id, messages[1].id);
        assert_eq!(messages[0].sequence, messages[1].sequence);
        assert_eq!(messages[1].state, TranscriptMessageState::Complete);
        assert!(matches!(
            messages[1].blocks[0].kind,
            TranscriptBlockKind::ToolCall {
                tool_kind: TranscriptToolKind::Read,
                ..
            }
        ));
    }

    #[test]
    fn preserves_codex_message_phase_metadata() {
        let mut final_chunk = text_chunk("done", "agent-final");
        final_chunk.meta = Some(
            serde_json::json!({"codex": {"phase": "final_answer"}})
                .as_object()
                .unwrap()
                .clone(),
        );
        let messages = normalize([SessionUpdate::AgentMessageChunk(final_chunk)]);

        assert_eq!(messages[0].phase, TranscriptMessagePhase::FinalAnswer);
    }

    #[test]
    fn extracts_human_output_from_provider_result_shape() {
        let tool_call = ToolCall::new("tool-1", "Run command").raw_output(serde_json::json!({
            "formatted_output": "tests passed\n",
            "exit_code": 0
        }));

        assert_eq!(normalize_tool_result(&tool_call), "tests passed");
        assert_eq!(
            display_tool_result(r#"{"formatted_output":"cached output","exit_code":0}"#),
            "cached output"
        );
        assert_eq!(
            display_tool_result(
                r#"{"output":"Chunk ID: abc\nWall time: 0.1 seconds\nProcess exited with code 0\nOriginal token count: 2\nOutput:\nreal output\n","exit_code":0}"#
            ),
            "real output"
        );
    }
}
