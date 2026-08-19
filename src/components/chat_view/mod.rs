use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::rc::Rc;
use std::time::{Duration, Instant};

use gtk::glib;
use gtk::glib::prelude::*;
use gtk::prelude::*;
use sele_agent::AgentRuntime;
use sele_core::{AgentDescriptor, AgentSession, TranscriptMessage, TranscriptSessionKey};

use super::ChatSummary;
use crate::transcript_loader::{TranscriptLoadCancellation, TranscriptLoadEvent, load_transcript};

pub(super) const STYLE: &str = include_str!("style.css");

mod message_row;

use message_row::materialized_message_row;

const ROW_BUILD_BUDGET: Duration = Duration::from_millis(2);
const BOTTOM_STABLE_FRAMES: u8 = 10;
const TAIL_PREVIEW_MESSAGES: usize = 32;

#[derive(Default)]
struct TranscriptState {
    key: Option<TranscriptSessionKey>,
    cancellation: Option<TranscriptLoadCancellation>,
}

#[derive(Clone)]
pub struct ChatView {
    root: gtk::Box,
    title: gtk::Label,
    status: gtk::Label,
    stale_banner: adw::Banner,
    messages: gtk::Box,
    viewport: gtk::ScrolledWindow,
    preview_messages: gtk::Box,
    preview_viewport: gtk::ScrolledWindow,
    state: Rc<RefCell<TranscriptState>>,
    request_id: Rc<Cell<u64>>,
    render_id: Rc<Cell<u64>>,
    rendering: Rc<Cell<bool>>,
    has_transcript: Rc<Cell<bool>>,
    load_finished: Rc<Cell<bool>>,
    stick_to_bottom: Rc<Cell<bool>>,
    current_session: Rc<RefCell<Option<AgentSession>>>,
    agent_runtime: AgentRuntime,
}

#[derive(Clone)]
struct TranscriptRefresh {
    status: gtk::Label,
    stale_banner: glib::WeakRef<adw::Banner>,
    messages: gtk::Box,
    viewport: gtk::ScrolledWindow,
    preview_messages: gtk::Box,
    preview_viewport: gtk::ScrolledWindow,
    state: Rc<RefCell<TranscriptState>>,
    request_id: Rc<Cell<u64>>,
    render_id: Rc<Cell<u64>>,
    rendering: Rc<Cell<bool>>,
    has_transcript: Rc<Cell<bool>>,
    load_finished: Rc<Cell<bool>>,
    stick_to_bottom: Rc<Cell<bool>>,
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
        self.render_id.set(self.render_id.get().wrapping_add(1));
        self.rendering.set(false);
        self.load_finished.set(false);
        self.stick_to_bottom.set(false);
        self.viewport.set_opacity(1.0);
        self.preview_viewport.set_visible(false);
        self.preview_viewport.set_opacity(0.0);
        clear_messages(&self.preview_messages);
        *self.state.borrow_mut() = TranscriptState {
            key: Some(TranscriptSessionKey::new(
                session.agent.id.as_str(),
                &session.id,
            )),
            ..TranscriptState::default()
        };
        *self.current_session.borrow_mut() = Some(session.clone());

