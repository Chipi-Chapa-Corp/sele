use std::cell::RefCell;
use std::rc::Rc;

use gtk::prelude::*;
use sele_core::{
    TranscriptBlockKind, TranscriptMessage, TranscriptMessageState, TranscriptRole,
    TranscriptToolKind,
};

use super::selectable_text;

pub(super) const STYLE: &str = include_str!("style.css");

pub(super) fn work_section(messages: Vec<TranscriptMessage>) -> gtk::Widget {
    let section = gtk::Box::new(gtk::Orientation::Vertical, 0);
    section.add_css_class("work-section");
    section.set_hexpand(true);

    let header = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    header.set_hexpand(true);
    let label = gtk::Label::new(Some("Worked"));
    label.add_css_class("work-section-label");
    label.set_hexpand(true);
    label.set_xalign(0.0);
    header.append(&label);
    let chevron = disclosure_chevron();
    header.append(&chevron);

    let toggle = gtk::ToggleButton::new();
    toggle.add_css_class("flat");
    toggle.add_css_class("work-section-toggle");
    toggle.set_hexpand(true);
    toggle.set_child(Some(&header));
    section.append(&toggle);

    let separator = gtk::Separator::new(gtk::Orientation::Horizontal);
    separator.add_css_class("work-section-separator");
    section.append(&separator);

    let content = gtk::Revealer::new();
    content.set_transition_type(gtk::RevealerTransitionType::None);
    content.set_visible(false);
    section.append(&content);

    let pending = Rc::new(RefCell::new(Some(messages)));
    let section_for_toggle = section.clone();
    toggle.connect_toggled(move |toggle| {
        let expanded = toggle.is_active();
        set_chevron_state(&chevron, expanded);
        if expanded
            && content.child().is_none()
            && let Some(messages) = pending.borrow_mut().take()
        {
            content.set_child(Some(&work_content(&messages)));
        }
        content.set_visible(expanded);
        content.set_reveal_child(expanded);
        section_for_toggle.queue_resize();
    });
    section.upcast()
}

fn work_content(messages: &[TranscriptMessage]) -> gtk::Box {
    let content = gtk::Box::new(gtk::Orientation::Vertical, 0);
    content.add_css_class("work-section-content");
    let mut regular = None;
    let mut tools = Vec::new();
    for message in messages {
        if message.role == TranscriptRole::Thought {
            continue;
        }
        if message.role == TranscriptRole::Tool {
            append_regular_message(&content, regular.take());
            tools.push(message.clone());
        } else if let Some(pending) = &mut regular {
            append_tool_messages(&content, std::mem::take(&mut tools));
            pending.blocks.extend(message.blocks.clone());
            if message.state == TranscriptMessageState::Error {
                pending.state = TranscriptMessageState::Error;
            }
        } else {
            append_tool_messages(&content, std::mem::take(&mut tools));
            regular = Some(message.clone());
        }
    }
    append_regular_message(&content, regular);
    append_tool_messages(&content, tools);
    content
}

fn append_regular_message(content: &gtk::Box, message: Option<TranscriptMessage>) {
    if let Some(message) = message {
        content.append(&regular_message(&message));
    }
}

fn append_tool_messages(content: &gtk::Box, messages: Vec<TranscriptMessage>) {
    match messages.len() {
        0 => {}
        1 => content.append(&tool_row(&messages[0])),
        _ => content.append(&tool_sequence(messages)),
    }
}

fn tool_sequence(messages: Vec<TranscriptMessage>) -> gtk::Widget {
    let kinds = messages.iter().filter_map(tool_kind).collect::<Vec<_>>();
    let dominant_kind = kinds
        .iter()
        .copied()
        .max_by_key(|candidate| kinds.iter().filter(|kind| *kind == candidate).count())
        .unwrap_or(TranscriptToolKind::Other);
    let mut labels = Vec::new();
    for kind in kinds {
        let label = tool_sequence_kind_label(kind);
        if !labels.contains(&label) {
            labels.push(label);
        }
    }
    let label = if labels.is_empty() {
        "Used tools".to_owned()
    } else {
        labels.join(", ")
    };
    let state = if messages
        .iter()
        .any(|message| message.state == TranscriptMessageState::Error)
    {
        TranscriptMessageState::Error
    } else {
        TranscriptMessageState::Complete
    };

    lazy_expander(dominant_kind, &label, state, move || {
        let content = gtk::Box::new(gtk::Orientation::Vertical, 0);
        content.add_css_class("work-tool-sequence-content");
        for message in &messages {
            content.append(&tool_row(message));
        }
        content.upcast()
    })
}

fn tool_kind(message: &TranscriptMessage) -> Option<TranscriptToolKind> {
    message.blocks.iter().find_map(|block| match &block.kind {
        TranscriptBlockKind::ToolCall {
            title,
            tool_kind,
            payload_json,
            ..
        } => Some(inferred_tool_kind(
            *tool_kind,
            title,
            payload_json.as_deref(),
        )),
        _ => None,
    })
}

