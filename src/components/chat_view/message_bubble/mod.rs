use gtk::prelude::*;
use sele_core::TranscriptMessage;

use super::selectable_text;

pub(super) const STYLE: &str = include_str!("style.css");

pub(super) fn user_message(message: &TranscriptMessage) -> gtk::Widget {
    let row = message_row();

    let bubble = gtk::Box::new(gtk::Orientation::Vertical, 0);
    bubble.add_css_class("chat-message-user");
    bubble.add_css_class("card");
    bubble.set_halign(gtk::Align::End);
    let label = selectable_text::message_label(message);
    label.set_max_width_chars(72);
    bubble.append(&label);
    let spacer = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    spacer.set_hexpand(true);
    row.append(&spacer);
    row.append(&bubble);
    row.upcast()
}

pub(super) fn agent_message(message: &TranscriptMessage) -> gtk::Widget {
    let row = message_row();
    let content = gtk::Box::new(gtk::Orientation::Vertical, 0);
    content.add_css_class("chat-message-agent");
    content.set_hexpand(true);
    let label = selectable_text::message_label(message);
    label.set_hexpand(true);
    content.append(&label);
    row.append(&content);
    row.upcast()
}

fn message_row() -> gtk::Box {
    let row = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    row.add_css_class("chat-message-row");
    row.set_hexpand(true);
    row.set_halign(gtk::Align::Fill);
    row
}