        if preserve_messages {
            self.has_transcript
                .set(self.messages.first_child().is_some());
            self.status.set_visible(false);
        } else {
            self.has_transcript.set(false);
            clear_messages(&self.messages);
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
                        if !refresh.rendering.get() {
                            refresh.show_finished_status();
                        }
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
        let render_id = self.render_id.get().wrapping_add(1);
        self.render_id.set(render_id);
        messages.sort_by_key(|message| message.sequence);
        self.has_transcript.set(!messages.is_empty());
        self.rendering.set(!messages.is_empty());
        self.stick_to_bottom.set(!messages.is_empty());
        clear_messages(&self.messages);
        clear_messages(&self.preview_messages);
        if messages.is_empty() {
            self.viewport.set_opacity(1.0);
            self.preview_viewport.set_visible(false);
            if self.load_finished.get() {
                self.show_finished_status();
            }
            return;
        }

        for message in &messages[messages.len().saturating_sub(TAIL_PREVIEW_MESSAGES)..] {
            self.preview_messages
                .append(&materialized_message_row(message));
        }
        self.viewport.set_opacity(0.0);
        self.preview_viewport.set_opacity(0.0);
        self.preview_viewport.set_visible(true);
        reveal_tail_after_layout(
            &self.preview_viewport,
            &self.status,
            Rc::clone(&self.render_id),
            render_id,
        );

        let queue = Rc::new(RefCell::new(VecDeque::from(messages)));
        let current_render_id = Rc::clone(&self.render_id);
        let rendering = Rc::clone(&self.rendering);
        let stick_to_bottom = Rc::clone(&self.stick_to_bottom);
        let viewport = self.viewport.clone();
        let preview_viewport = self.preview_viewport.clone();
        self.messages.add_tick_callback(move |container, _| {
            if current_render_id.get() != render_id {
                return glib::ControlFlow::Break;
            }

            let started = Instant::now();
            let mut built = 0;
            while built == 0 || started.elapsed() < ROW_BUILD_BUDGET {
                let Some(message) = queue.borrow_mut().pop_back() else {
                    break;
                };
                container.prepend(&materialized_message_row(&message));
                built += 1;
            }

            if queue.borrow().is_empty() {
                rendering.set(false);
                finish_bottom_pinning_after_layout(
                    &viewport,
                    &preview_viewport,
                    Rc::clone(&stick_to_bottom),
                    Rc::clone(&current_render_id),
                    render_id,
                );
                glib::ControlFlow::Break
            } else {
                glib::ControlFlow::Continue
            }
        });
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
        let title = gtk::Label::new(Some("Select a chat"));
        title.add_css_class("heading");
        title.set_halign(gtk::Align::Start);
        title.set_ellipsize(gtk::pango::EllipsizeMode::End);

        let status = gtk::Label::new(Some("Select a chat to load its messages"));
        status.add_css_class("transcript-status");
        status.set_halign(gtk::Align::Start);
        status.set_wrap(true);
        status.set_xalign(0.0);

        let stale_banner = adw::Banner::new("Couldn’t refresh — showing cached messages");
        stale_banner.set_button_label(Some("Retry"));

        let messages = gtk::Box::new(gtk::Orientation::Vertical, 0);
        messages.add_css_class("transcript-list");

        let top_spacer = gtk::Box::new(gtk::Orientation::Vertical, 0);
        top_spacer.set_vexpand(true);

        let transcript_canvas = gtk::Box::new(gtk::Orientation::Vertical, 0);
        transcript_canvas.set_vexpand(true);
        transcript_canvas.append(&top_spacer);
        transcript_canvas.append(&messages);

        let viewport = gtk::ScrolledWindow::new();
        viewport.set_hscrollbar_policy(gtk::PolicyType::Never);
        viewport.set_vexpand(true);
        viewport.set_child(Some(&transcript_canvas));

        let preview_messages = gtk::Box::new(gtk::Orientation::Vertical, 0);
        preview_messages.add_css_class("transcript-list");

        let preview_top_spacer = gtk::Box::new(gtk::Orientation::Vertical, 0);
        preview_top_spacer.set_vexpand(true);

        let preview_canvas = gtk::Box::new(gtk::Orientation::Vertical, 0);
        preview_canvas.set_vexpand(true);
        preview_canvas.append(&preview_top_spacer);
        preview_canvas.append(&preview_messages);

        let preview_viewport = gtk::ScrolledWindow::new();
        preview_viewport.set_hscrollbar_policy(gtk::PolicyType::Never);
        preview_viewport.set_hexpand(true);
        preview_viewport.set_vexpand(true);
        preview_viewport.set_child(Some(&preview_canvas));
        preview_viewport.set_opacity(0.0);
        preview_viewport.set_visible(false);

        let transcript_overlay = gtk::Overlay::new();
        transcript_overlay.set_vexpand(true);
        transcript_overlay.set_child(Some(&viewport));
        transcript_overlay.add_overlay(&preview_viewport);

        let stick_to_bottom = Rc::new(Cell::new(false));
        viewport.vadjustment().connect_upper_notify({
            let stick_to_bottom = Rc::clone(&stick_to_bottom);
            let pin_scheduled = Rc::new(Cell::new(false));
            move |adjustment| {
                if !stick_to_bottom.get() || pin_scheduled.replace(true) {
                    return;
                }

                let adjustment = adjustment.downgrade();
                let stick_to_bottom = Rc::clone(&stick_to_bottom);
                let pin_scheduled = Rc::clone(&pin_scheduled);
                glib::idle_add_local_once(move || {
                    pin_scheduled.set(false);
                    if stick_to_bottom.get()
                        && let Some(adjustment) = adjustment.upgrade()
                    {
                        pin_adjustment_to_bottom(&adjustment);
                    }
                });
            }
        });

        let header = gtk::Box::new(gtk::Orientation::Vertical, 0);
        header.add_css_class("chat-header");
        header.append(&title);

        let transcript = gtk::Box::new(gtk::Orientation::Vertical, 0);
        transcript.add_css_class("transcript-content");
        transcript.set_vexpand(true);
        transcript.append(&status);
        transcript.append(&transcript_overlay);

        let root = gtk::Box::new(gtk::Orientation::Vertical, 0);
        root.add_css_class("chat-body");
        root.set_vexpand(true);
        root.append(&header);
        root.append(&stale_banner);
        root.append(&transcript);

        let view = Self {
            root,
            title,
            status,
            stale_banner,
            messages,
            viewport,
            preview_messages,
            preview_viewport,
            state: Rc::new(RefCell::new(TranscriptState::default())),
            request_id: Rc::new(Cell::new(0)),
            render_id: Rc::new(Cell::new(0)),
            rendering: Rc::new(Cell::new(false)),
            has_transcript: Rc::new(Cell::new(false)),
            load_finished: Rc::new(Cell::new(false)),
            stick_to_bottom,
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

        self.title.set_text(&chat.name);
        self.title
            .set_tooltip_text(Some(&format!("{} · {}", chat.agent_name, chat.cwd)));

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
            messages: self.messages.clone(),
            viewport: self.viewport.clone(),
            preview_messages: self.preview_messages.clone(),
            preview_viewport: self.preview_viewport.clone(),
            state: Rc::clone(&self.state),
            request_id: Rc::clone(&self.request_id),
            render_id: Rc::clone(&self.render_id),
            rendering: Rc::clone(&self.rendering),
            has_transcript: Rc::clone(&self.has_transcript),
            load_finished: Rc::clone(&self.load_finished),
            stick_to_bottom: Rc::clone(&self.stick_to_bottom),
            current_session: Rc::clone(&self.current_session),
            agent_runtime: self.agent_runtime.clone(),
        }
    }
}

