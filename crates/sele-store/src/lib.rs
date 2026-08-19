use std::borrow::Cow;
use std::env;
use std::error::Error;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use directories::ProjectDirs;
use rusqlite::{Connection, OptionalExtension, Params, Transaction, params};
use sele_core::{
    TranscriptBlock, TranscriptBlockKind, TranscriptMessage, TranscriptMessageState,
    TranscriptRole, TranscriptSession, TranscriptSessionKey,
};

pub const DATABASE_PATH_ENV: &str = "SELE_TRANSCRIPT_DATABASE_PATH";
pub const DEFAULT_DATABASE_FILENAME: &str = "sele-native-transcripts-v1.sqlite3";
pub const LEGACY_ELECTRON_DATABASE_FILENAME: &str = "sele.sqlite";

const SCHEMA_VERSION: i64 = 1;
const STORE_KIND: &str = "sele-native-transcript-store-v1";

#[derive(Debug)]
pub enum StoreError {
    Io(std::io::Error),
    Sql(rusqlite::Error),
    NoDataDirectory,
    ForeignDatabase(PathBuf),
    UnsupportedSchema { found: i64, supported: i64 },
    CorruptData(String),
    MissingImport(ImportToken),
    MissingActiveGeneration(TranscriptSessionKey),
}

impl fmt::Display for StoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "I/O error: {error}"),
            Self::Sql(error) => write!(formatter, "SQLite error: {error}"),
            Self::NoDataDirectory => write!(formatter, "could not determine Sele's data directory"),
            Self::ForeignDatabase(path) => write!(
                formatter,
                "refusing to initialize transcript storage over an unrelated database: {}",
                path.display()
            ),
            Self::UnsupportedSchema { found, supported } => write!(
                formatter,
                "unsupported transcript database schema {found}; this build supports {supported}"
            ),
            Self::CorruptData(message) => write!(formatter, "corrupt transcript data: {message}"),
            Self::MissingImport(token) => write!(
                formatter,
                "transcript import does not exist: {}/{} generation {}",
                token.key.provider_id, token.key.session_id, token.generation
            ),
            Self::MissingActiveGeneration(key) => write!(
                formatter,
                "session has no active transcript generation: {}/{}",
                key.provider_id, key.session_id
            ),
        }
    }
}

impl Error for StoreError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::Sql(error) => Some(error),
            _ => None,
        }
    }
}

impl From<std::io::Error> for StoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<rusqlite::Error> for StoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sql(error)
    }
}

pub type StoreResult<T> = Result<T, StoreError>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImportToken {
    pub key: TranscriptSessionKey,
    pub generation: i64,
}

pub struct TranscriptStore {
    connection: Connection,
    path: PathBuf,
}

impl TranscriptStore {
    pub fn open_default() -> StoreResult<Self> {
        Self::open(default_database_path()?)
    }

