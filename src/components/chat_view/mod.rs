use std::cell::{Cell, RefCell};
use std::path::PathBuf;
use std::rc::Rc;

use gtk::glib::prelude::*;
use gtk::prelude::*;
use gtk::{gio, glib};
use sele_core::{
    AgentDescriptor, AgentSession, TranscriptBlockKind, TranscriptMessage, TranscriptMessageState,
    TranscriptRole, TranscriptSessionKey,
};

use super::ChatSummary;
use crate::transcript_loader::{
    PageDirection, TranscriptLoadCancellation, TranscriptLoadEvent, TranscriptPage,
    TranscriptPageEvent, load_page, load_transcript,
};

pub(super) const STYLE: &str = include_str!("style.css");

const MAX_LOADED_MESSAGES: u32 = 500;
const PAGE_TRIGGER_DISTANCE: f64 = 240.0;

#[derive(Default)]
struct PageState {
    key: Option<TranscriptSessionKey>,
    has_older: bool,
    has_newer: bool,
    loading_older: bool,
    loading_newer: bool,
    cancellation: Option<TranscriptLoadCancellation>,
}

#[derive(Clone)]
pub struct ChatView {
    root: gtk::Box,
    title: gtk::Label,
    status: gtk::Label,
    model: gio::ListStore,
    list: gtk::ListView,
    state: Rc<RefCell<PageState>>,
    request_id: Rc<Cell<u64>>,
}

impl ChatView {
    pub fn new() -> Self {
        let title = gtk::Label::new(Some("Select a chat"));
        title.add_css_class("heading");
        title.set_halign(gtk::Align::Start);
        title.set_ellipsize(gtk::pango::EllipsizeMode::End);

        let status = gtk::Label::new(Some("Select a chat to load its messages"));
        status.add_css_class("transcript-status");
        status.set_halign(gtk::Align::Start);
        status.set_wrap(true);
        status.set_xalign(0.0);

        let model = gio::ListStore::new::<glib::BoxedAnyObject>();
        let selection = gtk::NoSelection::new(Some(model.clone()));
        let list = gtk::ListView::new(Some(selection), Some(message_factory()));
        list.add_css_class("transcript-list");
        list.set_vexpand(true);
        list.set_single_click_activate(false);

        let viewport = gtk::ScrolledWindow::new();
        viewport.set_hscrollbar_policy(gtk::PolicyType::Never);
        viewport.set_vexpand(true);
        viewport.set_child(Some(&list));

        let root = gtk::Box::new(gtk::Orientation::Vertical, 0);
        root.add_css_class("chat-body");
        root.set_vexpand(true);
        root.append(&title);
        root.append(&status);
        root.append(&viewport);

        let view = Self {
            root,
            title,
            status,
            model,
            list,
            state: Rc::new(RefCell::new(PageState::default())),
            request_id: Rc::new(Cell::new(0)),
        };
        view.connect_pagination(&viewport);
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

        if let Some(cancellation) = self.state.borrow_mut().cancellation.take() {
            cancellation.cancel();
        }
        let request_id = self.request_id.get().wrapping_add(1);
        self.request_id.set(request_id);
        *self.state.borrow_mut() = PageState {
            key: Some(key),
            ..PageState::default()
        };

        self.title.set_text(&chat.name);
        self.title
            .set_tooltip_text(Some(&format!("{} · {}", chat.agent_name, chat.cwd)));
        self.model.remove_all();
        self.show_status("Loading messages…", None);

        let session = AgentSession {
            agent: AgentDescriptor::new(&chat.agent_id, &chat.agent_name),
            id: chat.id.clone(),
            cwd: PathBuf::from(&chat.cwd),
            title: Some(chat.name.clone()),
            updated_at: chat.updated_at.clone(),
        };
        let (receiver, cancellation) = load_transcript(session);
        self.state.borrow_mut().cancellation = Some(cancellation);

        let view = self.clone();
        glib::MainContext::default().spawn_local(async move {
            while let Ok(event) = receiver.recv().await {
                if view.request_id.get() != request_id {
                    return;
                }
                match event {
                    TranscriptLoadEvent::Cached(page) => {
                        view.replace_with_latest(page);
                        view.show_status("Refreshing from agent…", None);
                    }
                    TranscriptLoadEvent::Refreshed(page) => {
                        view.replace_with_latest(page);
                    }
                    TranscriptLoadEvent::Finished => {
                        view.state.borrow_mut().cancellation = None;
                        if view.model.n_items() == 0 {
                            view.show_status("This chat has no messages", None);
                        } else {
                            view.status.set_visible(false);
                        }
                        return;
                    }
                    TranscriptLoadEvent::Failed(error) => {
                        view.state.borrow_mut().cancellation = None;
                        let message = if view.model.n_items() == 0 {
                            "Couldn’t load messages"
                        } else {
                            "Showing cached messages; refresh failed"
                        };
                        view.show_status(message, Some(&error));
                        return;
                    }
                }
            }
        });
    }

