use gtk::prelude::*;

pub(super) const STYLE: &str = include_str!("style.css");

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ChatStatus {
    Idle,
    Active,
    Waiting,
    Error,
    Finished,
}

impl ChatStatus {
    fn css_class(self) -> &'static str {
        match self {
            Self::Idle => "status-idle",
            Self::Active => "status-active",
            Self::Waiting => "status-waiting",
            Self::Error => "status-error",
            Self::Finished => "status-finished",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Idle => "Idle",
            Self::Active => "Active",
            Self::Waiting => "Waiting",
            Self::Error => "Error",
            Self::Finished => "Finished",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChatSummary {
    pub name: String,
    pub status: ChatStatus,
}

impl ChatSummary {
    pub fn new(name: impl Into<String>, status: ChatStatus) -> Self {
        Self {
            name: name.into(),
            status,
        }
    }
}

pub(super) fn build_chat_row(chat: &ChatSummary) -> gtk::ListBoxRow {
    let row = gtk::ListBoxRow::new();
    row.set_activatable(true);
    row.set_selectable(true);
    row.set_tooltip_text(Some(&chat.name));

    let content = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    content.add_css_class("chat-row-content");

    let status = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    status.add_css_class("status-dot");
    status.add_css_class(chat.status.css_class());
    status.set_tooltip_text(Some(chat.status.label()));
    status.set_valign(gtk::Align::Center);

    let name = gtk::Label::new(Some(&chat.name));
    name.set_ellipsize(gtk::pango::EllipsizeMode::End);
    name.set_hexpand(true);
    name.set_xalign(0.0);

    content.append(&status);
    content.append(&name);
    row.set_child(Some(&content));
    row
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statuses_have_distinct_style_classes() {
        let statuses = [
            ChatStatus::Idle,
            ChatStatus::Active,
            ChatStatus::Waiting,
            ChatStatus::Error,
            ChatStatus::Finished,
        ];

        let mut classes = statuses.map(ChatStatus::css_class).to_vec();
        classes.sort_unstable();
        classes.dedup();

        assert_eq!(classes.len(), statuses.len());
    }
}
