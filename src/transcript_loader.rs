use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use async_channel::{Receiver, Sender};
use sele_agent::{AgentRuntime, TranscriptReplayEvent};
use sele_core::{AgentSession, TranscriptMessage, TranscriptSession, TranscriptSessionKey};
use sele_store::{StoreError, TranscriptStore};

pub const TRANSCRIPT_PAGE_SIZE: usize = 100;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PageDirection {
    Older,
    Newer,
}

#[derive(Clone, Debug)]
pub struct TranscriptPage {
    pub messages: Vec<TranscriptMessage>,
    pub has_more: bool,
}

#[derive(Clone, Debug)]
pub enum TranscriptLoadEvent {
    Cached(TranscriptPage),
    Refreshed(TranscriptPage),
    Finished,
    Failed(String),
}

#[derive(Clone, Debug)]
pub enum TranscriptPageEvent {
    Loaded(TranscriptPage),
    Failed(String),
}

#[derive(Debug)]
struct CancellationState {
    cancelled: AtomicBool,
    replay: Mutex<Option<Receiver<TranscriptReplayEvent>>>,
}

#[derive(Clone, Debug)]
pub struct TranscriptLoadCancellation(Arc<CancellationState>);

impl TranscriptLoadCancellation {
    fn new() -> Self {
        Self(Arc::new(CancellationState {
            cancelled: AtomicBool::new(false),
            replay: Mutex::new(None),
        }))
    }

    pub fn cancel(&self) {
        self.0.cancelled.store(true, Ordering::Release);
        if let Some(replay) = lock_unpoisoned(&self.0.replay).as_ref() {
            replay.close();
        }
    }

    fn is_cancelled(&self) -> bool {
        self.0.cancelled.load(Ordering::Acquire)
    }

    fn attach_replay(&self, replay: &Receiver<TranscriptReplayEvent>) {
        *lock_unpoisoned(&self.0.replay) = Some(replay.clone());
        if self.is_cancelled() {
            replay.close();
        }
    }
}

pub fn load_transcript(
    session: AgentSession,
    agent_runtime: AgentRuntime,
) -> (Receiver<TranscriptLoadEvent>, TranscriptLoadCancellation) {
    let (sender, receiver) = async_channel::unbounded();
    let cancellation = TranscriptLoadCancellation::new();
    let worker_cancellation = cancellation.clone();
    let thread_name = format!("sele-{}-cache", session.agent.id.as_str());

    if let Err(error) = std::thread::Builder::new()
        .name(thread_name)
        .spawn(move || {
            run_transcript_load(session, agent_runtime, sender, worker_cancellation);
        })
    {
        let (fallback_sender, fallback_receiver) = async_channel::unbounded();
        let _ = fallback_sender.try_send(TranscriptLoadEvent::Failed(format!(
            "could not start transcript cache worker: {error}"
        )));
        return (fallback_receiver, cancellation);
    }

    (receiver, cancellation)
}

pub fn load_page(
    key: TranscriptSessionKey,
    direction: PageDirection,
    pivot: i64,
) -> Receiver<TranscriptPageEvent> {
    let (sender, receiver) = async_channel::bounded(1);
    let _ = std::thread::Builder::new()
        .name("sele-transcript-page".into())
        .spawn(move || {
            let result = TranscriptStore::open_default().and_then(|store| {
                let messages = match direction {
                    PageDirection::Older => {
                        store.messages_before(&key, pivot, TRANSCRIPT_PAGE_SIZE)?
                    }
                    PageDirection::Newer => {
                        store.messages_after(&key, pivot, TRANSCRIPT_PAGE_SIZE)?
                    }
                };
                Ok(page(messages))
            });
            let event = match result {
                Ok(page) => TranscriptPageEvent::Loaded(page),
                Err(error) => TranscriptPageEvent::Failed(error.to_string()),
            };
            let _ = sender.try_send(event);
        });
    receiver
}