    fn connect_pagination(&self, viewport: &gtk::ScrolledWindow) {
        let view = self.clone();
        viewport
            .vadjustment()
            .connect_value_changed(move |adjustment| {
                if view.model.n_items() == 0 {
                    return;
                }
                if adjustment.value() <= PAGE_TRIGGER_DISTANCE {
                    view.request_page(PageDirection::Older);
                }
                let distance_from_bottom =
                    adjustment.upper() - adjustment.page_size() - adjustment.value();
                if distance_from_bottom <= PAGE_TRIGGER_DISTANCE {
                    view.request_page(PageDirection::Newer);
                }
            });
    }

    fn request_page(&self, direction: PageDirection) {
        let (key, pivot, request_id) = {
            let mut state = self.state.borrow_mut();
            let allowed = match direction {
                PageDirection::Older => state.has_older && !state.loading_older,
                PageDirection::Newer => state.has_newer && !state.loading_newer,
            };
            if !allowed {
                return;
            }
            let Some(key) = state.key.clone() else {
                return;
            };
            let position = match direction {
                PageDirection::Older => 0,
                PageDirection::Newer => self.model.n_items().saturating_sub(1),
            };
            let Some(item) = self
                .model
                .item(position)
                .and_downcast::<glib::BoxedAnyObject>()
            else {
                return;
            };
            let pivot = item.borrow::<TranscriptMessage>().sequence;
            match direction {
                PageDirection::Older => state.loading_older = true,
                PageDirection::Newer => state.loading_newer = true,
            }
            (key, pivot, self.request_id.get())
        };

        let receiver = load_page(key, direction, pivot);
        let view = self.clone();
        glib::MainContext::default().spawn_local(async move {
            let Ok(event) = receiver.recv().await else {
                view.finish_page_request(direction);
                return;
            };
            if view.request_id.get() != request_id {
                return;
            }
            match event {
                TranscriptPageEvent::Loaded(page) => view.apply_page(direction, page),
                TranscriptPageEvent::Failed(error) => {
                    view.finish_page_request(direction);
                    view.show_status("Couldn’t load more messages", Some(&error));
                }
            }
        });
    }

    fn replace_with_latest(&self, page: TranscriptPage) {
        let additions = boxed_messages(page.messages);
        self.model.splice(0, self.model.n_items(), &additions);
        {
            let mut state = self.state.borrow_mut();
            state.has_older = page.has_more;
            state.has_newer = false;
            state.loading_older = false;
            state.loading_newer = false;
        }
        let list = self.list.clone();
        glib::idle_add_local_once(move || {
            let Some(count) = list.model().map(|model| model.n_items()) else {
                return;
            };
            if count > 0 {
                list.scroll_to(count - 1, gtk::ListScrollFlags::NONE, None);
            }
        });
    }

    fn apply_page(&self, direction: PageDirection, page: TranscriptPage) {
        let additions = boxed_messages(page.messages);
        let addition_count = additions.len() as u32;
        match direction {
            PageDirection::Older => {
                self.model.splice(0, 0, &additions);
                let overflow = self.model.n_items().saturating_sub(MAX_LOADED_MESSAGES);
                if overflow > 0 {
                    self.model.splice(
                        self.model.n_items() - overflow,
                        overflow,
                        &[] as &[glib::BoxedAnyObject],
                    );
                }
                let mut state = self.state.borrow_mut();
                state.has_older = page.has_more;
                state.has_newer |= overflow > 0;
                state.loading_older = false;
            }
            PageDirection::Newer => {
                self.model.splice(self.model.n_items(), 0, &additions);
                let overflow = self.model.n_items().saturating_sub(MAX_LOADED_MESSAGES);
                if overflow > 0 {
                    self.model
                        .splice(0, overflow, &[] as &[glib::BoxedAnyObject]);
                }
                let mut state = self.state.borrow_mut();
                state.has_newer = page.has_more;
                state.has_older |= overflow > 0;
                state.loading_newer = false;
            }
        }
        if addition_count == 0 {
            let mut state = self.state.borrow_mut();
            match direction {
                PageDirection::Older => state.has_older = false,
                PageDirection::Newer => state.has_newer = false,
            }
        }
    }

    fn finish_page_request(&self, direction: PageDirection) {
        let mut state = self.state.borrow_mut();
        match direction {
            PageDirection::Older => state.loading_older = false,
            PageDirection::Newer => state.loading_newer = false,
        }
    }

    fn show_status(&self, text: &str, tooltip: Option<&str>) {
        self.status.set_text(text);
        self.status.set_tooltip_text(tooltip);
        self.status.set_visible(true);
    }
}

