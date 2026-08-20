use std::cell::{Cell, RefCell};
use std::path::PathBuf;
use std::rc::Rc;

use gtk::glib;
use gtk::glib::prelude::*;
use gtk::prelude::*;
use sele_agent::AgentRuntime;
use sele_core::{AgentDescriptor, AgentSession, TranscriptMessage, TranscriptSessionKey};

use super::ChatSummary;
use crate::transcript_loader::{TranscriptLoadCancellation, TranscriptLoadEvent, load_transcript};

pub(super) const STYLE: &str = include_str!("style.css");

mod message_bubble;
mod message_row;
mod presentation;
mod selectable_text;
mod text_view;
mod work_section;

pub(super) const WORK_SECTION_STYLE: &str = work_section::STYLE;
pub(super) const MESSAGE_BUBBLE_STYLE: &str = message_bubble::STYLE;

use text_view::TranscriptTextView;

#[derive(Default)]
struct TranscriptState {
    key: Option<TranscriptSessionKey>,
    cancellation: Option<TranscriptLoadCancellation>,
}

#[derive(Clone)]
pub struct ChatView {
    root: gtk::Box,
    status: gtk::Label,
    stale_banner: adw::Banner,
    transcript: TranscriptTextView,
    viewport: gtk::ScrolledWindow,
    state: Rc<RefCell<TranscriptState>>,
    request_id: Rc<Cell<u64>>,
    reveal_id: Rc<Cell<u64>>,
    has_transcript: Rc<Cell<bool>>,
    load_finished: Rc<Cell<bool>>,
    current_session: Rc<RefCell<Option<AgentSession>>>,
    agent_runtime: AgentRuntime,
}

#[derive(Clone)]
struct TranscriptRefresh {
    status: gtk::Label,
    stale_banner: glib::WeakRef<adw::Banner>,
    transcript: TranscriptTextView,
    viewport: gtk::ScrolledWindow,
    state: Rc<RefCell<TranscriptState>>,
    request_id: Rc<Cell<u64>>,
    reveal_id: Rc<Cell<u64>>,
    has_transcript: Rc<Cell<bool>>,
    load_finished: Rc<Cell<bool>>,
    current_session: Rc<RefCell<Option<AgentSession>>>,
    agent_runtime: AgentRuntime,
}

impl TranscriptRefresh {
    fn retry(&self) {
        let session = self.current_session.borrow().clone();
        if let Some(session) = session {
            self.start(session, true);
        }
    }

    fn start(&self, session: AgentSession, preserve_messages: bool) {
        if let Some(cancellation) = self.state.borrow_mut().cancellation.take() {
            cancellation.cancel();
        }

        let request_id = self.request_id.get().wrapping_add(1);
        self.request_id.set(request_id);
        self.reveal_id.set(self.reveal_id.get().wrapping_add(1));
        self.load_finished.set(false);
        self.viewport.set_opacity(1.0);
        *self.state.borrow_mut() = TranscriptState {
            key: Some(TranscriptSessionKey::new(
                session.agent.id.as_str(),
                &session.id,
            )),
            ..TranscriptState::default()
        };
        *self.current_session.borrow_mut() = Some(session.clone());

        if preserve_messages {
            self.has_transcript.set(!self.transcript.is_empty());
            self.status.set_visible(false);
        } else {
            self.has_transcript.set(false);
            self.transcript.clear();
            self.show_status("Loading messages…", None);
        }
        if let Some(banner) = self.stale_banner.upgrade() {
            banner.set_sensitive(!preserve_messages);
            banner.set_revealed(preserve_messages);
            if !preserve_messages {
                banner.set_tooltip_text(None);
            }
        }

        let (receiver, cancellation) = load_transcript(session, self.agent_runtime.clone());
        self.state.borrow_mut().cancellation = Some(cancellation);

        let refresh = self.clone();
        glib::MainContext::default().spawn_local(async move {
            while let Ok(event) = receiver.recv().await {
                if refresh.request_id.get() != request_id {
                    return;
                }
                match event {
                    TranscriptLoadEvent::Cached(messages) => {
                        if !preserve_messages {
                            refresh.replace_transcript(messages);
                        }
                    }
                    TranscriptLoadEvent::Refreshed(messages) => {
                        refresh.replace_transcript(messages);
                        refresh.hide_stale_banner();
                    }
                    TranscriptLoadEvent::Finished => {
                        refresh.state.borrow_mut().cancellation = None;
                        refresh.load_finished.set(true);
                        refresh.hide_stale_banner();
                        refresh.show_finished_status();
                        return;
                    }
                    TranscriptLoadEvent::Failed(error) => {
                        refresh.state.borrow_mut().cancellation = None;
                        refresh.load_finished.set(true);
                        if !refresh.has_transcript.get() {
                            refresh.hide_stale_banner();
                            refresh.show_status("Couldn’t load messages", Some(&error));
                        } else {
                            refresh.status.set_visible(false);
                            refresh.show_stale_banner(&error);
                        }
                        return;
                    }
                }
            }
        });
    }