    pub fn open(path: impl AsRef<Path>) -> StoreResult<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            fs::create_dir_all(parent)?;
        }

        let connection = Connection::open(&path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        initialize_schema(&connection, &path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        Ok(Self { connection, path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn begin_import(&mut self, session: &TranscriptSession) -> StoreResult<ImportToken> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO transcript_sessions (
                provider_id, session_id, cwd, title, source_updated_at, active_generation
             ) VALUES (?1, ?2, ?3, ?4, NULL, NULL)
             ON CONFLICT(provider_id, session_id) DO UPDATE SET
                cwd = excluded.cwd,
                title = excluded.title",
            params![
                session.key.provider_id,
                session.key.session_id,
                session.cwd.to_string_lossy(),
                session.title,
            ],
        )?;
        transaction.execute(
            "DELETE FROM transcript_generations
             WHERE provider_id = ?1 AND session_id = ?2 AND state = 'staging'",
            params![session.key.provider_id, session.key.session_id],
        )?;

        let generation = transaction.query_row(
            "SELECT COALESCE(MAX(generation), 0) + 1
             FROM transcript_generations
             WHERE provider_id = ?1 AND session_id = ?2",
            params![session.key.provider_id, session.key.session_id],
            |row| row.get(0),
        )?;
        transaction.execute(
            "INSERT INTO transcript_generations (
                provider_id, session_id, generation, state, source_updated_at, started_at
             ) VALUES (?1, ?2, ?3, 'staging', ?4, ?5)",
            params![
                session.key.provider_id,
                session.key.session_id,
                generation,
                session.source_updated_at,
                unix_timestamp_millis(),
            ],
        )?;
        transaction.commit()?;

        Ok(ImportToken {
            key: session.key.clone(),
            generation,
        })
    }

    pub fn write_import_batch(
        &mut self,
        import: &ImportToken,
        messages: &[TranscriptMessage],
    ) -> StoreResult<()> {
        let transaction = self.connection.transaction()?;
        require_generation_state(&transaction, import, "staging")?;
        upsert_messages(&transaction, import, messages)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn activate_import(&mut self, import: &ImportToken) -> StoreResult<()> {
        let transaction = self.connection.transaction()?;
        require_generation_state(&transaction, import, "staging")?;
        transaction.execute(
            "UPDATE transcript_generations SET state = 'active'
             WHERE provider_id = ?1 AND session_id = ?2 AND generation = ?3",
            params![
                import.key.provider_id,
                import.key.session_id,
                import.generation
            ],
        )?;
        transaction.execute(
            "UPDATE transcript_sessions SET
                active_generation = ?3,
                source_updated_at = (
                    SELECT source_updated_at FROM transcript_generations
                    WHERE provider_id = ?1 AND session_id = ?2 AND generation = ?3
                )
             WHERE provider_id = ?1 AND session_id = ?2",
            params![
                import.key.provider_id,
                import.key.session_id,
                import.generation
            ],
        )?;
        transaction.execute(
            "DELETE FROM transcript_generations
             WHERE provider_id = ?1 AND session_id = ?2 AND generation <> ?3",
            params![
                import.key.provider_id,
                import.key.session_id,
                import.generation
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn discard_import(&mut self, import: &ImportToken) -> StoreResult<()> {
        self.connection.execute(
            "DELETE FROM transcript_generations
             WHERE provider_id = ?1 AND session_id = ?2
               AND generation = ?3 AND state = 'staging'",
            params![
                import.key.provider_id,
                import.key.session_id,
                import.generation
            ],
        )?;
        Ok(())
    }

    pub fn append_active_batch(
        &mut self,
        key: &TranscriptSessionKey,
        messages: &[TranscriptMessage],
    ) -> StoreResult<()> {
        let transaction = self.connection.transaction()?;
        let generation = active_generation(&transaction, key)?;
        let import = ImportToken {
            key: key.clone(),
            generation,
        };
        upsert_messages(&transaction, &import, messages)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn newest_messages(
        &self,
        key: &TranscriptSessionKey,
        limit: usize,
    ) -> StoreResult<Vec<TranscriptMessage>> {
        let mut rows = self.query_message_rows(
            "SELECT m.message_id, m.sequence, m.role, m.state
             FROM transcript_messages m
             JOIN transcript_sessions s
               ON s.provider_id = m.provider_id AND s.session_id = m.session_id
              AND s.active_generation = m.generation
             WHERE m.provider_id = ?1 AND m.session_id = ?2
             ORDER BY m.sequence DESC LIMIT ?3",
            params![key.provider_id, key.session_id, usize_to_i64(limit)],
        )?;
        rows.reverse();
        self.hydrate_messages(key, rows)
    }

    pub fn all_messages(&self, key: &TranscriptSessionKey) -> StoreResult<Vec<TranscriptMessage>> {
        let rows = self.query_message_rows(
            "SELECT m.message_id, m.sequence, m.role, m.state
             FROM transcript_messages m
             JOIN transcript_sessions s
               ON s.provider_id = m.provider_id AND s.session_id = m.session_id
              AND s.active_generation = m.generation
             WHERE m.provider_id = ?1 AND m.session_id = ?2
             ORDER BY m.sequence ASC",
            params![key.provider_id, key.session_id],
        )?;
        self.hydrate_messages(key, rows)
    }

    pub fn messages_before(
        &self,
        key: &TranscriptSessionKey,
        before_sequence: i64,
        limit: usize,
    ) -> StoreResult<Vec<TranscriptMessage>> {
        let mut rows = self.query_message_rows(
            "SELECT m.message_id, m.sequence, m.role, m.state
             FROM transcript_messages m
             JOIN transcript_sessions s
               ON s.provider_id = m.provider_id AND s.session_id = m.session_id
              AND s.active_generation = m.generation
             WHERE m.provider_id = ?1 AND m.session_id = ?2 AND m.sequence < ?3
             ORDER BY m.sequence DESC LIMIT ?4",
            params![
                key.provider_id,
                key.session_id,
                before_sequence,
                usize_to_i64(limit)
            ],
        )?;
        rows.reverse();
        self.hydrate_messages(key, rows)
    }

    pub fn messages_after(
        &self,
        key: &TranscriptSessionKey,
        after_sequence: i64,
        limit: usize,
    ) -> StoreResult<Vec<TranscriptMessage>> {
        let rows = self.query_message_rows(
            "SELECT m.message_id, m.sequence, m.role, m.state
             FROM transcript_messages m
             JOIN transcript_sessions s
               ON s.provider_id = m.provider_id AND s.session_id = m.session_id
              AND s.active_generation = m.generation
             WHERE m.provider_id = ?1 AND m.session_id = ?2 AND m.sequence > ?3
             ORDER BY m.sequence ASC LIMIT ?4",
            params![
                key.provider_id,
                key.session_id,
                after_sequence,
                usize_to_i64(limit)
            ],
        )?;
        self.hydrate_messages(key, rows)
    }

    pub fn active_source_revision(
        &self,
        key: &TranscriptSessionKey,
    ) -> StoreResult<Option<String>> {
        self.connection
            .query_row(
                "SELECT source_updated_at FROM transcript_sessions
                 WHERE provider_id = ?1 AND session_id = ?2 AND active_generation IS NOT NULL",
                params![key.provider_id, key.session_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(StoreError::from)
            .map(Option::flatten)
    }

    fn query_message_rows<P: Params>(
        &self,
        sql: &str,
        parameters: P,
    ) -> StoreResult<Vec<MessageRow>> {
        let mut statement = self.connection.prepare(sql)?;
        let rows = statement.query_map(parameters, |row| {
            Ok(MessageRow {
                id: row.get(0)?,
                sequence: row.get(1)?,
                role: row.get(2)?,
                state: row.get(3)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }

    fn hydrate_messages(
        &self,
        key: &TranscriptSessionKey,
        rows: Vec<MessageRow>,
    ) -> StoreResult<Vec<TranscriptMessage>> {
        let generation = active_generation(&self.connection, key)?;
        rows.into_iter()
            .map(|row| {
                let role = TranscriptRole::parse(&row.role).ok_or_else(|| {
                    StoreError::CorruptData(format!("unknown message role {}", row.role))
                })?;
                let state = TranscriptMessageState::parse(&row.state).ok_or_else(|| {
                    StoreError::CorruptData(format!("unknown message state {}", row.state))
                })?;
                Ok(TranscriptMessage {
                    id: row.id,
                    sequence: row.sequence,
                    role,
                    state,
                    blocks: self.load_blocks(key, generation, row.sequence)?,
                })
            })
            .collect()
    }

    fn load_blocks(
        &self,
        key: &TranscriptSessionKey,
        generation: i64,
        message_sequence: i64,
    ) -> StoreResult<Vec<TranscriptBlock>> {
        let mut statement = self.connection.prepare(
            "SELECT sequence, kind, text, language, reference_id, title, status, uri, alt, payload_json
             FROM transcript_blocks
             WHERE provider_id = ?1 AND session_id = ?2 AND generation = ?3
               AND message_sequence = ?4
             ORDER BY sequence ASC",
        )?;
        let rows = statement.query_map(
            params![
                key.provider_id,
                key.session_id,
                generation,
                message_sequence
            ],
            |row| {
                Ok(BlockRow {
                    sequence: row.get(0)?,
                    kind: row.get(1)?,
                    text: row.get(2)?,
                    language: row.get(3)?,
                    reference_id: row.get(4)?,
                    title: row.get(5)?,
                    status: row.get(6)?,
                    uri: row.get(7)?,
                    alt: row.get(8)?,
                    payload_json: row.get(9)?,
                })
            },
        )?;
        rows.map(|row| block_from_row(row?)).collect()
    }
}

pub fn default_database_path() -> StoreResult<PathBuf> {
    if let Some(path) = env::var_os(DATABASE_PATH_ENV).filter(|path| !path.is_empty()) {
        return Ok(PathBuf::from(path));
    }

    let directories =
        ProjectDirs::from("dev", "sele", "Sele").ok_or(StoreError::NoDataDirectory)?;
    Ok(directories.data_local_dir().join(DEFAULT_DATABASE_FILENAME))
}

fn initialize_schema(connection: &Connection, path: &Path) -> StoreResult<()> {
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version == 0 {
        let existing_table = connection
            .query_row(
                "SELECT name FROM sqlite_schema
                 WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if existing_table.is_some() {
            return Err(StoreError::ForeignDatabase(path.to_path_buf()));
        }
        connection.execute_batch(SCHEMA)?;
    } else if version != SCHEMA_VERSION {
        return Err(StoreError::UnsupportedSchema {
            found: version,
            supported: SCHEMA_VERSION,
        });
    }

    let store_kind = connection
        .query_row(
            "SELECT value FROM sele_store_metadata WHERE key = 'store_kind'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if store_kind.as_deref() != Some(STORE_KIND) {
        return Err(StoreError::ForeignDatabase(path.to_path_buf()));
    }
    Ok(())
}

fn require_generation_state(
    connection: &Connection,
    import: &ImportToken,
    expected: &str,
) -> StoreResult<()> {
    let state = connection
        .query_row(
            "SELECT state FROM transcript_generations
             WHERE provider_id = ?1 AND session_id = ?2 AND generation = ?3",
            params![
                import.key.provider_id,
                import.key.session_id,
                import.generation
            ],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if state.as_deref() == Some(expected) {
        Ok(())
    } else {
        Err(StoreError::MissingImport(import.clone()))
    }
}

fn active_generation(connection: &Connection, key: &TranscriptSessionKey) -> StoreResult<i64> {
    connection
        .query_row(
            "SELECT active_generation FROM transcript_sessions
             WHERE provider_id = ?1 AND session_id = ?2",
            params![key.provider_id, key.session_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten()
        .ok_or_else(|| StoreError::MissingActiveGeneration(key.clone()))
}

fn upsert_messages(
    transaction: &Transaction<'_>,
    import: &ImportToken,
    messages: &[TranscriptMessage],
) -> StoreResult<()> {
    for message in messages {
        transaction.execute(
            "INSERT INTO transcript_messages (
                provider_id, session_id, generation, sequence, message_id, role, state
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(provider_id, session_id, generation, sequence) DO UPDATE SET
                message_id = excluded.message_id,
                role = excluded.role,
                state = excluded.state",
            params![
                import.key.provider_id,
                import.key.session_id,
                import.generation,
                message.sequence,
                message.id,
                message.role.as_str(),
                message.state.as_str(),
            ],
        )?;
        transaction.execute(
            "DELETE FROM transcript_blocks
             WHERE provider_id = ?1 AND session_id = ?2 AND generation = ?3
               AND message_sequence = ?4",
            params![
                import.key.provider_id,
                import.key.session_id,
                import.generation,
                message.sequence,
            ],
        )?;
        for block in &message.blocks {
            insert_block(transaction, import, message.sequence, block)?;
        }
    }
    Ok(())
}

fn insert_block(
    transaction: &Transaction<'_>,
    import: &ImportToken,
    message_sequence: i64,
    block: &TranscriptBlock,
) -> StoreResult<()> {
    let values = BlockValues::from(&block.kind);
    transaction.execute(
        "INSERT INTO transcript_blocks (
            provider_id, session_id, generation, message_sequence, sequence, kind,
            text, language, reference_id, title, status, uri, alt, payload_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            import.key.provider_id,
            import.key.session_id,
            import.generation,
            message_sequence,
            block.sequence,
            values.kind.as_ref(),
            values.text,
            values.language,
            values.reference_id,
            values.title,
            values.status,
            values.uri,
            values.alt,
            values.payload_json,
        ],
    )?;
    Ok(())
}

struct MessageRow {
    id: String,
    sequence: i64,
    role: String,
    state: String,
}

struct BlockRow {
    sequence: i64,
    kind: String,
    text: Option<String>,
    language: Option<String>,
    reference_id: Option<String>,
    title: Option<String>,
    status: Option<String>,
    uri: Option<String>,
    alt: Option<String>,
    payload_json: Option<String>,
}

struct BlockValues<'a> {
    kind: Cow<'a, str>,
    text: Option<&'a str>,
    language: Option<&'a str>,
    reference_id: Option<&'a str>,
    title: Option<&'a str>,
    status: Option<&'a str>,
    uri: Option<&'a str>,
    alt: Option<&'a str>,
    payload_json: Option<&'a str>,
}

impl<'a> From<&'a TranscriptBlockKind> for BlockValues<'a> {
    fn from(kind: &'a TranscriptBlockKind) -> Self {
        let mut values = Self {
            kind: Cow::Borrowed(""),
            text: None,
            language: None,
            reference_id: None,
            title: None,
            status: None,
            uri: None,
            alt: None,
            payload_json: None,
        };
        match kind {
            TranscriptBlockKind::Text { text } => {
                values.kind = Cow::Borrowed("text");
                values.text = Some(text);
            }
            TranscriptBlockKind::Code { language, text } => {
                values.kind = Cow::Borrowed("code");
                values.language = language.as_deref();
                values.text = Some(text);
            }
            TranscriptBlockKind::ToolCall {
                tool_call_id,
                title,
                status,
                payload_json,
            } => {
                values.kind = Cow::Borrowed("tool_call");
                values.reference_id = Some(tool_call_id);
                values.title = Some(title);
                values.status = Some(status);
                values.payload_json = payload_json.as_deref();
            }
            TranscriptBlockKind::ToolResult {
                tool_call_id,
                content,
            } => {
                values.kind = Cow::Borrowed("tool_result");
                values.reference_id = Some(tool_call_id);
                values.text = Some(content);
            }
            TranscriptBlockKind::Image { uri, alt } => {
                values.kind = Cow::Borrowed("image");
                values.uri = Some(uri);
                values.alt = alt.as_deref();
            }
            TranscriptBlockKind::Resource { uri, title } => {
                values.kind = Cow::Borrowed("resource");
                values.uri = Some(uri);
                values.title = title.as_deref();
            }
            TranscriptBlockKind::Other { kind, payload_json } => {
                values.kind = Cow::Owned(format!("other:{kind}"));
                values.payload_json = Some(payload_json);
            }
        }
        values
    }
}

fn block_from_row(row: BlockRow) -> StoreResult<TranscriptBlock> {
    let missing =
        |field: &str| StoreError::CorruptData(format!("block {} is missing {field}", row.sequence));
    let kind = match row.kind.as_str() {
        "text" => TranscriptBlockKind::Text {
            text: row.text.ok_or_else(|| missing("text"))?,
        },
        "code" => TranscriptBlockKind::Code {
            language: row.language,
            text: row.text.ok_or_else(|| missing("text"))?,
        },
        "tool_call" => TranscriptBlockKind::ToolCall {
            tool_call_id: row.reference_id.ok_or_else(|| missing("reference_id"))?,
            title: row.title.ok_or_else(|| missing("title"))?,
            status: row.status.ok_or_else(|| missing("status"))?,
            payload_json: row.payload_json,
        },
        "tool_result" => TranscriptBlockKind::ToolResult {
            tool_call_id: row.reference_id.ok_or_else(|| missing("reference_id"))?,
            content: row.text.ok_or_else(|| missing("text"))?,
        },
        "image" => TranscriptBlockKind::Image {
            uri: row.uri.ok_or_else(|| missing("uri"))?,
            alt: row.alt,
        },
        "resource" => TranscriptBlockKind::Resource {
            uri: row.uri.ok_or_else(|| missing("uri"))?,
            title: row.title,
        },
        other => TranscriptBlockKind::Other {
            kind: other.strip_prefix("other:").unwrap_or(other).to_owned(),
            payload_json: row.payload_json.ok_or_else(|| missing("payload_json"))?,
        },
    };
    Ok(TranscriptBlock {
        sequence: row.sequence,
        kind,
    })
}

fn usize_to_i64(value: usize) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn unix_timestamp_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX)
}

const SCHEMA: &str = r#"
BEGIN IMMEDIATE;

CREATE TABLE sele_store_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
) STRICT;

INSERT INTO sele_store_metadata (key, value)
VALUES ('store_kind', 'sele-native-transcript-store-v1');

CREATE TABLE transcript_sessions (
    provider_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    cwd TEXT NOT NULL,
    title TEXT,
    source_updated_at TEXT,
    active_generation INTEGER,
    PRIMARY KEY (provider_id, session_id)
) STRICT;

CREATE TABLE transcript_generations (
    provider_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('staging', 'active')),
    source_updated_at TEXT,
    started_at INTEGER NOT NULL,
    PRIMARY KEY (provider_id, session_id, generation),
    FOREIGN KEY (provider_id, session_id)
        REFERENCES transcript_sessions (provider_id, session_id)
        ON DELETE CASCADE
) STRICT;

CREATE TABLE transcript_messages (
    provider_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    sequence INTEGER NOT NULL,
    message_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'agent', 'thought', 'system', 'tool')),
    state TEXT NOT NULL CHECK (state IN ('streaming', 'complete', 'error')),
    PRIMARY KEY (provider_id, session_id, generation, sequence),
    UNIQUE (provider_id, session_id, generation, message_id),
    FOREIGN KEY (provider_id, session_id, generation)
        REFERENCES transcript_generations (provider_id, session_id, generation)
        ON DELETE CASCADE
) STRICT;

CREATE TABLE transcript_blocks (
    provider_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    message_sequence INTEGER NOT NULL,
    sequence INTEGER NOT NULL,
    kind TEXT NOT NULL,
    text TEXT,
    language TEXT,
    reference_id TEXT,
    title TEXT,
    status TEXT,
    uri TEXT,
    alt TEXT,
    payload_json TEXT,
    PRIMARY KEY (provider_id, session_id, generation, message_sequence, sequence),
    FOREIGN KEY (provider_id, session_id, generation, message_sequence)
        REFERENCES transcript_messages (provider_id, session_id, generation, sequence)
        ON DELETE CASCADE
) STRICT;

CREATE INDEX transcript_messages_page
ON transcript_messages (provider_id, session_id, generation, sequence);

PRAGMA user_version = 1;
COMMIT;
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store() -> (TempDir, TranscriptStore) {
        let directory = TempDir::new().unwrap();
        let store =
            TranscriptStore::open(directory.path().join(DEFAULT_DATABASE_FILENAME)).unwrap();
        (directory, store)
    }

    fn session(revision: &str) -> TranscriptSession {
        let mut session = TranscriptSession::new("codex", "session-1", "/work/sele");
        session.title = Some("Sele architecture".into());
        session.source_updated_at = Some(revision.into());
        session
    }

    fn message(sequence: i64, text: &str) -> TranscriptMessage {
        let mut message = TranscriptMessage::new(
            format!("message-{sequence}"),
            sequence,
            if sequence % 2 == 0 {
                TranscriptRole::Agent
            } else {
                TranscriptRole::User
            },
            TranscriptMessageState::Complete,
        );
        message.blocks.push(TranscriptBlock::text(0, text));
        message
    }

    #[test]
    fn default_database_name_cannot_collide_with_the_electron_database() {
        assert_ne!(DEFAULT_DATABASE_FILENAME, LEGACY_ELECTRON_DATABASE_FILENAME);
        assert!(DEFAULT_DATABASE_FILENAME.contains("native-transcripts-v1"));
        assert_ne!(DATABASE_PATH_ENV, "SELE_DATABASE_PATH");
    }

    #[test]
    fn rejects_an_unrelated_database_instead_of_migrating_it() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("foreign.sqlite3");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute("CREATE TABLE chat (id TEXT PRIMARY KEY)", [])
            .unwrap();
        drop(connection);

        let error = TranscriptStore::open(&path).err().unwrap();
        assert!(matches!(error, StoreError::ForeignDatabase(found) if found == path));
        assert!(!path.with_extension("sqlite3-wal").exists());
    }

    #[test]
    fn staging_is_invisible_until_the_generation_is_activated() {
        let (_directory, mut store) = store();
        let session = session("revision-1");
        let import = store.begin_import(&session).unwrap();
        store
            .write_import_batch(&import, &[message(1, "first"), message(2, "second")])
            .unwrap();

        assert!(store.newest_messages(&session.key, 20).is_err());

        store.activate_import(&import).unwrap();
        let messages = store.newest_messages(&session.key, 20).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].blocks[0], TranscriptBlock::text(0, "first"));
        assert_eq!(
            store.active_source_revision(&session.key).unwrap(),
            Some("revision-1".into())
        );
    }

    #[test]
    fn activation_atomically_replaces_the_previous_generation() {
        let (_directory, mut store) = store();
        let original = session("revision-1");
        let first_import = store.begin_import(&original).unwrap();
        store
            .write_import_batch(&first_import, &[message(1, "old")])
            .unwrap();
        store.activate_import(&first_import).unwrap();

        let replacement = session("revision-2");
        let second_import = store.begin_import(&replacement).unwrap();
        store
            .write_import_batch(&second_import, &[message(10, "new")])
            .unwrap();
        assert_eq!(
            store.newest_messages(&original.key, 10).unwrap()[0].sequence,
            1
        );

        store.activate_import(&second_import).unwrap();
        let messages = store.newest_messages(&original.key, 10).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].sequence, 10);
        assert_eq!(
            store.active_source_revision(&original.key).unwrap(),
            Some("revision-2".into())
        );
    }

    #[test]
    fn pages_are_returned_in_chronological_order() {
        let (_directory, mut store) = store();
        let session = session("revision-1");
        let import = store.begin_import(&session).unwrap();
        let messages = (0..10)
            .map(|sequence| message(sequence, &format!("message {sequence}")))
            .collect::<Vec<_>>();
        store.write_import_batch(&import, &messages).unwrap();
        store.activate_import(&import).unwrap();

        let newest = store.newest_messages(&session.key, 3).unwrap();
        assert_eq!(
            newest
                .iter()
                .map(|message| message.sequence)
                .collect::<Vec<_>>(),
            vec![7, 8, 9]
        );
        let all = store.all_messages(&session.key).unwrap();
        assert_eq!(
            all.iter()
                .map(|message| message.sequence)
                .collect::<Vec<_>>(),
            (0..10).collect::<Vec<_>>()
        );
        let before = store.messages_before(&session.key, 7, 3).unwrap();
        assert_eq!(
            before
                .iter()
                .map(|message| message.sequence)
                .collect::<Vec<_>>(),
            vec![4, 5, 6]
        );
        let after = store.messages_after(&session.key, 6, 2).unwrap();
        assert_eq!(
            after
                .iter()
                .map(|message| message.sequence)
                .collect::<Vec<_>>(),
            vec![7, 8]
        );
    }

    #[test]
    fn active_streaming_messages_can_be_updated_in_place() {
        let (_directory, mut store) = store();
        let session = session("revision-1");
        let import = store.begin_import(&session).unwrap();
        store.activate_import(&import).unwrap();

        let mut streaming = TranscriptMessage::new(
            "agent-message",
            1,
            TranscriptRole::Agent,
            TranscriptMessageState::Streaming,
        );
        streaming.blocks.push(TranscriptBlock::text(0, "partial"));
        store
            .append_active_batch(&session.key, &[streaming.clone()])
            .unwrap();

        streaming.state = TranscriptMessageState::Complete;
        streaming.blocks[0] = TranscriptBlock::text(0, "complete response");
        store
            .append_active_batch(&session.key, &[streaming.clone()])
            .unwrap();

        assert_eq!(
            store.newest_messages(&session.key, 1).unwrap(),
            vec![streaming]
        );
    }

    #[test]
    fn all_normalized_block_variants_round_trip() {
        let (_directory, mut store) = store();
        let session = session("revision-1");
        let import = store.begin_import(&session).unwrap();
        let mut message = TranscriptMessage::new(
            "blocks",
            1,
            TranscriptRole::Agent,
            TranscriptMessageState::Complete,
        );
        message.blocks = vec![
            TranscriptBlock::text(0, "paragraph"),
            TranscriptBlock {
                sequence: 1,
                kind: TranscriptBlockKind::Code {
                    language: Some("rust".into()),
                    text: "fn main() {}".into(),
                },
            },
            TranscriptBlock {
                sequence: 2,
                kind: TranscriptBlockKind::ToolCall {
                    tool_call_id: "tool-1".into(),
                    title: "Read file".into(),
                    status: "running".into(),
                    payload_json: Some("{\"path\":\"README.md\"}".into()),
                },
            },
            TranscriptBlock {
                sequence: 3,
                kind: TranscriptBlockKind::ToolResult {
                    tool_call_id: "tool-1".into(),
                    content: "contents".into(),
                },
            },
            TranscriptBlock {
                sequence: 4,
                kind: TranscriptBlockKind::Image {
                    uri: "file:///tmp/image.png".into(),
                    alt: Some("preview".into()),
                },
            },
            TranscriptBlock {
                sequence: 5,
                kind: TranscriptBlockKind::Resource {
                    uri: "file:///work/README.md".into(),
                    title: Some("README".into()),
                },
            },
            TranscriptBlock {
                sequence: 6,
                kind: TranscriptBlockKind::Other {
                    kind: "text".into(),
                    payload_json: "{\"custom\":true}".into(),
                },
            },
        ];
        store
            .write_import_batch(&import, &[message.clone()])
            .unwrap();
        store.activate_import(&import).unwrap();

        assert_eq!(
            store.newest_messages(&session.key, 1).unwrap(),
            vec![message]
        );
    }
}