fn boxed_messages(messages: Vec<TranscriptMessage>) -> Vec<glib::BoxedAnyObject> {
    messages
        .into_iter()
        .map(glib::BoxedAnyObject::new)
        .collect()
}

fn message_factory() -> gtk::SignalListItemFactory {
    let factory = gtk::SignalListItemFactory::new();
    factory.connect_setup(|_, object| {
        let list_item = object
            .downcast_ref::<gtk::ListItem>()
            .expect("message factory receives GtkListItem");
        let row = gtk::Box::new(gtk::Orientation::Vertical, 0);
        row.add_css_class("transcript-message");
        row.set_hexpand(true);
        list_item.set_child(Some(&row));
    });
    factory.connect_bind(|_, object| {
        let list_item = object
            .downcast_ref::<gtk::ListItem>()
            .expect("message factory receives GtkListItem");
        let item = list_item
            .item()
            .and_downcast::<glib::BoxedAnyObject>()
            .expect("transcript model contains messages");
        let message = item.borrow::<TranscriptMessage>();
        let row = list_item
            .child()
            .and_downcast::<gtk::Box>()
            .expect("message row is a GtkBox");
        bind_message(&row, &message);
    });
    factory
}

fn bind_message(row: &gtk::Box, message: &TranscriptMessage) {
    while let Some(child) = row.first_child() {
        row.remove(&child);
    }
    for class in [
        "transcript-message-user",
        "transcript-message-agent",
        "transcript-message-thought",
        "transcript-message-tool",
        "transcript-message-error",
    ] {
        row.remove_css_class(class);
    }
    row.add_css_class(role_css_class(message.role));
    if message.state == TranscriptMessageState::Error {
        row.add_css_class("transcript-message-error");
    }

    let role = gtk::Label::new(Some(role_label(message.role)));
    role.add_css_class("transcript-role");
    role.set_halign(gtk::Align::Start);
    role.set_xalign(0.0);
    row.append(&role);

    for block in &message.blocks {
        row.append(&block_widget(&block.kind));
    }
}

fn block_widget(block: &TranscriptBlockKind) -> gtk::Widget {
    match block {
        TranscriptBlockKind::Text { text } => selectable_label(text, None).upcast(),
        TranscriptBlockKind::Code { language, text } => {
            let container = gtk::Box::new(gtk::Orientation::Vertical, 0);
            container.add_css_class("transcript-code");
            if let Some(language) = language {
                let label = gtk::Label::new(Some(language));
                label.add_css_class("transcript-block-secondary");
                label.set_xalign(0.0);
                container.append(&label);
            }
            let code = selectable_label(text, Some("monospace"));
            container.append(&code);
            container.upcast()
        }
        TranscriptBlockKind::ToolCall { title, status, .. } => {
            let container = gtk::Box::new(gtk::Orientation::Vertical, 0);
            container.add_css_class("transcript-tool");
            container.append(&selectable_label(title, None));
            let status = gtk::Label::new(Some(status));
            status.add_css_class("transcript-block-secondary");
            status.set_xalign(0.0);
            container.append(&status);
            container.upcast()
        }
        TranscriptBlockKind::ToolResult { content, .. } => {
            let label = selectable_label(content, Some("monospace"));
            label.add_css_class("transcript-tool");
            label.upcast()
        }
        TranscriptBlockKind::Image { alt, uri } => {
            selectable_label(alt.as_deref().unwrap_or(uri), None).upcast()
        }
        TranscriptBlockKind::Resource { uri, title } => {
            selectable_label(title.as_deref().unwrap_or(uri), None).upcast()
        }
        TranscriptBlockKind::Other { kind, .. } => {
            let label = selectable_label(kind, None);
            label.add_css_class("transcript-block-secondary");
            label.upcast()
        }
    }
}

fn selectable_label(text: &str, css_class: Option<&str>) -> gtk::Label {
    let label = gtk::Label::new(Some(text));
    label.set_hexpand(true);
    label.set_selectable(true);
    label.set_wrap(true);
    label.set_wrap_mode(gtk::pango::WrapMode::WordChar);
    label.set_xalign(0.0);
    if let Some(css_class) = css_class {
        label.add_css_class(css_class);
    }
    label
}

const fn role_label(role: TranscriptRole) -> &'static str {
    match role {
        TranscriptRole::User => "You",
        TranscriptRole::Agent => "Agent",
        TranscriptRole::Thought => "Thought",
        TranscriptRole::System => "System",
        TranscriptRole::Tool => "Tool",
    }
}

const fn role_css_class(role: TranscriptRole) -> &'static str {
    match role {
        TranscriptRole::User => "transcript-message-user",
        TranscriptRole::Agent | TranscriptRole::System => "transcript-message-agent",
        TranscriptRole::Thought => "transcript-message-thought",
        TranscriptRole::Tool => "transcript-message-tool",
    }
}