    fn replace_transcript(&self, mut messages: Vec<TranscriptMessage>) {
        messages.sort_by_key(|message| message.sequence);
        self.has_transcript.set(!messages.is_empty());
        let reveal_id = self.reveal_id.get().wrapping_add(1);
        self.reveal_id.set(reveal_id);
        if messages.is_empty() {
            self.transcript.clear();
            self.viewport.set_opacity(1.0);
            if self.load_finished.get() {
                self.show_finished_status();
            }
            return;
        }
        self.viewport.set_opacity(0.0);
        self.transcript.replace(&messages);
        self.transcript.request_scroll_to_end();
        reveal_bottom_after_layout(
            &self.transcript,
            &self.viewport,
            &self.status,
            reveal_id,
            Rc::clone(&self.reveal_id),
        );
    }

    fn show_finished_status(&self) {
        if self.has_transcript.get() {
            self.status.set_visible(false);
        } else {
            self.show_status("This chat has no messages", None);
        }
    }

    fn show_stale_banner(&self, error: &str) {
        if let Some(banner) = self.stale_banner.upgrade() {
            banner.set_sensitive(true);
            banner.set_tooltip_text(Some(error));
            banner.set_revealed(true);
        }
    }

    fn hide_stale_banner(&self) {
        if let Some(banner) = self.stale_banner.upgrade() {
            banner.set_sensitive(true);
            banner.set_tooltip_text(None);
            banner.set_revealed(false);
        }
    }

    fn show_status(&self, text: &str, tooltip: Option<&str>) {
        self.status.set_text(text);
        self.status.set_tooltip_text(tooltip);
        self.status.set_visible(true);
    }
}

impl ChatView {
    pub fn new(agent_runtime: AgentRuntime) -> Self {
        let status = gtk::Label::new(Some("Select a chat to load its messages"));
        status.add_css_class("transcript-status");
        status.set_halign(gtk::Align::Start);
        status.set_wrap(true);
        status.set_xalign(0.0);

        let stale_banner = adw::Banner::new("Couldn’t refresh — showing cached messages");
        stale_banner.set_button_label(Some("Retry"));

        let transcript_view = TranscriptTextView::new();

        let viewport = gtk::ScrolledWindow::new();
        viewport.set_hscrollbar_policy(gtk::PolicyType::External);
        viewport.set_min_content_width(0);
        viewport.set_propagate_natural_width(false);
        viewport.set_vexpand(true);
        viewport.set_child(Some(transcript_view.widget()));
        transcript_view.track_viewport_width(&viewport);

        let transcript = gtk::Box::new(gtk::Orientation::Vertical, 0);
        transcript.add_css_class("transcript-content");
        transcript.set_vexpand(true);
        transcript.append(&status);
        transcript.append(&viewport);

        let root = gtk::Box::new(gtk::Orientation::Vertical, 0);
        root.add_css_class("chat-body");
        root.set_vexpand(true);
        root.append(&stale_banner);
        root.append(&transcript);

        let view = Self {
            root,
            status,
            stale_banner,
            transcript: transcript_view,
            viewport,
            state: Rc::new(RefCell::new(TranscriptState::default())),
            request_id: Rc::new(Cell::new(0)),
            reveal_id: Rc::new(Cell::new(0)),
            has_transcript: Rc::new(Cell::new(false)),
            load_finished: Rc::new(Cell::new(false)),
            current_session: Rc::new(RefCell::new(None)),
            agent_runtime,
        };
        let refresh = view.refresh_context();
        view.stale_banner
            .connect_button_clicked(move |_| refresh.retry());
        view
    }

