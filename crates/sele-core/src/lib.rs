use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

mod transcript;

pub use transcript::{
    TranscriptBlock, TranscriptBlockKind, TranscriptMessage, TranscriptMessagePhase,
    TranscriptMessageState, TranscriptRole, TranscriptSession, TranscriptSessionKey,
    TranscriptToolKind,
};

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct AgentId(String);

impl AgentId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentDescriptor {
    pub id: AgentId,
    pub name: String,
}

impl AgentDescriptor {
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: AgentId::new(id),
            name: name.into(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentSession {
    pub agent: AgentDescriptor,
    pub id: String,
    pub cwd: PathBuf,
    pub title: Option<String>,
    pub updated_at: Option<String>,
}

impl AgentSession {
    pub fn display_title(&self) -> String {
        self.title
            .as_deref()
            .and_then(|title| title.lines().next())
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| format!("{} session", self.agent.name))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentSessionGroup {
    pub cwd: PathBuf,
    pub sessions: Vec<AgentSession>,
}

pub fn group_sessions_by_cwd(
    sessions: impl IntoIterator<Item = AgentSession>,
) -> Vec<AgentSessionGroup> {
    let mut groups = BTreeMap::<PathBuf, Vec<AgentSession>>::new();
    for session in sessions {
        groups.entry(session.cwd.clone()).or_default().push(session);
    }

    groups
        .into_iter()
        .map(|(cwd, mut sessions)| {
            sessions.sort_by(|left, right| {
                right
                    .updated_at
                    .cmp(&left.updated_at)
                    .then_with(|| left.display_title().cmp(&right.display_title()))
                    .then_with(|| left.agent.id.cmp(&right.agent.id))
            });
            AgentSessionGroup { cwd, sessions }
        })
        .collect()
}

pub fn cwd_display_name(cwd: &Path) -> String {
    cwd.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| cwd.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(agent: &str, id: &str, cwd: &str, updated_at: &str) -> AgentSession {
        AgentSession {
            agent: AgentDescriptor::new(agent, agent),
            id: id.into(),
            cwd: cwd.into(),
            title: Some(id.into()),
            updated_at: Some(updated_at.into()),
        }
    }

    #[test]
    fn groups_sessions_by_full_cwd_and_sorts_newest_first() {
        let groups = group_sessions_by_cwd([
            session("codex", "older", "/work/sele", "2026-01-01T00:00:00Z"),
            session("claude", "other", "/work/other", "2026-03-01T00:00:00Z"),
            session("copilot", "newer", "/work/sele", "2026-02-01T00:00:00Z"),
        ]);

        assert_eq!(groups.len(), 2);
        assert_eq!(groups[1].cwd, PathBuf::from("/work/sele"));
        assert_eq!(groups[1].sessions[0].id, "newer");
        assert_eq!(groups[1].sessions[1].id, "older");
    }

    #[test]
    fn uses_the_last_path_component_as_the_group_label() {
        assert_eq!(cwd_display_name(Path::new("/work/sele")), "sele");
        assert_eq!(cwd_display_name(Path::new("/")), "/");
    }

    #[test]
    fn uses_only_the_trimmed_first_title_line() {
        let mut session = session("codex", "session", "/work/sele", "2026-01-01T00:00:00Z");
        session.title = Some("  First line  \nSecond line\nThird line".into());

        assert_eq!(session.display_title(), "First line");
    }
}
