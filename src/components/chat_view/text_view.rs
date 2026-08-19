use std::cell::RefCell;
use std::rc::Rc;

use gtk::prelude::*;
use sele_core::{TranscriptBlockKind, TranscriptMessage, TranscriptRole};

use super::message_row::materialized_block_widget;

#[derive(Clone)]
pub(super) struct TranscriptTextView {
    view: gtk::TextView,
    end_mark: gtk::TextMark,
    role_tag: gtk::TextTag,
    code_tag: gtk::TextTag,
    anchored_widgets: Rc<RefCell<Vec<gtk::Widget>>>,
}

impl TranscriptTextView {
    pub(super) fn new() -> Self {
        let view = gtk::TextView::new();
        view.add_css_class("transcript-text-view");
        view.set_editable(false);
        view.set_cursor_visible(false);
        view.set_wrap_mode(gtk::WrapMode::WordChar);
        view.set_vexpand(true);

        let buffer = view.buffer();
        buffer.set_enable_undo(false);
        let end_mark = buffer.create_mark(Some("transcript-end"), &buffer.end_iter(), false);
        let role_tag = buffer
            .create_tag(Some("transcript-role"), &[("weight", &700_i32)])
            .expect("transcript role tag name is unique");
        let code_tag = buffer
            .create_tag(Some("transcript-code"), &[("family", &"monospace")])
            .expect("transcript code tag name is unique");

        Self {
            view,
            end_mark,
            role_tag,
            code_tag,
            anchored_widgets: Rc::new(RefCell::new(Vec::new())),
        }
    }

    pub(super) fn widget(&self) -> &gtk::TextView {
        &self.view
    }

    pub(super) fn is_empty(&self) -> bool {
        self.view.buffer().char_count() == 0
    }

    pub(super) fn clear(&self) {
        for widget in self.anchored_widgets.borrow_mut().drain(..) {
            self.view.remove(&widget);
        }
        self.view.buffer().set_text("");
    }

    pub(super) fn replace(&self, messages: &[TranscriptMessage]) {
        self.clear();
        let buffer = self.view.buffer();
        let mut iter = buffer.end_iter();

        for message in messages {
            buffer.insert_with_tags(&mut iter, role_label(message.role), &[&self.role_tag]);
            buffer.insert(&mut iter, "\n");

            for block in &message.blocks {
                match &block.kind {
                    TranscriptBlockKind::Text { text } => {
                        buffer.insert(&mut iter, text);
                        buffer.insert(&mut iter, "\n");
                    }
                    TranscriptBlockKind::Code { language, text } => {
                        if let Some(language) = language {
                            buffer.insert_with_tags(&mut iter, language, &[&self.role_tag]);
                            buffer.insert(&mut iter, "\n");
                        }
                        buffer.insert_with_tags(&mut iter, text, &[&self.code_tag]);
                        buffer.insert(&mut iter, "\n");
                    }
                    TranscriptBlockKind::ToolCall { .. }
                    | TranscriptBlockKind::ToolResult { .. } => {
                        self.insert_widget(
                            &buffer,
                            &mut iter,
                            materialized_block_widget(&block.kind),
                        );
                    }
                    TranscriptBlockKind::Image { alt, uri } => {
                        buffer.insert(&mut iter, alt.as_deref().unwrap_or(uri));
                        buffer.insert(&mut iter, "\n");
                    }
                    TranscriptBlockKind::Resource { uri, title } => {
                        buffer.insert(&mut iter, title.as_deref().unwrap_or(uri));
                        buffer.insert(&mut iter, "\n");
                    }
                    TranscriptBlockKind::Other { kind, .. } => {
                        buffer.insert(&mut iter, kind);
                        buffer.insert(&mut iter, "\n");
                    }
                }
            }
            buffer.insert(&mut iter, "\n");
        }

        buffer.move_mark(&self.end_mark, &buffer.end_iter());
    }

    pub(super) fn request_scroll_to_end(&self) {
        self.view
            .scroll_to_mark(&self.end_mark, 0.0, true, 0.0, 1.0);
    }

    fn insert_widget(
        &self,
        buffer: &gtk::TextBuffer,
        iter: &mut gtk::TextIter,
        widget: gtk::Widget,
    ) {
        widget.set_hexpand(true);
        let anchor = buffer.create_child_anchor(iter);
        self.view.add_child_at_anchor(&widget, &anchor);
        self.anchored_widgets.borrow_mut().push(widget);
        buffer.insert(iter, "\n");
    }
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