fn clear_messages(messages: &gtk::Box) {
    while let Some(row) = messages.first_child() {
        messages.remove(&row);
    }
}

fn pin_adjustment_to_bottom(adjustment: &gtk::Adjustment) {
    adjustment.set_value((adjustment.upper() - adjustment.page_size()).max(adjustment.lower()));
}

fn reveal_tail_after_layout(
    preview_viewport: &gtk::ScrolledWindow,
    status: &gtk::Label,
    current_render_id: Rc<Cell<u64>>,
    render_id: u64,
) {
    let adjustment = preview_viewport.vadjustment();
    let frames = Rc::new(Cell::new(0_u8));
    let status = status.clone();
    preview_viewport.add_tick_callback(move |viewport, _| {
        if current_render_id.get() != render_id {
            return glib::ControlFlow::Break;
        }

        let frame = frames.get().saturating_add(1);
        frames.set(frame);
        if frame < 2 {
            return glib::ControlFlow::Continue;
        }

        pin_adjustment_to_bottom(&adjustment);
        viewport.set_opacity(1.0);
        status.set_visible(false);
        glib::ControlFlow::Break
    });
}

fn finish_bottom_pinning_after_layout(
    viewport: &gtk::ScrolledWindow,
    preview_viewport: &gtk::ScrolledWindow,
    stick_to_bottom: Rc<Cell<bool>>,
    current_render_id: Rc<Cell<u64>>,
    render_id: u64,
) {
    let adjustment = viewport.vadjustment();
    let stable_frames = Rc::new(Cell::new(0_u8));
    let last_upper = Rc::new(Cell::new(adjustment.upper()));
    let full_viewport = viewport.clone();
    let preview_viewport = preview_viewport.clone();
    viewport.add_tick_callback(move |_, _| {
        if current_render_id.get() != render_id || !stick_to_bottom.get() {
            return glib::ControlFlow::Break;
        }

        pin_adjustment_to_bottom(&adjustment);
        let upper = adjustment.upper();
        let unchanged = (upper - last_upper.replace(upper)).abs() < 0.5;
        let stable = if unchanged {
            stable_frames.get().saturating_add(1)
        } else {
            0
        };
        stable_frames.set(stable);
        if stable < BOTTOM_STABLE_FRAMES {
            return glib::ControlFlow::Continue;
        }
        full_viewport.set_opacity(1.0);
        preview_viewport.set_visible(false);
        stick_to_bottom.set(false);
        glib::ControlFlow::Break
    });
}
