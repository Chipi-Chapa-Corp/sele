use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Duration;

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    Implementation, InitializeRequest, ListSessionsRequest, McpServer, McpServerStdio,
};
use agent_client_protocol::{AcpAgent, Client};
use async_channel::{Receiver, Sender};
use sele_core::{AgentDescriptor, AgentSession};
use tokio::task::JoinSet;

const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(45);

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
    discover_sessions(builtin_agents())
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
