use std::path::PathBuf;

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct TranscriptSessionKey {
    pub provider_id: String,
    pub session_id: String,
}

impl TranscriptSessionKey {
    pub fn new(provider_id: impl Into<String>, session_id: impl Into<String>) -> Self {
        Self {
            provider_id: provider_id.into(),
            session_id: session_id.into(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TranscriptSession {
    pub key: TranscriptSessionKey,
    pub cwd: PathBuf,
    pub title: Option<String>,
    pub source_updated_at: Option<String>,
}

impl TranscriptSession {
    pub fn new(
        provider_id: impl Into<String>,
        session_id: impl Into<String>,
        cwd: impl Into<PathBuf>,
    ) -> Self {
        Self {
            key: TranscriptSessionKey::new(provider_id, session_id),
            cwd: cwd.into(),
            title: None,
            source_updated_at: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TranscriptRole {
    User,
    Agent,
    Thought,
    System,
    Tool,
}

impl TranscriptRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Agent => "agent",
            Self::Thought => "thought",
            Self::System => "system",
            Self::Tool => "tool",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "user" => Some(Self::User),
            "agent" => Some(Self::Agent),
            "thought" => Some(Self::Thought),
            "system" => Some(Self::System),
            "tool" => Some(Self::Tool),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TranscriptMessageState {
    Streaming,
    Complete,
    Error,
}

impl TranscriptMessageState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Streaming => "streaming",
            Self::Complete => "complete",
            Self::Error => "error",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "streaming" => Some(Self::Streaming),
            "complete" => Some(Self::Complete),
            "error" => Some(Self::Error),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TranscriptMessage {
    pub id: String,
    pub sequence: i64,
    pub role: TranscriptRole,
    pub state: TranscriptMessageState,
    pub blocks: Vec<TranscriptBlock>,
}

impl TranscriptMessage {
    pub fn new(
        id: impl Into<String>,
        sequence: i64,
        role: TranscriptRole,
        state: TranscriptMessageState,
    ) -> Self {
        Self {
            id: id.into(),
            sequence,
            role,
            state,
            blocks: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TranscriptBlock {
    pub sequence: i64,
    pub kind: TranscriptBlockKind,
}

impl TranscriptBlock {
    pub fn text(sequence: i64, text: impl Into<String>) -> Self {
        Self {
            sequence,
            kind: TranscriptBlockKind::Text { text: text.into() },
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TranscriptBlockKind {
    Text {
        text: String,
    },
    Code {
        language: Option<String>,
        text: String,
    },
    ToolCall {
        tool_call_id: String,
        title: String,
        status: String,
        payload_json: Option<String>,
    },
    ToolResult {
        tool_call_id: String,
        content: String,
    },
    Image {
        uri: String,
        alt: Option<String>,
    },
    Resource {
        uri: String,
        title: Option<String>,
    },
    Other {
        kind: String,
        payload_json: String,
    },
}