const fn tool_sequence_kind_label(kind: TranscriptToolKind) -> &'static str {
    match kind {
        TranscriptToolKind::Read => "Read files",
        TranscriptToolKind::Edit => "Changed files",
        TranscriptToolKind::Delete => "Deleted files",
        TranscriptToolKind::Move => "Moved files",
        TranscriptToolKind::Search => "Searched",
        TranscriptToolKind::Execute => "Ran commands",
        TranscriptToolKind::Think => "Used tools",
        TranscriptToolKind::Fetch => "Opened pages",
        TranscriptToolKind::SwitchMode => "Switched modes",
        TranscriptToolKind::Other => "Used tools",
    }
}

fn regular_message(message: &TranscriptMessage) -> gtk::Widget {
    let content = message_content(message);
    content.add_css_class("work-message");
    if message.state == TranscriptMessageState::Error {
        content.add_css_class("error");
    }
    content.upcast()
}

fn tool_row(message: &TranscriptMessage) -> gtk::Widget {
    let Some((title, kind)) = message.blocks.iter().find_map(|block| match &block.kind {
        TranscriptBlockKind::ToolCall {
            title,
            tool_kind,
            payload_json,
            ..
        } => Some((
            title.clone(),
            inferred_tool_kind(*tool_kind, title, payload_json.as_deref()),
        )),
        _ => None,
    }) else {
        return regular_message(message);
    };

    let output = message
        .blocks
        .iter()
        .filter_map(|block| match &block.kind {
            TranscriptBlockKind::ToolResult { content, .. } if !content.trim().is_empty() => {
                Some(sele_agent::display_tool_result(content).into_owned())
            }
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n");

    if is_compact_file_tool(kind) || output.is_empty() {
        let row = item_header(kind, &title, true);
        row.add_css_class("work-tool-row");
        if message.state == TranscriptMessageState::Error {
            row.add_css_class("error");
        }
        return row.upcast();
    }

    lazy_expander(kind, &title, message.state, move || {
        let label = selectable_label(&output);
        label.add_css_class("work-tool-output");
        label.add_css_class("card");
        label.upcast()
    })
}

fn lazy_expander(
    kind: TranscriptToolKind,
    title: &str,
    state: TranscriptMessageState,
    build_child: impl FnOnce() -> gtk::Widget + 'static,
) -> gtk::Widget {
    let disclosure = gtk::Box::new(gtk::Orientation::Vertical, 0);
    disclosure.add_css_class("work-item-expander");
    if state == TranscriptMessageState::Error {
        disclosure.add_css_class("error");
    }

    let chevron = disclosure_chevron();
    let header = item_header(kind, title, false);
    header.append(&chevron);
    let toggle = gtk::ToggleButton::new();
    toggle.add_css_class("flat");
    toggle.add_css_class("work-item-toggle");
    toggle.set_halign(gtk::Align::Start);
    toggle.set_child(Some(&header));
    disclosure.append(&toggle);

    let content = gtk::Revealer::new();
    content.set_transition_type(gtk::RevealerTransitionType::None);
    content.set_visible(false);
    disclosure.append(&content);

    let pending = Rc::new(RefCell::new(Some(build_child)));
    let disclosure_for_toggle = disclosure.clone();
    toggle.connect_toggled(move |toggle| {
        let expanded = toggle.is_active();
        set_chevron_state(&chevron, expanded);
        if expanded
            && content.child().is_none()
            && let Some(build_child) = pending.borrow_mut().take()
        {
            content.set_child(Some(&build_child()));
        }
        content.set_visible(expanded);
        content.set_reveal_child(expanded);
        disclosure_for_toggle.queue_resize();
    });
    disclosure.upcast()
}

fn item_header(kind: TranscriptToolKind, title: &str, selectable: bool) -> gtk::Box {
    let header = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    header.add_css_class("work-item-header");

    let icon = gtk::Image::from_icon_name(tool_icon(kind, title));
    icon.add_css_class("work-item-icon");
    header.append(&icon);

    let label = if selectable {
        selectable_text::label(title)
    } else {
        gtk::Label::new(Some(title))
    };
    label.set_lines(1);
    label.set_ellipsize(gtk::pango::EllipsizeMode::End);
    label.set_xalign(0.0);
    header.append(&label);
    header
}

fn disclosure_chevron() -> gtk::Image {
    let chevron = gtk::Image::from_icon_name("pan-end-symbolic");
    chevron.add_css_class("work-disclosure-chevron");
    chevron
}

fn set_chevron_state(chevron: &gtk::Image, expanded: bool) {
    chevron.set_icon_name(Some(if expanded {
        "pan-down-symbolic"
    } else {
        "pan-end-symbolic"
    }));
}

fn message_content(message: &TranscriptMessage) -> gtk::Box {
    let content = gtk::Box::new(gtk::Orientation::Vertical, 0);
    content.add_css_class("work-message-content");
    let label = selectable_text::message_label(message);
    label.set_hexpand(true);
    content.append(&label);
    content
}

fn selectable_label(text: &str) -> gtk::Label {
    let label = selectable_text::label(text);
    label.set_hexpand(true);
    label
}

const fn is_compact_file_tool(kind: TranscriptToolKind) -> bool {
    matches!(
        kind,
        TranscriptToolKind::Read
            | TranscriptToolKind::Edit
            | TranscriptToolKind::Delete
            | TranscriptToolKind::Move
    )
}

fn inferred_tool_kind(
    kind: TranscriptToolKind,
    title: &str,
    payload_json: Option<&str>,
) -> TranscriptToolKind {
    if kind != TranscriptToolKind::Other {
        return kind;
    }

    let title = title.trim().to_ascii_lowercase();
    if ["open page", "open web page", "open url", "fetch "]
        .iter()
        .any(|prefix| title.starts_with(prefix))
    {
        TranscriptToolKind::Fetch
    } else if [
        "read ",
        "read:",
        "open file",
        "view ",
        "view image",
        "list files",
    ]
    .iter()
    .any(|prefix| title.starts_with(prefix))
    {
        TranscriptToolKind::Read
    } else if [
        "write ", "write:", "edit ", "edit:", "edited ", "editing ", "create ", "update ", "patch ",
    ]
    .iter()
    .any(|prefix| title.starts_with(prefix))
    {
        TranscriptToolKind::Edit
    } else if ["web search", "search ", "find "]
        .iter()
        .any(|prefix| title.starts_with(prefix))
    {
        TranscriptToolKind::Search
    } else if payload_json.is_some_and(|payload| {
        payload.contains("\"command\"")
            || payload.contains("\"cmd\"")
            || payload.contains("\"cwd\"")
    }) {
        TranscriptToolKind::Execute
    } else {
        kind
    }
}

fn tool_icon(kind: TranscriptToolKind, title: &str) -> &'static str {
    if title.eq_ignore_ascii_case("Compact conversation") {
        return "view-refresh-symbolic";
    }
    match kind {
        TranscriptToolKind::Read => "document-open-symbolic",
        TranscriptToolKind::Edit => "document-edit-symbolic",
        TranscriptToolKind::Delete => "user-trash-symbolic",
        TranscriptToolKind::Move => "folder-symbolic",
        TranscriptToolKind::Search => "edit-find-symbolic",
        TranscriptToolKind::Execute => "utilities-terminal-symbolic",
        TranscriptToolKind::Think => "dialog-information-symbolic",
        TranscriptToolKind::Fetch => "web-browser-symbolic",
        TranscriptToolKind::SwitchMode => "view-refresh-symbolic",
        TranscriptToolKind::Other => "applications-system-symbolic",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infers_cached_file_and_execution_tools() {
        assert_eq!(
            inferred_tool_kind(TranscriptToolKind::Other, "Read file 'README.md'", None),
            TranscriptToolKind::Read
        );
        assert_eq!(
            inferred_tool_kind(TranscriptToolKind::Other, "Editing files", None),
            TranscriptToolKind::Edit
        );
        assert_eq!(
            inferred_tool_kind(
                TranscriptToolKind::Other,
                "cargo test",
                Some(r#"{"command":"cargo test","cwd":"/work"}"#),
            ),
            TranscriptToolKind::Execute
        );
        assert_eq!(
            inferred_tool_kind(TranscriptToolKind::Other, "Open web page", None),
            TranscriptToolKind::Fetch
        );
    }

    #[test]
    fn file_tools_are_compact_and_all_icons_are_symbolic() {
        assert!(is_compact_file_tool(TranscriptToolKind::Read));
        assert!(is_compact_file_tool(TranscriptToolKind::Edit));
        for kind in [
            TranscriptToolKind::Read,
            TranscriptToolKind::Edit,
            TranscriptToolKind::Delete,
            TranscriptToolKind::Move,
            TranscriptToolKind::Search,
            TranscriptToolKind::Execute,
            TranscriptToolKind::Think,
            TranscriptToolKind::Fetch,
            TranscriptToolKind::SwitchMode,
            TranscriptToolKind::Other,
        ] {
            assert!(tool_icon(kind, "Tool").ends_with("-symbolic"));
        }
        assert_eq!(
            tool_icon(TranscriptToolKind::Other, "Compact conversation"),
            "view-refresh-symbolic"
        );
        assert_eq!(
            tool_sequence_kind_label(TranscriptToolKind::Read),
            "Read files"
        );
        assert_eq!(
            tool_sequence_kind_label(TranscriptToolKind::Execute),
            "Ran commands"
        );
    }
}
