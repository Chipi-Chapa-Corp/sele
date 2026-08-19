use gtk::prelude::*;

pub(super) const STYLE: &str = include_str!("style.css");

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[allow(
    dead_code,
    reason = "session/list only exposes stored chats; live ACP updates will supply these states"
)]
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
    pub id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub cwd: String,
    pub name: String,
    pub updated_at: Option<String>,
    pub status: ChatStatus,
}

impl ChatSummary {
    pub fn new(
        id: impl Into<String>,
        agent_id: impl Into<String>,
        agent_name: impl Into<String>,
        cwd: impl Into<String>,
        name: impl Into<String>,
        updated_at: Option<String>,
        status: ChatStatus,
    ) -> Self {
        Self {
            id: id.into(),
            agent_id: agent_id.into(),
            agent_name: agent_name.into(),
            cwd: cwd.into(),
            name: name.into(),
            updated_at,
            status,
        }
    }
}

pub(super) fn build_chat_content(chat: &ChatSummary) -> gtk::Box {
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
    content
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