fn run_transcript_load(
    session: AgentSession,
    agent_runtime: AgentRuntime,
    sender: Sender<TranscriptLoadEvent>,
    cancellation: TranscriptLoadCancellation,
) {
    if cancellation.is_cancelled() {
        return;
    }

    let mut store = match TranscriptStore::open_default() {
        Ok(store) => store,
        Err(error) => {
            send(&sender, TranscriptLoadEvent::Failed(error.to_string()));
            return;
        }
    };
    let key = TranscriptSessionKey::new(session.agent.id.as_str(), &session.id);
    let cached = match store.newest_messages(&key, TRANSCRIPT_PAGE_SIZE) {
        Ok(messages) => {
            send(&sender, TranscriptLoadEvent::Cached(page(messages)));
            true
        }
        Err(StoreError::MissingActiveGeneration(_)) => false,
        Err(error) => {
            send(&sender, TranscriptLoadEvent::Failed(error.to_string()));
            return;
        }
    };

    if cancellation.is_cancelled() {
        return;
    }

    if cached && session.updated_at.is_some() {
        match store.active_source_revision(&key) {
            Ok(revision) if revision == session.updated_at => {
                send(&sender, TranscriptLoadEvent::Finished);
                return;
            }
            Ok(_) => {}
            Err(error) => {
                send(&sender, TranscriptLoadEvent::Failed(error.to_string()));
                return;
            }
        }
    }

    let mut transcript_session =
        TranscriptSession::new(session.agent.id.as_str(), &session.id, &session.cwd);
    transcript_session.title = session.title.clone();
    transcript_session.source_updated_at = session.updated_at.clone();
    let import = match store.begin_import(&transcript_session) {
        Ok(import) => import,
        Err(error) => {
            send(&sender, TranscriptLoadEvent::Failed(error.to_string()));
            return;
        }
    };

    let replay = agent_runtime.replay_session(session);
    cancellation.attach_replay(&replay);
    while let Ok(event) = replay.recv_blocking() {
        if cancellation.is_cancelled() {
            let _ = store.discard_import(&import);
            return;
        }

        match event {
            TranscriptReplayEvent::Batch(messages) => {
                if let Err(error) = store.write_import_batch(&import, &messages) {
                    let _ = store.discard_import(&import);
                    send(&sender, TranscriptLoadEvent::Failed(error.to_string()));
                    return;
                }
            }
            TranscriptReplayEvent::Finished => {
                if let Err(error) = store.activate_import(&import) {
                    let _ = store.discard_import(&import);
                    send(&sender, TranscriptLoadEvent::Failed(error.to_string()));
                    return;
                }
                match store.newest_messages(&key, TRANSCRIPT_PAGE_SIZE) {
                    Ok(messages) => {
                        send(&sender, TranscriptLoadEvent::Refreshed(page(messages)));
                        send(&sender, TranscriptLoadEvent::Finished);
                    }
                    Err(error) => {
                        send(&sender, TranscriptLoadEvent::Failed(error.to_string()));
                    }
                }
                return;
            }
            TranscriptReplayEvent::Failed(error) => {
                let _ = store.discard_import(&import);
                send(&sender, TranscriptLoadEvent::Failed(error));
                return;
            }
        }
    }

    let _ = store.discard_import(&import);
    send(
        &sender,
        TranscriptLoadEvent::Failed("agent transcript stream ended unexpectedly".into()),
    );
}

fn page(messages: Vec<TranscriptMessage>) -> TranscriptPage {
    let has_more = messages.len() == TRANSCRIPT_PAGE_SIZE;
    TranscriptPage { messages, has_more }
}

fn send(sender: &Sender<TranscriptLoadEvent>, event: TranscriptLoadEvent) {
    let _ = sender.try_send(event);
}

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancelling_a_load_closes_the_provider_replay() {
        let (sender, receiver) = async_channel::unbounded();
        let cancellation = TranscriptLoadCancellation::new();
        cancellation.attach_replay(&receiver);

        cancellation.cancel();

        assert!(cancellation.is_cancelled());
        assert!(sender.is_closed());
    }
}
