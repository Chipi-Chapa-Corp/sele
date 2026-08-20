use std::cell::RefCell;
use std::rc::Rc;

use gtk::prelude::*;
use sele_core::TranscriptMessage;

use super::message_bubble::{agent_message, user_message};
use super::presentation::transcript_turns;
use super::work_section::work_section;

#[derive(Clone)]
pub(super) struct TranscriptTextView {
    view: gtk::TextView,
    end_mark: gtk::TextMark,
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

        // This TextView is only a height-efficient host for child-anchor widgets. Its own buffer
        // contains no user-facing text, so allowing its native click/drag selection gestures to
        // run over the gaps between anchors only causes auto-scroll feedback and jitter.
        let controllers = view.observe_controllers();
        for index in (0..controllers.n_items()).rev() {
            let Some(controller) = controllers.item(index) else {
                continue;
            };
            if controller.is::<gtk::GestureDrag>() || controller.is::<gtk::GestureClick>() {
                let controller = controller
                    .downcast::<gtk::EventController>()
                    .expect("gestures are event controllers");
                view.remove_controller(&controller);
            }
        }

        let buffer = view.buffer();
        buffer.set_enable_undo(false);
        let end_mark = buffer.create_mark(Some("transcript-end"), &buffer.end_iter(), false);

        Self {
            view,
            end_mark,
            anchored_widgets: Rc::new(RefCell::new(Vec::new())),
        }
    }

    pub(super) fn widget(&self) -> &gtk::TextView {
        &self.view
    }

    pub(super) fn track_viewport_width(&self, viewport: &gtk::ScrolledWindow) {
        let widgets = Rc::clone(&self.anchored_widgets);
        viewport.hadjustment().connect_changed(move |adjustment| {
            let width = adjustment.page_size().round() as i32;
            if width <= 0 {
                return;
            }
            for widget in widgets.borrow().iter() {
                widget.set_width_request(width);
            }
        });

        let widgets = Rc::clone(&self.anchored_widgets);
        viewport.connect_notify_local(Some("width"), move |viewport, _| {
            let width = viewport.width();
            if width <= 0 {
                return;
            }
            for widget in widgets.borrow().iter() {
                widget.set_width_request(width);
            }
        });
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

        for turn in transcript_turns(messages) {
            if let Some(user) = turn.user {
                self.insert_widget(&buffer, &mut iter, user_message(&user));
            }

            if !turn.work.is_empty() {
                self.insert_widget(&buffer, &mut iter, work_section(turn.work));
            }

            if let Some(final_answer) = turn.final_answer {
                self.insert_widget(&buffer, &mut iter, agent_message(&final_answer));
            }
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
        let row = gtk::Box::new(gtk::Orientation::Horizontal, 0);
        row.set_hexpand(true);
        row.set_overflow(gtk::Overflow::Hidden);
        widget.set_hexpand(true);
        row.append(&widget);

        let width = self.view.width();
        if width > 0 {
            row.set_width_request(width);
        }
        let anchor = buffer.create_child_anchor(iter);
        self.view.add_child_at_anchor(&row, &anchor);
        self.anchored_widgets.borrow_mut().push(row.upcast());
        buffer.insert(iter, "\n");
    }
}