    pub fn widget(&self) -> &gtk::Box {
        &self.root
    }

    pub fn show_chat(&self, chat: &ChatSummary) {
        let key = TranscriptSessionKey::new(&chat.agent_id, &chat.id);
        if self.state.borrow().key.as_ref() == Some(&key) {
            return;
        }

        let session = AgentSession {
            agent: AgentDescriptor::new(&chat.agent_id, &chat.agent_name),
            id: chat.id.clone(),
            cwd: PathBuf::from(&chat.cwd),
            title: Some(chat.name.clone()),
            updated_at: chat.updated_at.clone(),
        };
        self.refresh_context().start(session, false);
    }

    fn refresh_context(&self) -> TranscriptRefresh {
        TranscriptRefresh {
            status: self.status.clone(),
            stale_banner: self.stale_banner.downgrade(),
            transcript: self.transcript.clone(),
            viewport: self.viewport.clone(),
            state: Rc::clone(&self.state),
            request_id: Rc::clone(&self.request_id),
            reveal_id: Rc::clone(&self.reveal_id),
            has_transcript: Rc::clone(&self.has_transcript),
            load_finished: Rc::clone(&self.load_finished),
            current_session: Rc::clone(&self.current_session),
            agent_runtime: self.agent_runtime.clone(),
        }
    }
}

fn pin_adjustment_to_bottom(adjustment: &gtk::Adjustment) {
    adjustment.set_value((adjustment.upper() - adjustment.page_size()).max(adjustment.lower()));
}

fn reveal_bottom_after_layout(
    transcript: &TranscriptTextView,
    viewport: &gtk::ScrolledWindow,
    status: &gtk::Label,
    reveal_id: u64,
    current_reveal_id: Rc<Cell<u64>>,
) {
    let adjustment = viewport.vadjustment();
    let frames = Rc::new(Cell::new(0_u8));
    let stable_frames = Rc::new(Cell::new(0_u8));
    let last_upper = Rc::new(Cell::new(f64::NAN));
    let last_page_size = Rc::new(Cell::new(f64::NAN));
    let status = status.clone();
    let transcript = transcript.clone();
    viewport.add_tick_callback(move |viewport, _| {
        if current_reveal_id.get() != reveal_id {
            return glib::ControlFlow::Break;
        }

        let frame = frames.get().saturating_add(1);
        frames.set(frame);
        transcript.request_scroll_to_end();
        pin_adjustment_to_bottom(&adjustment);

        let upper = adjustment.upper();
        let page_size = adjustment.page_size();
        let geometry_is_stable = (upper - last_upper.get()).abs() < 0.5
            && (page_size - last_page_size.get()).abs() < 0.5;
        last_upper.set(upper);
        last_page_size.set(page_size);
        stable_frames.set(if geometry_is_stable {
            stable_frames.get().saturating_add(1)
        } else {
            0
        });

        if frame < 3 || (stable_frames.get() < 2 && frame < 30) {
            return glib::ControlFlow::Continue;
        }

        transcript.request_scroll_to_end();
        pin_adjustment_to_bottom(&adjustment);
        viewport.set_opacity(1.0);
        status.set_visible(false);
        glib::ControlFlow::Break
    });
}
